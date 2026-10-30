/**
 * Client-side PDF export.
 *
 * The document is rendered off-screen at its real page width with html2canvas, then laid out onto
 * PDF pages with jsPDF. To stay inside browser canvas-size limits (iOS Safari is the tightest) the
 * document is rendered in batches of top-level blocks, and each batch is sliced across pages.
 * Page slices are cut at blank pixel rows so lines of text are not sliced in half.
 *
 * Text: the visible page is an image, but an invisible text layer is placed over it (PDF text
 * rendering mode 3), so the text can be selected, copied and searched. The invisible layer uses a
 * standard PDF font, so characters outside Latin-1 are not searchable. For a PDF with true
 * vector text, use File -> Print and choose "Save as PDF".
 */
import { sanitizeHtml } from './sanitize.js';
import { normalizeLayout } from '../editor/layout.js';
import { documentCss } from './docStyles.js';
import { PAGE_SIZES, PAGE_MARGIN } from '../editor/constants.js';

const MARGIN_PT = 72;
const SCALE = 2;
const BATCH_CSS_PX = 3200; // ~3 pages of content per canvas
const MAX_CANVAS_EDGE = 14000;

/** Split editor HTML into sections at hard page breaks. */
export function splitAtPageBreaks(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const sections = [[]];
  Array.from(doc.body.childNodes).forEach((n) => {
    if (n.nodeType === 1 && n.getAttribute('data-type') === 'page-break') sections.push([]);
    else sections[sections.length - 1].push(n);
  });
  return sections.map((nodes) => nodes.filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())));
}

/**
 * Group consecutive blocks so each group is at most `limit` pixels tall (a single oversize
 * block gets its own group). `rects` are [top, bottom] pairs in document order.
 * @returns {number[][]} arrays of block indexes
 */
export function groupBlocks(rects, limit = BATCH_CSS_PX) {
  const groups = [];
  let current = [];
  let startTop = 0;
  rects.forEach(([top, bottom], i) => {
    if (!current.length) {
      current = [i];
      startTop = top;
    } else if (bottom - startTop > limit) {
      groups.push(current);
      current = [i];
      startTop = top;
    } else current.push(i);
  });
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Given RGBA pixel data of `rows` rows (width `w`), return how many rows (from the top) to keep so
 * the cut falls on a blank (all near-white) row, searching upward from the bottom. Falls back to
 * all rows when no blank row exists in the searched range.
 */
export function findCutRow(data, w, rows, searchRows) {
  const isBlank = (y) => {
    const base = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const i = base + x * 4;
      if (data[i + 3] > 0 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) return false;
    }
    return true;
  };
  const stop = Math.max(1, rows - searchRows);
  for (let y = rows - 1; y >= stop; y -= 1) if (isBlank(y)) return y + 1;
  return rows;
}

/** Words in `root` with their boxes in CSS px relative to `root`'s top-left. */
export function collectWords(root) {
  const base = root.getBoundingClientRect();
  const words = [];
  const walker = (root.ownerDocument || document).createTreeWalker(root, 4 /* SHOW_TEXT */);
  const range = (root.ownerDocument || document).createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    const re = /\S+/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (r && r.width > 0 && r.height > 0) {
        words.push({ t: m[0], x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
      }
    }
  }
  return words;
}

/** Scripts and symbol blocks the bundled DejaVu Sans covers (Latin extended, Greek, Cyrillic, Hebrew, Arabic, symbols). */
const UNICODE_OK = /[\u0000-\u06ff\u0750-\u077f\u1e00-\u1fff\u2000-\u2bff\ufb00-\ufdff\ufe70-\ufeff]/;
const LATIN1_OR_PUNCT = /^[\u0000-\u00ff\u2018\u2019\u201c\u201d\u2013\u2014\u2026]*$/;

/** True when the text needs more than the standard PDF fonts to be selectable. */
export const needsUnicodeFont = (text) => !LATIN1_OR_PUNCT.test(text);

/** Characters the Unicode font can carry; everything else (e.g. CJK) is left out of the text layer. */
export function toUnicodeText(text) {
  return Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')).filter((c) => UNICODE_OK.test(c)).join('');
}

/** Keep only characters a standard PDF font (WinAnsi) can draw. */
export function toLatin1(text) {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/[^\x20-\x7e\xa0-\xff]/g, '');
}

async function renderBatches(host, nodes, html2canvas, widthPx) {
  const doc = host.querySelector('.doc');
  doc.replaceChildren(...nodes.map((n) => n.cloneNode(true)));
  const top0 = doc.getBoundingClientRect().top;
  const rects = Array.from(doc.children).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return [r.top - top0 - parseFloat(cs.marginTop || 0), r.bottom - top0 + parseFloat(cs.marginBottom || 0)];
  });
  // Text nodes at the top level are rare (the editor wraps text in paragraphs); render as one group.
  const groups = groupBlocks(rects.length ? rects : [[0, doc.scrollHeight]]);
  const blocks = Array.from(doc.children);
  const canvases = [];
  for (const group of groups) {
    doc.replaceChildren(...group.map((i) => (blocks[i] || doc).cloneNode(true)));
    const height = Math.max(1, Math.ceil(doc.getBoundingClientRect().height));
    const scale = Math.max(0.5, Math.min(SCALE, MAX_CANVAS_EDGE / height));
    const words = collectWords(doc);
    const docTop = doc.getBoundingClientRect().top - host.getBoundingClientRect().top;
    // eslint-disable-next-line no-await-in-loop
    const canvas = await html2canvas(host, { scale, backgroundColor: '#ffffff', logging: false, useCORS: false, windowWidth: widthPx, width: widthPx });
    // Word boxes in canvas pixels (canvas top = host top).
    const k = canvas.width / widthPx;
    canvases.push({ canvas, words: words.map((w) => ({ t: w.t, x: w.x * k, y: (w.y + docTop) * k, w: w.w * k, h: w.h * k })) });
  }
  return canvases;
}

const UNICODE_FONT = 'DejaVuSans';
let fontBinary = null;

/** Fetch the bundled font once (a ~750 KB file served with the app, cached for offline use). */
async function loadUnicodeFont() {
  if (!fontBinary) {
    const url = `${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font request failed (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    fontBinary = bin;
  }
  return fontBinary;
}

/** Invisible, selectable text over the slice of the page image covering canvas rows [srcY, srcY + sliceH). */
function addTextLayer(pdf, words, srcY, sliceH, ptPerPx, left, top, unicode) {
  pdf.setFont(unicode ? UNICODE_FONT : 'helvetica', 'normal');
  for (const w of words) {
    const mid = w.y + w.h / 2;
    if (mid < srcY || mid >= srcY + sliceH) continue;
    const t = unicode ? toUnicodeText(w.t) : toLatin1(w.t);
    if (!t) continue;
    const boxW = w.w * ptPerPx;
    const boxH = w.h * ptPerPx;
    pdf.setFontSize(10);
    const natural = pdf.getTextWidth(t) || 1;
    // Size the glyphs so the word spans its on-page width; keeps selection boxes aligned.
    const size = Math.max(2, Math.min(boxH * 1.1, (10 * boxW) / natural));
    pdf.setFontSize(size);
    pdf.text(t, left + w.x * ptPerPx, top + (w.y - srcY) * ptPerPx + boxH * 0.8, { renderingMode: 'invisible' });
  }
}

/** Header, footer and "Page n of N" on every PDF page (real text, so it is selectable). */
export function stampPageFurniture(pdf, layout) {
  const l = normalizeLayout(layout);
  if (!l.header && !l.footer && l.pageNumbers === 'none') return;
  const total = pdf.getNumberOfPages();
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(85, 85, 85);
  const at = { left: [MARGIN_PT, 'left'], center: [w / 2, 'center'], right: [w - MARGIN_PT, 'right'] };
  for (let n = 1; n <= total; n += 1) {
    pdf.setPage(n);
    if (l.header) pdf.text(toLatin1(l.header), w / 2, MARGIN_PT / 2 + 4, { align: 'center' });
    if (l.footer) pdf.text(toLatin1(l.footer), w / 2, h - MARGIN_PT / 2 + 4, { align: 'center' });
    if (l.pageNumbers !== 'none') {
      const [x, align] = at[l.pageNumbers];
      // Avoid colliding with centred footer text.
      const y = h - MARGIN_PT / 2 + 4 + (l.footer && l.pageNumbers === 'center' ? 12 : 0);
      pdf.text(`Page ${n} of ${total}`, x, y, { align });
    }
  }
}

/**
 * @param {{title:string, html:string, pageSize?:'letter'|'a4'}} doc
 * @returns {Promise<{blob: Blob, warnings: string[]}>}
 */
export async function buildPdf({ title, html, pageSize = 'letter', layout }) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const page = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
  const contentPx = page.width - PAGE_MARGIN * 2;
  const pdf = new jsPDF({ unit: 'pt', format: pageSize === 'a4' ? 'a4' : 'letter', compress: true });
  pdf.setProperties({ title: title || 'Untitled document', creator: 'Pagewise' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN_PT * 2;
  const bottom = pageH - MARGIN_PT;

  const safe = sanitizeHtml(html);
  const sections = splitAtPageBreaks(safe);
  const warnings = [];
  if (/<img[^>]+src="https?:/i.test(safe)) warnings.push('Images linked from the web may be missing from the PDF (browsers block reading them). Uploaded images are included.');

  let unicode = false;
  const plain = new DOMParser().parseFromString(`<body>${safe}</body>`, 'text/html').body.textContent || '';
  if (needsUnicodeFont(plain)) {
    try {
      pdf.addFileToVFS('DejaVuSans.ttf', await loadUnicodeFont());
      pdf.addFont('DejaVuSans.ttf', UNICODE_FONT, 'normal');
      unicode = true;
    } catch {
      warnings.push('The text-selection font could not be loaded, so text outside basic Latin cannot be selected in this PDF. It still looks correct.');
    }
  }
  if (unicode && /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\u3040-\u30ff]/.test(plain)) {
    warnings.push('Chinese, Japanese and Korean text is shown correctly in the PDF but cannot be selected or searched there.');
  }

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // Rendered behind the app (z-index -1) rather than off-screen: html2canvas captures blank output
  // for elements positioned outside the viewport.
  host.style.cssText = `position:fixed;left:0;top:0;width:${contentPx}px;background:#fff;z-index:-1;pointer-events:none;`;
  host.innerHTML = `<style>${documentCss(pageSize)} .doc{padding:0!important;max-width:none!important;margin:0!important}</style><div class="doc"></div>`;
  document.body.appendChild(host);

  let y = MARGIN_PT;
  let firstOnPage = true;
  const newPage = () => {
    pdf.addPage();
    y = MARGIN_PT;
    firstOnPage = true;
  };

  try {
    for (let s = 0; s < sections.length; s += 1) {
      if (s > 0) newPage();
      if (!sections[s].length) continue;
      // eslint-disable-next-line no-await-in-loop
      const canvases = await renderBatches(host, sections[s], html2canvas, contentPx);
      for (const { canvas, words } of canvases) {
        const ptPerPx = contentW / canvas.width;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let srcY = 0;
        while (srcY < canvas.height) {
          const remainPx = Math.floor((bottom - y) / ptPerPx);
          if (remainPx < 8 && !firstOnPage) {
            newPage();
            continue;
          }
          let sliceH = Math.min(canvas.height - srcY, Math.max(remainPx, 8));
          if (srcY + sliceH < canvas.height) {
            const search = Math.floor(sliceH * 0.15);
            const data = ctx.getImageData(0, srcY + sliceH - search, canvas.width, search).data;
            const kept = findCutRow(data, canvas.width, search, search);
            sliceH = sliceH - search + kept;
          }
          const slice = document.createElement('canvas');
          slice.width = canvas.width;
          slice.height = sliceH;
          const sctx = slice.getContext('2d');
          sctx.fillStyle = '#fff';
          sctx.fillRect(0, 0, slice.width, slice.height);
          sctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_PT, y, contentW, sliceH * ptPerPx, undefined, 'FAST');
          addTextLayer(pdf, words, srcY, sliceH, ptPerPx, MARGIN_PT, y, unicode);
          y += sliceH * ptPerPx;
          srcY += sliceH;
          firstOnPage = false;
          if (srcY < canvas.height) newPage();
        }
      }
    }
  } finally {
    host.remove();
  }
  stampPageFurniture(pdf, layout);
  return { blob: pdf.output('blob'), warnings };
}
