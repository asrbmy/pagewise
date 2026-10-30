/** Per-document page furniture: header text, footer text and page-number position. */
export const NUMBER_POSITIONS = {
  none: 'No page numbers',
  left: 'Footer, left',
  center: 'Footer, centre',
  right: 'Footer, right',
};

export const DEFAULT_LAYOUT = Object.freeze({ header: '', footer: '', pageNumbers: 'none' });
const MAX_TEXT = 150;

export function normalizeLayout(layout) {
  const l = layout && typeof layout === 'object' ? layout : {};
  const text = (v) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TEXT) : '');
  return {
    header: text(l.header),
    footer: text(l.footer),
    pageNumbers: Object.prototype.hasOwnProperty.call(NUMBER_POSITIONS, l.pageNumbers) ? l.pageNumbers : 'none',
  };
}

export const hasLayout = (l) => !!l && !!(l.header || l.footer || (l.pageNumbers && l.pageNumbers !== 'none'));

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
