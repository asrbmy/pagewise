/**
 * A small, format-neutral document model parsed from the editor's HTML. The ODT and RTF
 * writers render this model, so both agree on what is supported:
 *
 *   paragraphs and headings 1-6 (alignment, indent, spacing), block quotes, bullet and numbered
 *   lists (nested), tables (header cells, column/row spans), images (PNG/JPEG/GIF data URLs),
 *   horizontal rules, page breaks, and runs with bold / italic / underline / strike / sub /
 *   superscript / colour / highlight / font / size / links.
 *
 * Blocks: { kind: 'para' | 'table' | 'hr' | 'pagebreak' }.
 * Runs:   { text } | { br: true } | { image: { mime, bytes, width, height } }, with mark fields.
 */
import { parseDataUrl, imageSize } from './imageBytes.js';

const HEADINGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'HR', 'DIV', 'PRE', 'LI', 'SECTION', 'ARTICLE', 'MAIN']);
const NAMED = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080', orange: 'ffa500', purple: '800080' };

/** "#abc", "#aabbcc", "rgb(1,2,3)" or a basic colour name -> "aabbcc" (lower-case), else ''. */
export function hexColor(value) {
  if (!value) return '';
  const c = String(value).trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) return m[1];
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (m) return m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  return NAMED[c] || '';
}

/** CSS length -> points (pt/px/em/rem), or 0. */
export function toPoints(value, base = 11) {
  const m = /^(-?[\d.]+)\s*(pt|px|em|rem)?$/.exec(String(value || '').trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'px';
  if (unit === 'pt') return n;
  if (unit === 'px') return n * 0.75;
  return n * base;
}

const firstFont = (f) => (f ? f.split(',')[0].replace(/["']/g, '').trim() : '');

function marksFor(el, tag, marks) {
  const next = { ...marks };
  if (tag === 'STRONG' || tag === 'B') next.bold = true;
  if (tag === 'EM' || tag === 'I') next.italic = true;
  if (tag === 'U') next.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
  if (tag === 'SUB') next.sub = true;
  if (tag === 'SUP') next.sup = true;
  if (tag === 'CODE') next.font = 'Courier New';
  if (tag === 'MARK') next.bg = hexColor(el.style.backgroundColor) || hexColor(el.getAttribute('data-color')) || 'fef08a';
  const st = el.style;
  if (st) {
    if (st.color) next.color = hexColor(st.color) || next.color;
    if (st.backgroundColor && tag !== 'MARK') next.bg = hexColor(st.backgroundColor) || next.bg;
    if (st.fontSize) next.size = toPoints(st.fontSize) || next.size;
    if (st.fontFamily) next.font = firstFont(st.fontFamily) || next.font;
    if (/underline/.test(st.textDecoration || '')) next.underline = true;
    if (/line-through/.test(st.textDecoration || '')) next.strike = true;
  }
  return next;
}

function readImage(el, warnings) {
  const parsed = parseDataUrl(el.getAttribute('src') || '');
  if (!parsed || !/^image\/(png|jpe?g|gif)$/.test(parsed.mime)) {
    warnings.add('Images that are linked from the web or are not PNG/JPEG/GIF were replaced by their description.');
    return { text: el.getAttribute('alt') ? `[${el.getAttribute('alt')}]` : '[image]' };
  }
  const natural = imageSize(parsed.bytes, parsed.mime) || { width: 300, height: 200 };
  const pct = parseFloat(el.getAttribute('data-width') || '');
  let width = natural.width;
  let height = natural.height;
  if (pct > 0) {
    width = Math.round(6.5 * 96 * (pct / 100));
    height = Math.round((width * natural.height) / natural.width);
  }
  const maxW = 6.5 * 96;
  if (width > maxW) {
    height = Math.round((height * maxW) / width);
    width = maxW;
  }
  return { image: { mime: parsed.mime, bytes: parsed.bytes, width, height } };
}

function inlineRuns(node, marks, ctx) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const text = child.nodeValue.replace(/[\r\n]+/g, ' ');
      if (text) runs.push({ ...marks, text });
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName;
    if (tag === 'BR') return runs.push({ br: true });
    if (tag === 'IMG') return runs.push({ ...readImage(child, ctx.warnings) });
    if (BLOCK_TAGS.has(tag)) return runs.push(...inlineRuns(child, marks, ctx));
    const next = marksFor(child, tag, marks);
    if (tag === 'A' && /^(https?:|mailto:|tel:)/i.test(child.getAttribute('href') || '')) next.href = child.getAttribute('href');
    runs.push(...inlineRuns(child, next, ctx));
    return undefined;
  });
  return runs;
}

function paraFormat(el) {
  const st = el.style || {};
  const fmt = {};
  if (['center', 'right', 'justify'].includes(st.textAlign)) fmt.align = st.textAlign;
  const indent = parseInt(el.getAttribute('data-indent') || '0', 10);
  if (indent) fmt.indent = indent; // levels of 0.5 inch
  const before = toPoints(st.marginTop);
  const after = toPoints(st.marginBottom);
  if (before) fmt.before = before;
  if (after || after === 0 && st.marginBottom) fmt.after = after;
  const lh = parseFloat(st.lineHeight || '');
  if (lh > 0) fmt.lineHeight = lh;
  return fmt;
}

function trimRuns(runs) {
  const out = runs.filter((r) => r.br || r.image || r.text !== '');
  if (out.length && out[0].text) out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const last = out.length - 1;
  if (last >= 0 && out[last].text) out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, '') };
  return out.filter((r) => r.br || r.image || r.text !== '');
}

function para(el, extra, ctx) {
  const tag = el.tagName;
  const block = { kind: 'para', heading: HEADINGS[tag] || 0, ...paraFormat(el), ...extra, runs: [] };
  block.runs = trimRuns(inlineRuns(el, tag === 'PRE' ? { font: 'Courier New' } : {}, ctx));
  return block;
}

function listBlocks(listEl, depth, ctx, out) {
  const ordered = listEl.tagName === 'OL';
  let num = parseInt(listEl.getAttribute('start') || '1', 10) || 1;
  Array.from(listEl.children).forEach((li) => {
    if (li.tagName !== 'LI') return;
    let first = true;
    const flush = (runsEl, fmtEl) => {
      const b = para(runsEl, { ...(fmtEl ? paraFormat(fmtEl) : {}), list: { ordered, depth, num, first } }, ctx);
      first = false;
      out.push(b);
    };
    const inlineHolder = li.ownerDocument.createElement('span');
    const flushInline = () => {
      if (inlineHolder.childNodes.length) {
        flush(inlineHolder);
        while (inlineHolder.firstChild) inlineHolder.removeChild(inlineHolder.firstChild);
      }
    };
    Array.from(li.childNodes).forEach((c) => {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
        flushInline();
        listBlocks(c, depth + 1, ctx, out);
      } else if (c.nodeType === 1 && c.tagName === 'P') {
        flushInline();
        flush(c, c);
      } else inlineHolder.appendChild(c.cloneNode(true));
    });
    flushInline();
    if (first) out.push({ kind: 'para', heading: 0, list: { ordered, depth, num, first: true }, runs: [] });
    num += 1;
  });
}

function cellBlocks(cell, ctx) {
  const out = [];
  blocksFrom(cell, ctx, out, {});
  return out.length ? out : [{ kind: 'para', heading: 0, runs: [] }];
}

function tableBlock(table, ctx) {
  const rows = [];
  table.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr').forEach((tr) => {
    const cells = [];
    Array.from(tr.children).forEach((c) => {
      if (c.tagName !== 'TD' && c.tagName !== 'TH') return;
      cells.push({
        header: c.tagName === 'TH',
        colspan: Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1),
        rowspan: Math.max(1, parseInt(c.getAttribute('rowspan') || '1', 10) || 1),
        blocks: cellBlocks(c, ctx),
      });
    });
    if (cells.length) rows.push({ cells });
  });
  return { kind: 'table', rows };
}

function blocksFrom(root, ctx, out, extra) {
  const loose = [];
  const flushLoose = () => {
    if (!loose.length) return;
    const holder = root.ownerDocument.createElement('p');
    loose.forEach((n) => holder.appendChild(n.cloneNode(true)));
    const b = para(holder, extra, ctx);
    if (b.runs.length) out.push(b);
    loose.length = 0;
  };
  Array.from(root.childNodes).forEach((n) => {
    if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK_TAGS.has(n.tagName))) {
      loose.push(n);
      return;
    }
    if (n.nodeType !== 1) return;
    flushLoose();
    const tag = n.tagName;
    if (tag === 'P' || HEADINGS[tag] || tag === 'PRE') out.push(para(n, extra, ctx));
    else if (tag === 'UL' || tag === 'OL') listBlocks(n, 0, ctx, out);
    else if (tag === 'TABLE') out.push(tableBlock(n, ctx));
    else if (tag === 'HR') out.push({ kind: 'hr' });
    else if (tag === 'BLOCKQUOTE') blocksFrom(n, ctx, out, { ...extra, quote: true });
    else if (tag === 'DIV' && n.getAttribute('data-type') === 'page-break') out.push({ kind: 'pagebreak' });
    else blocksFrom(n, ctx, out, extra); // DIV, SECTION, TOC wrapper, ...
  });
  flushLoose();
}

/**
 * Parse editor HTML into blocks.
 * @returns {{blocks: object[], warnings: string[]}}
 */
export function parseDocument(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const ctx = { warnings: new Set() };
  const blocks = [];
  blocksFrom(doc.body, ctx, blocks, {});
  return { blocks, warnings: [...ctx.warnings] };
}
