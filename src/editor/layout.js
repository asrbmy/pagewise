import { PAGE_SIZES } from './constants.js';

/** Per-document page furniture: header text, footer text and page-number position. */
export const NUMBER_POSITIONS = {
  none: 'No page numbers',
  left: 'Footer, left',
  center: 'Footer, centre',
  right: 'Footer, right',
};

export const DEFAULT_LAYOUT = Object.freeze({ header: '', footer: '', pageNumbers: 'none', orientation: 'portrait', columns: 1 });
export const MAX_COLUMNS = 3;
export const COLUMN_GAP_PX = 36; // 0.375 inch
const MAX_TEXT = 150;

export function normalizeLayout(layout) {
  const l = layout && typeof layout === 'object' ? layout : {};
  const text = (v) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TEXT) : '');
  return {
    header: text(l.header),
    footer: text(l.footer),
    pageNumbers: Object.prototype.hasOwnProperty.call(NUMBER_POSITIONS, l.pageNumbers) ? l.pageNumbers : 'none',
    orientation: l.orientation === 'landscape' ? 'landscape' : 'portrait',
    columns: Number.isInteger(l.columns) && l.columns >= 1 && l.columns <= MAX_COLUMNS ? l.columns : 1,
  };
}

export const hasLayout = (l) =>
  !!l && !!(l.header || l.footer || (l.pageNumbers && l.pageNumbers !== 'none') || l.orientation === 'landscape' || l.columns > 1);

/**
 * Page geometry for a paper size and layout. `width`/`height` are CSS px at 96 dpi after
 * orientation; `docx` is in twips, already swapped for landscape.
 */
export function pageGeometry(pageSize, layout, sizes = PAGE_SIZES) {
  const base = sizes[pageSize] || sizes.letter;
  const l = normalizeLayout(layout);
  const landscape = l.orientation === 'landscape';
  return {
    ...base,
    width: landscape ? base.height : base.width,
    height: landscape ? base.width : base.height,
    docx: landscape ? { width: base.docx.height, height: base.docx.width } : base.docx,
    css: `${base.css}${landscape ? ' landscape' : ''}`,
    landscape,
    columns: l.columns,
  };
}

/** Escape text for a CSS string literal (used in @page margin boxes). */
export const cssString = (s) => `"${String(s).replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, ' ').replace(/</g, '\\3c ')}"`;

/**
 * @page rules that print the header, footer and page numbers in the page margins.
 * Margin boxes are supported by Chromium-based browsers; other browsers print without them.
 */
export function pageMarginRules(layout) {
  const l = normalizeLayout(layout);
  const rules = [];
  if (l.header) rules.push(`@top-center { content: ${cssString(l.header)}; font: 9pt sans-serif; color: #555; }`);
  const pos = l.pageNumbers;
  const num = 'counter(page)';
  const footerBox = (side, content) => `@bottom-${side} { content: ${content}; font: 9pt sans-serif; color: #555; }`;
  if (l.footer && pos === 'center') rules.push(footerBox('center', `${cssString(l.footer + ' · Page ')} ${num}`));
  else {
    if (l.footer) rules.push(footerBox('center', cssString(l.footer)));
    if (pos !== 'none') rules.push(footerBox(pos, `${cssString('Page ')} ${num}`));
  }
  return rules.join(' ');
}
