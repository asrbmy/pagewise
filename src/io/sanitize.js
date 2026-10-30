/**
 * HTML sanitising for anything that did not come from the editor itself
 * (imported files, backups, pasted content, exported HTML). The editor's schema already drops
 * unknown markup, but sanitising first keeps scripts, event handlers, tracking beacons and odd
 * URLs out of storage and out of exported HTML files.
 *
 * Layers: DOMPurify (tags/attributes/URL schemes) + a CSS property allow-list for `style`
 * attributes + an image URL policy. Each layer is covered by tests/security.test.js.
 */
import DOMPurify from 'dompurify';

const CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'audio', 'video', 'source', 'track', 'picture', 'template'],
  FORBID_ATTR: ['srcset', 'ping', 'formaction', 'action', 'background', 'poster', 'xlink:href', 'srcdoc'],
  ADD_ATTR: ['target', 'data-type', 'data-indent', 'data-space-before', 'data-space-after', 'data-width', 'colspan', 'rowspan'],
  ALLOW_DATA_ATTR: false,
};

/** CSS properties a document may carry. Anything else (position, z-index, behavior, …) is dropped. */
const ALLOWED_CSS = new Set([
  'color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'text-decoration', 'text-decoration-line', 'text-align', 'text-indent', 'text-transform', 'letter-spacing', 'line-height', 'vertical-align',
  'white-space', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-color', 'border-style', 'border-width', 'border-collapse', 'list-style-type', 'page-break-after', 'page-break-before', 'break-after', 'break-before',
]);

/** Values that can load resources or run script are never allowed, whatever the property. */
const BAD_CSS_VALUE = /url\s*\(|expression\s*\(|@import|javascript:|vbscript:|behaviou?r|-moz-binding|image-set|\\|\/\*/i;

export function sanitizeStyle(style) {
  return String(style || '')
    .split(';')
    .map((decl) => {
      const i = decl.indexOf(':');
      if (i < 1) return '';
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (!ALLOWED_CSS.has(prop) || !value || BAD_CSS_VALUE.test(value) || /[<>{}]/.test(value)) return '';
      // `background` shorthand may only be a plain colour.
      if (prop === 'background' && !/^[#\w(),.\s%-]+$/.test(value)) return '';
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i;
const SAFE_IMG_URL = /^https:\/\//i;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!node.getAttribute) return;
  // Links opened from a document must never leak window.opener / the referrer.
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  if (node.hasAttribute('style')) {
    const clean = sanitizeStyle(node.getAttribute('style'));
    if (clean) node.setAttribute('style', clean);
    else node.removeAttribute('style');
  }
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') || '';
    if (!(SAFE_DATA_IMAGE.test(src) || SAFE_IMG_URL.test(src))) node.removeAttribute('src');
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
});

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '', CONFIG);
}
