import { FONT_FAMILIES } from './constants.js';

/** Document-wide defaults for body text and headings: the "styles" of a document. */
export const STYLE_KEYS = ['normal', 'h1', 'h2', 'h3'];
const SELECTORS = { normal: 'p', h1: 'h1', h2: 'h2', h3: 'h3' };
const HEX = /^#[0-9a-fA-F]{6}$/;
const FONTS = new Set(FONT_FAMILIES.map((f) => f.value).filter(Boolean));

export const EMPTY_STYLES = Object.freeze({});

/** Keep only valid settings. Missing settings mean "use the built-in look". */
export function normalizeStyles(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of STYLE_KEYS) {
    const s = input[key];
    if (!s || typeof s !== 'object') continue;
    const clean = {};
    if (typeof s.font === 'string' && FONTS.has(s.font)) clean.font = s.font;
    if (Number.isFinite(s.size) && s.size >= 6 && s.size <= 96) clean.size = Math.round(s.size * 2) / 2;
    if (typeof s.color === 'string' && HEX.test(s.color)) clean.color = s.color.toLowerCase();
    if (typeof s.bold === 'boolean') clean.bold = s.bold;
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

export const hasStyles = (styles) => !!styles && Object.keys(normalizeStyles(styles)).length > 0;

const declarations = (s) =>
  [
    s.font && `font-family: ${s.font}`,
    s.size && `font-size: ${s.size}pt`,
    s.color && `color: ${s.color}`,
    s.bold !== undefined && `font-weight: ${s.bold ? 700 : 400}`,
  ]
    .filter(Boolean)
    .join('; ');

/** CSS for the editor (all values come from normalizeStyles, so nothing user-typed reaches the stylesheet). */
export function stylesCss(styles) {
  const n = normalizeStyles(styles);
  return STYLE_KEYS.filter((k) => n[k])
    .map((k) => `.pw-prose ${SELECTORS[k]} { ${declarations(n[k])} }`)
    .join('\n');
}

/**
 * Bake the styles into HTML for export: each paragraph/heading's content is wrapped in a span carrying the
 * style, so every exporter (which reads inline styles) sees it. Text with its own formatting keeps it, because
 * its own spans are nested inside. Captions and table-of-contents lines keep the Normal style too.
 */
export function applyStylesToHtml(html, styles) {
  const n = normalizeStyles(styles);
  if (!html || !Object.keys(n).length) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const key of STYLE_KEYS) {
    if (!n[key]) continue;
    const css = declarations(n[key]);
    doc.body.querySelectorAll(SELECTORS[key]).forEach((el) => {
      if (!el.firstChild) return;
      const span = doc.createElement('span');
      span.setAttribute('style', css);
      while (el.firstChild) span.appendChild(el.firstChild);
      el.appendChild(span);
    });
  }
  return doc.body.innerHTML;
}
