/**
 * HTML (as produced by the editor) -> Word .docx, entirely in the browser using the `docx` library.
 *
 * Supported: paragraphs, headings 1-6, bold / italic / underline / strikethrough / sub / superscript,
 * text colour, highlight, font family and size, alignment, line height, paragraph spacing,
 * indentation, bullet and numbered lists (nested), block quotes, links, tables (header cells,
 * column/row spans), embedded PNG/JPEG/GIF/BMP images, horizontal rules and page breaks.
 *
 * Not representable (reported through `warnings` instead of failing silently):
 * images that are external URLs or SVG, which are replaced by their alt text.
 */
import { normalizeLayout } from '../editor/layout.js';
import {
  Header,
  Footer,
  PageNumber,
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  ExternalHyperlink,
  PageBreak,
  LevelFormat,
  BorderStyle,
  ShadingType,
  UnderlineType,
} from 'docx';
import { parseDataUrl, imageSize } from './imageBytes.js';
import { PAGE_SIZES, PAGE_MARGIN } from '../editor/constants.js';

const FONT = 'Calibri';
const HEADINGS = {
  H1: { level: HeadingLevel.HEADING_1 },
  H2: { level: HeadingLevel.HEADING_2 },
  H3: { level: HeadingLevel.HEADING_3 },
  H4: { level: HeadingLevel.HEADING_4 },
  H5: { level: HeadingLevel.HEADING_5 },
  H6: { level: HeadingLevel.HEADING_6 },
};
const ALIGN = {
  left: AlignmentType.LEFT,
  start: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  end: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
  justify: AlignmentType.JUSTIFIED,
};
const INLINE_BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'HR', 'DIV', 'PRE', 'LI']);

function toHex(color) {
  if (!color) return undefined;
  const c = color.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
}

/** font-size -> half-points (docx unit) */
function toHalfPoints(size) {
  if (!size) return undefined;
  const m = /^([\d.]+)(pt|px)?$/.exec(size.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Math.max(2, Math.round((m[2] === 'px' ? n * 0.75 : n) * 2));
}

function firstFont(family) {
  if (!family || family.includes('var(')) return undefined;
  return family.split(',')[0].replace(/["']/g, '').trim() || undefined;
}

function createContext(pageSize) {
  const page = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
  return {
    warnings: new Set(),
    page,
    contentWidthPx: page.width - PAGE_MARGIN * 2,
    listInstance: 0,
  };
}

// ---------------------------------------------------------------- inline content

function runOptions(marks, text) {
  const o = { text };
  if (marks.bold) o.bold = true;
  if (marks.italics) o.italics = true;
  if (marks.underline) o.underline = { type: UnderlineType.SINGLE };
  if (marks.strike) o.strike = true;
  if (marks.sub) o.subScript = true;
  if (marks.sup) o.superScript = true;
  if (marks.color) o.color = marks.color;
  if (marks.fill) o.shading = { type: ShadingType.CLEAR, fill: marks.fill, color: 'auto' };
  if (marks.size) o.size = marks.size;
  if (marks.font) o.font = marks.font;
  return o;
}

function imageRun(el, ctx) {
  const src = el.getAttribute('src') || '';
  const alt = el.getAttribute('alt') || '';
  const parsed = parseDataUrl(src);
  const supported = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  if (!parsed || !supported[parsed.mime]) {
    ctx.warnings.add(
      parsed && parsed.mime === 'image/svg+xml'
        ? 'SVG images cannot be embedded in .docx files and were replaced by their alt text.'
        : 'Images linked from the web are not downloaded (to keep your document private); they were replaced by their alt text.',
    );
    return new TextRun({ text: `[Image${alt ? `: ${alt}` : ''}]`, italics: true, color: '666666' });
  }
  const natural = imageSize(parsed.bytes, parsed.mime) || { width: 400, height: 300 };
  const widthAttr = el.getAttribute('data-width');
  let width = natural.width;
  let height = natural.height;
  if (widthAttr && widthAttr.endsWith('%')) {
    width = Math.round((ctx.contentWidthPx * parseFloat(widthAttr)) / 100);
    height = Math.round((natural.height * width) / natural.width);
  }
  if (width > ctx.contentWidthPx) {
    height = Math.round((height * ctx.contentWidthPx) / width);
    width = ctx.contentWidthPx;
  }
  return new ImageRun({
    type: supported[parsed.mime],
    data: parsed.bytes,
    transformation: { width: Math.max(1, width), height: Math.max(1, height) },
    altText: { name: alt || 'image', title: alt || 'image', description: alt || 'image' },
  });
}

function inlineRuns(node, marks, ctx) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.nodeValue.replace(/\s*\n\s*/g, ' ');
      if (text) runs.push(new TextRun(runOptions(marks, text)));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName;
    if (tag === 'BR') {
      runs.push(new TextRun({ break: 1 }));
      return;
    }
    if (tag === 'IMG') {
      runs.push(imageRun(child, ctx));
      return;
    }
    if (INLINE_BLOCK_TAGS.has(tag)) {
      // stray block inside inline context (e.g. <p> inside <li> handled elsewhere): flatten
      runs.push(...inlineRuns(child, marks, ctx));
      return;
    }
    const next = { ...marks };
    if (tag === 'STRONG' || tag === 'B') next.bold = true;
    if (tag === 'EM' || tag === 'I') next.italics = true;
    if (tag === 'U') next.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
    if (tag === 'SUB') next.sub = true;
    if (tag === 'SUP') next.sup = true;
    if (tag === 'CODE') next.font = 'Courier New';
    if (tag === 'MARK') next.fill = toHex(child.style.backgroundColor) || toHex(child.getAttribute('data-color')) || 'FEF08A';
    const st = child.style;
    if (st) {
      if (st.color) next.color = toHex(st.color) || next.color;
      if (st.backgroundColor && tag !== 'MARK') next.fill = toHex(st.backgroundColor) || next.fill;
      if (st.fontSize) next.size = toHalfPoints(st.fontSize) || next.size;
      if (st.fontFamily) next.font = firstFont(st.fontFamily) || next.font;
    }
    if (tag === 'A' && child.getAttribute('href')) {
      const href = child.getAttribute('href');
      const linkMarks = { ...next, color: next.color || '0563C1', underline: true };
      const children = inlineRuns(child, linkMarks, ctx);
      if (/^(https?:|mailto:|tel:)/i.test(href)) runs.push(new ExternalHyperlink({ link: href, children }));
      else runs.push(...children);
      return;
    }
    runs.push(...inlineRuns(child, next, ctx));
  });
  return runs;
}

// ---------------------------------------------------------------- block content

function paragraphProps(el, extra = {}) {
  const props = { ...extra };
  const st = el.style || {};
  if (st.textAlign && ALIGN[st.textAlign]) props.alignment = ALIGN[st.textAlign];
  const spacing = { ...(props.spacing || {}) };
  const lh = parseFloat(st.lineHeight || '');
  if (lh > 0 && !st.lineHeight.endsWith('px')) {
    spacing.line = Math.round(lh * 240);
    spacing.lineRule = 'auto';
  }
  const before = el.getAttribute('data-space-before');
  const after = el.getAttribute('data-space-after');
  if (before != null && before !== '') spacing.before = Math.round(parseFloat(before) * 20);
  if (after != null && after !== '') spacing.after = Math.round(parseFloat(after) * 20);
  if (Object.keys(spacing).length) props.spacing = spacing;
  const indent = parseInt(el.getAttribute('data-indent') || '0', 10);
  if (indent) props.indent = { ...(props.indent || {}), left: (props.indent?.left || 0) + indent * 720 };
  return props;
}

function paragraphFrom(el, ctx, extra = {}, baseMarks = {}) {
  const heading = HEADINGS[el.tagName];
  // Heading look (bold, size) comes from the Heading1-6 paragraph styles, so a round trip
  // through Word / our importer does not turn every heading into "bold text inside a heading".
  const children = inlineRuns(el, { ...baseMarks }, ctx);
  return new Paragraph({
    ...paragraphProps(el, extra),
    ...(heading ? { heading: heading.level } : {}),
    children: children.length ? children : [new TextRun({ text: '' })],
  });
}

function listBlocks(list, ctx, level, instance, quote) {
  const out = [];
  const ordered = list.tagName === 'OL';
  const reference = ordered ? 'numbers' : 'bullets';
  Array.from(list.children).forEach((li) => {
    if (li.tagName !== 'LI') return;
    let first = true;
    const numbering = { reference, level: Math.min(level, 8), ...(ordered ? { instance } : {}) };
    const flush = (inlineHolder, el) => {
      const children = inlineRuns(inlineHolder, {}, ctx);
      out.push(
        new Paragraph({
          ...paragraphProps(el || inlineHolder),
          ...(first ? { numbering } : { indent: { left: (level + 1) * 720 } }),
          children: children.length ? children : [new TextRun({ text: '' })],
        }),
      );
      first = false;
    };
    // An <li> contains either <p> blocks (Tiptap) or inline content, plus optional nested lists.
    const inlineBuffer = li.ownerDocument.createElement('span');
    const drain = () => {
      if (inlineBuffer.childNodes.length) {
        flush(inlineBuffer, li);
        while (inlineBuffer.firstChild) inlineBuffer.removeChild(inlineBuffer.firstChild);
      }
    };
    Array.from(li.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'UL' || child.tagName === 'OL')) {
        drain();
        out.push(...listBlocks(child, ctx, level + 1, child.tagName === 'OL' ? (ctx.listInstance += 1) : instance, quote));
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'P') {
        drain();
        flush(child, child);
      } else {
        inlineBuffer.appendChild(child.cloneNode(true));
      }
    });
    drain();
    if (first) flush(li.ownerDocument.createElement('span'), li); // empty item
  });
  return out;
}

function tableFrom(el, ctx) {
  const rows = [];
  const sections = el.querySelectorAll(':scope > thead, :scope > tbody, :scope > tfoot');
  const rowEls = sections.length
    ? Array.from(sections).flatMap((s) => Array.from(s.children).filter((r) => r.tagName === 'TR'))
    : Array.from(el.children).filter((r) => r.tagName === 'TR');
  rowEls.forEach((tr) => {
    const cells = Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((cell) => {
        const isHeader = cell.tagName === 'TH';
        const kids = blocksFrom(cell, ctx, isHeader ? { bold: true } : {});
        return new TableCell({
          children: kids.length ? kids : [new Paragraph({ children: [] })],
          columnSpan: parseInt(cell.getAttribute('colspan') || '1', 10) || 1,
          rowSpan: parseInt(cell.getAttribute('rowspan') || '1', 10) || 1,
          ...(isHeader ? { shading: { type: ShadingType.CLEAR, fill: 'F1F3F4', color: 'auto' } } : {}),
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        });
      });
    const isHeaderRow = Array.from(tr.children).every((c) => c.tagName === 'TH');
    // Only set the flag when true: Word-style readers treat the mere presence of the property as "header row".
    if (cells.length) rows.push(new TableRow({ children: cells, ...(isHeaderRow ? { tableHeader: true } : {}) }));
  });
  if (!rows.length) return [];
  return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), new Paragraph({ children: [] })];
}

function blocksFrom(container, ctx, baseMarks = {}) {
  const out = [];
  let loose = null; // collects stray inline nodes into one paragraph
  const flushLoose = () => {
    if (!loose) return;
    const children = inlineRuns(loose, baseMarks, ctx);
    if (children.length) out.push(new Paragraph({ children }));
    loose = null;
  };

  container.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue.trim()) {
        loose = loose || container.ownerDocument.createElement('span');
        loose.appendChild(node.cloneNode(true));
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;

    if (tag === 'DIV' && node.getAttribute('data-type') === 'page-break') {
      flushLoose();
      out.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (HEADINGS[tag] || tag === 'P' || tag === 'PRE') {
      flushLoose();
      out.push(paragraphFrom(node, ctx, {}, baseMarks));
    } else if (tag === 'UL' || tag === 'OL') {
      flushLoose();
      out.push(...listBlocks(node, ctx, 0, tag === 'OL' ? (ctx.listInstance += 1) : 0));
    } else if (tag === 'BLOCKQUOTE') {
      flushLoose();
      const quote = {
        indent: { left: 720 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, space: 10, color: 'A0A0A0' } },
      };
      Array.from(node.children).forEach((child) => {
        if (child.tagName === 'P' || HEADINGS[child.tagName]) out.push(paragraphFrom(child, ctx, quote, { ...baseMarks, italics: true }));
        else blocksFrom(child.parentNode === node ? wrapSingle(child) : child, ctx, baseMarks).forEach((b) => out.push(b));
      });
      if (!node.children.length && node.textContent.trim()) out.push(new Paragraph({ ...quote, children: [new TextRun({ text: node.textContent, italics: true })] }));
    } else if (tag === 'TABLE') {
      flushLoose();
      out.push(...tableFrom(node, ctx));
    } else if (tag === 'HR') {
      flushLoose();
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '999999' } }, children: [] }));
    } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'BODY') {
      flushLoose();
      out.push(...blocksFrom(node, ctx, baseMarks));
    } else if (tag === 'BR') {
      // a lone <br> between blocks is just a blank line
      flushLoose();
      out.push(new Paragraph({ children: [] }));
    } else {
      loose = loose || container.ownerDocument.createElement('span');
      loose.appendChild(node.cloneNode(true));
    }
  });
  flushLoose();
  return out;
}

function wrapSingle(el) {
  const wrapper = el.ownerDocument.createElement('div');
  wrapper.appendChild(el.cloneNode(true));
  return wrapper;
}

// ---------------------------------------------------------------- document

function numberingConfig() {
  const bulletChars = ['•', '◦', '▪'];
  const numberFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const levels = (format, textFor) =>
    Array.from({ length: 9 }, (_, level) => ({
      level,
      format: format(level),
      text: textFor(level),
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: (level + 1) * 720, hanging: 360 } } },
    }));
  return {
    config: [
      { reference: 'bullets', levels: levels(() => LevelFormat.BULLET, (l) => bulletChars[l % 3]) },
      { reference: 'numbers', levels: levels((l) => numberFormats[l % 3], (l) => `%${l + 1}.`) },
    ],
  };
}

/** Word header/footer for the section, including a real PAGE field for page numbers. */
function docxFurniture(layout) {
  const l = normalizeLayout(layout);
  const small = { font: FONT, size: 18, color: '555555' };
  const out = {};
  if (l.header) out.headers = { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ ...small, text: l.header })] })] }) };
  if (l.footer || l.pageNumbers !== 'none') {
    const align = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
    const numbered = l.pageNumbers !== 'none';
    const sameBox = numbered && l.pageNumbers === 'center';
    const paras = [];
    if (l.footer) {
      const runs = [new TextRun({ ...small, text: sameBox ? `${l.footer} · Page ` : l.footer })];
      if (sameBox) runs.push(new TextRun({ ...small, children: [PageNumber.CURRENT] }));
      paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs }));
    }
    if (numbered && !sameBox) {
      paras.push(new Paragraph({ alignment: align[l.pageNumbers], children: [new TextRun({ ...small, children: ['Page ', PageNumber.CURRENT] })] }));
    } else if (sameBox && !l.footer) {
      paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ ...small, children: ['Page ', PageNumber.CURRENT] })] }));
    }
    out.footers = { default: new Footer({ children: paras }) };
  }
  return out;
}

/**
 * Build a docx `Document` from editor HTML.
 * @returns {{doc: Document, warnings: string[]}}
 */
export function buildDocx(html, { title = 'Document', pageSize = 'letter', layout } = {}) {
  const ctx = createContext(pageSize);
  const parsed = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  let children = blocksFrom(parsed.body, ctx);
  if (!children.length) children = [new Paragraph({ children: [] })];

  const headingStyle = (id, size) => ({ id, run: { font: FONT, size, bold: true }, paragraph: { spacing: { before: 240, after: 120 } } });
  const doc = new Document({
    creator: 'Pagewise',
    title,
    description: 'Created with Pagewise',
    numbering: numberingConfig(),
    styles: {
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        headingStyle('Heading1', 40),
        headingStyle('Heading2', 32),
        headingStyle('Heading3', 28),
        headingStyle('Heading4', 24),
        headingStyle('Heading5', 22),
        headingStyle('Heading6', 22),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: ctx.page.docx.width, height: ctx.page.docx.height },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        ...docxFurniture(layout),
        children,
      },
    ],
  });
  return { doc, warnings: Array.from(ctx.warnings) };
}

/** Browser entry point: returns a Blob ready to download. */
export async function htmlToDocxBlob(html, opts) {
  const { doc, warnings } = buildDocx(html, opts);
  const blob = await Packer.toBlob(doc);
  return { blob, warnings };
}

/** Node/test entry point. */
export async function htmlToDocxBuffer(html, opts) {
  const { doc, warnings } = buildDocx(html, opts);
  return { buffer: await Packer.toBuffer(doc), warnings };
}
