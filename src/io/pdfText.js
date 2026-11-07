/**
 * A real text PDF ("vector"): text is drawn with PDF fonts instead of page images, so files are small,
 * sharp at any zoom and fully selectable. It lays out the shared document model (src/io/model.js) itself, so it
 * is simpler than the on-screen look: no page-gap tricks, tables use equal column widths and rows never split.
 * Non-Latin text (Greek, Cyrillic, Hebrew, Arabic) uses the bundled DejaVu Sans, without bold/italic;
 * Chinese, Japanese and Korean are not available in this format (use the standard PDF for those).
 */
import { parseDocument } from './model.js';
import { sanitizeHtml } from './sanitize.js';
import { pageGeometry } from '../editor/layout.js';
import { stampPageFurniture, needsUnicodeFont, toLatin1, toUnicodeText, loadUnicodeFont, UNICODE_FONT } from './pdf.js';

const MARGIN = 72;
const BASE = 11;
const HEADING_PT = { 1: 20, 2: 16, 3: 13.5, 4: 12, 5: 11, 6: 10 };
const CJK = /[⺀-鿿가-힯豈-﫿぀-ヿ]/;

const family = (name = '') => (/courier|mono|consolas|menlo/i.test(name) ? 'courier' : /times|georgia|palatino|serif/i.test(name) && !/sans/i.test(name) ? 'times' : 'helvetica');
const rgb = (hex, fallback = [0, 0, 0]) => (hex && hex.length === 6 ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] : fallback);

export async function buildTextPdf({ title = 'Untitled document', html, pageSize = 'letter', layout }) {
  const { jsPDF } = await import('jspdf');
  const page = pageGeometry(pageSize, layout);
  const pdf = new jsPDF({ unit: 'pt', format: pageSize === 'a4' ? 'a4' : 'letter', orientation: page.landscape ? 'landscape' : 'portrait', compress: true });
  pdf.setProperties({ title });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const contentW = W - MARGIN * 2;
  const bottom = H - MARGIN;

  const safe = sanitizeHtml(html);
  const { blocks, warnings: modelWarnings } = parseDocument(safe);
  const warnings = [...modelWarnings];
  if (page.columns > 1) warnings.push('Columns are not laid out in PDF export; the text appears in a single column. Word, ODT, RTF, web page and Print keep the columns.');
  const plain = new DOMParser().parseFromString(`<body>${safe}</body>`, 'text/html').body.textContent || '';

  let unicode = false;
  if (needsUnicodeFont(plain)) {
    try {
      pdf.addFileToVFS('DejaVuSans.ttf', await loadUnicodeFont());
      pdf.addFont('DejaVuSans.ttf', UNICODE_FONT, 'normal');
      unicode = true;
      warnings.push('This text PDF uses one regular font for non-Latin text, so bold and italic are not shown there.');
    } catch {
      warnings.push('The font for non-Latin text could not be loaded; those characters are left out of this PDF.');
    }
  }
  if (CJK.test(plain)) warnings.push('Chinese, Japanese and Korean text cannot be drawn in the text PDF. Use "PDF document" for those.');
  if (/data-type="math"|data-latex/.test(safe)) warnings.push('Equations appear as LaTeX text in the text PDF.');

  const clean = (t) => (unicode ? toUnicodeText(t) : toLatin1(t));
  const setFont = (r, size) => {
    if (unicode) pdf.setFont(UNICODE_FONT, 'normal');
    else pdf.setFont(family(r.font), r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal');
    pdf.setFontSize(size);
  };
  const sizeOf = (r, block) => (r.size || (block.heading ? HEADING_PT[block.heading] : BASE)) * (r.sub || r.sup ? 0.7 : 1);

  /** Break a paragraph into lines of positioned pieces. Returns { lines, height }. */
  const layoutPara = (block, width) => {
    const lines = [];
    let line = { items: [], w: 0, h: 0, ascent: 0 };
    const newLine = () => { lines.push(line); line = { items: [], w: 0, h: 0, ascent: 0 }; };
    const defaultSize = block.heading ? HEADING_PT[block.heading] : BASE;
    const lhf = (block.lineHeight || 1.15) * 1.0;
    const forced = block.heading ? { bold: true } : {};
    for (const run of block.runs) {
      if (run.br) { line.h = Math.max(line.h, defaultSize * 1.2 * lhf); newLine(); continue; }
      if (run.image) {
        if (line.items.length) newLine();
        lines.push({ items: [{ image: run.image }], w: 0, h: Math.min(run.image.height * 0.75, 600) + 4, image: true });
        continue;
      }
      const r = { ...forced, ...run };
      const size = sizeOf(r, block);
      setFont(r, size);
      const rawTokens = clean(r.text).match(/\s+|\S+/g) || [];
      // A single word wider than the line is cut into pieces that fit.
      const tokens = [];
      for (const tk of rawTokens) {
        if (/^\s+$/.test(tk) || pdf.getTextWidth(tk) <= width) { tokens.push(tk); continue; }
        let piece = '';
        for (const chr of Array.from(tk)) {
          if (pdf.getTextWidth(piece + chr) > width && piece) { tokens.push(piece); piece = ''; }
          piece += chr;
        }
        if (piece) tokens.push(piece);
      }
      for (const tok of tokens) {
        const isSpace = /^\s+$/.test(tok);
        const text = isSpace ? ' ' : tok;
        const tw = pdf.getTextWidth(text);
        if (!isSpace && line.w + tw > width && line.items.length) {
          // drop trailing space on the finished line
          const last = line.items[line.items.length - 1];
          if (last.space) { line.w -= last.w; line.items.pop(); }
          newLine();
        }
        if (isSpace && !line.items.length) continue; // no leading spaces on wrapped lines
        line.items.push({ text, w: tw, size, r, space: isSpace });
        line.w += tw;
        line.h = Math.max(line.h, size * 1.2 * lhf);
      }
    }
    if (line.items.length || !lines.length) {
      if (!line.h) line.h = defaultSize * 1.2 * lhf;
      lines.push(line);
    }
    return { lines, height: lines.reduce((s, l) => s + l.h, 0) };
  };

  let y = MARGIN;
  const ensure = (h) => {
    if (y + h > bottom && y > MARGIN) { pdf.addPage(); y = MARGIN; }
  };

  /** Draw laid-out lines with their left edge at x inside a column `width` wide; breaks pages when `paginate`. */
  const drawLines = (lines, x, width, align, paginate) => {
    for (const ln of lines) {
      if (paginate) ensure(ln.h);
      if (ln.image) {
        const im = ln.items[0].image;
        const w = Math.min(im.width * 0.75, width);
        const h = (im.height * 0.75 * w) / (im.width * 0.75);
        try {
          pdf.addImage(im.bytes, im.mime === 'image/png' ? 'PNG' : 'JPEG', align === 'center' ? x + (width - w) / 2 : x, y, w, h);
        } catch { /* unsupported image data: leave a gap */ }
        y += h + 4;
        continue;
      }
      let cx = x;
      if (align === 'center') cx = x + (width - ln.w) / 2;
      else if (align === 'right') cx = x + width - ln.w;
      const baseY = y + ln.h * 0.78;
      for (const it of ln.items) {
        const r = it.r;
        const shift = r.sup ? -it.size * 0.45 : r.sub ? it.size * 0.2 : 0;
        if (r.bg && !it.space) { pdf.setFillColor(...rgb(r.bg)); pdf.rect(cx, y, it.w, ln.h, 'F'); }
        if (!it.space || r.underline || r.strike) {
          setFont(r, it.size);
          pdf.setTextColor(...rgb(r.color));
          if (!it.space) pdf.text(it.text, cx, baseY + shift);
          pdf.setDrawColor(...rgb(r.color));
          pdf.setLineWidth(0.5);
          if (r.underline) pdf.line(cx, baseY + 1.5 + shift, cx + it.w, baseY + 1.5 + shift);
          if (r.strike) pdf.line(cx, baseY - it.size * 0.3 + shift, cx + it.w, baseY - it.size * 0.3 + shift);
        }
        if (r.href && !it.space) pdf.link(cx, y, it.w, ln.h, { url: r.href });
        cx += it.w;
      }
      y += ln.h;
    }
  };

  const withBullet = (block) => {
    if (!block.list) return { block, indent: 0, marker: '' };
    const indent = 18 + block.list.depth * 18;
    const marker = block.list.first ? (block.list.ordered ? `${block.list.num}.` : '•') : '';
    return { block, indent, marker };
  };

  const drawPara = (block, x, width, paginate) => {
    const { indent, marker } = withBullet(block);
    const quote = block.quote ? 24 : 0;
    const left = x + quote + indent + (block.indent ? block.indent * 36 : 0);
    const colW = width - (left - x);
    const { lines, height } = layoutPara(block, colW);
    const before = block.before ?? (block.heading ? 10 : 0);
    const after = block.after ?? (block.heading ? 4 : 6);
    if (paginate) ensure(Math.min(height, 120) + before);
    y += before;
    const top = y;
    if (marker) {
      const first = lines[0];
      pdf.setTextColor(0, 0, 0);
      if (block.list.ordered) {
        setFont({}, BASE);
        pdf.text(clean(marker), left - 6, top + (first ? first.h * 0.78 : 9), { align: 'right' });
      } else {
        pdf.setFillColor(0, 0, 0);
        pdf.circle(left - 10, top + (first ? first.h * 0.55 : 7), 1.7, 'F'); // a drawn dot: no font needed
      }
    }
    drawLines(lines, left, colW, block.align || (block.rtl ? 'right' : 'left'), paginate);
    if (block.quote) {
      pdf.setDrawColor(190, 190, 190);
      pdf.setLineWidth(2);
      pdf.line(x + 8, top, x + 8, Math.max(top + 4, y));
    }
    y += after;
  };

  const drawTable = (block) => {
    const cols = Math.max(1, ...block.rows.map((r) => r.cells.reduce((n, c) => n + c.colspan, 0)));
    const colW = contentW / cols;
    const PAD = 4;
    for (const row of block.rows) {
      // lay out every cell, find the tallest
      let col = 0;
      const laid = row.cells.map((cell) => {
        const w = colW * cell.colspan;
        const x = MARGIN + col * colW;
        col += cell.colspan;
        let h = PAD * 2;
        const paras = cell.blocks.filter((b) => b.kind === 'para').map((b) => {
          const l = layoutPara(cell.header ? { ...b, runs: b.runs.map((r) => ({ bold: true, ...r })) } : b, w - PAD * 2);
          h += l.height;
          return l;
        });
        return { cell, w, x, paras, h };
      });
      const rowH = Math.max(...laid.map((c) => c.h));
      ensure(rowH);
      const top = y;
      for (const c of laid) {
        if (c.cell.header) { pdf.setFillColor(241, 243, 244); pdf.rect(c.x, top, c.w, rowH, 'F'); }
        pdf.setDrawColor(150, 150, 150);
        pdf.setLineWidth(0.5);
        pdf.rect(c.x, top, c.w, rowH);
        y = top + PAD;
        for (const l of c.paras) drawLines(l.lines, c.x + PAD, c.w - PAD * 2, 'left', false);
      }
      y = top + rowH;
    }
    y += 8;
  };

  for (const block of blocks) {
    if (block.kind === 'para') {
      if (!block.runs.length && !block.list) { y += BASE * 1.2; continue; }
      drawPara(block, MARGIN, contentW, true);
    } else if (block.kind === 'table') drawTable(block);
    else if (block.kind === 'hr') {
      ensure(12);
      pdf.setDrawColor(160, 160, 160);
      pdf.setLineWidth(0.75);
      pdf.line(MARGIN, y + 6, W - MARGIN, y + 6);
      y += 14;
    } else if (block.kind === 'pagebreak') {
      pdf.addPage();
      y = MARGIN;
    }
  }

  stampPageFurniture(pdf, layout);
  return { blob: pdf.output('blob'), warnings, pages: pdf.getNumberOfPages(), _page: page };
}
