/**
 * Google Docs imports. Google Docs "Download → Web Page (.html, zipped)" produces HTML whose
 * formatting lives in a <style> sheet of one-class rules (.c12 { font-weight: 700 }), which the
 * normal HTML import discards. This turns those rules back into inline formatting, drops Google's
 * link redirects, and (for the zip) embeds the images. Everything still goes through the sanitiser.
 */
const KEEP = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-decoration', 'text-align', 'vertical-align']);
const HEADINGS = /^H[1-6]$/;

export function isGoogleDocsHtml(html) {
  return /docs-internal-guid|class="[^"]*\bdoc-content\b|lst-kix_/.test(html) && /<style/i.test(html);
}

/** `.c1{...}` rules → Map(class → {prop: value}). Only plain single-class selectors are used. */
export function parseClassRules(css) {
  const rules = new Map();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i < 0) return;
      const prop = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).replace(/!important/i, '').trim();
      if (KEEP.has(prop) && val) decls[prop] = val;
    });
    if (!Object.keys(decls).length) continue;
    for (const sel of m[1].split(',')) {
      const cls = sel.trim().match(/^\.([\w-]+)$/);
      if (cls) rules.set(cls[1], { ...(rules.get(cls[1]) || {}), ...decls });
    }
  }
  return rules;
}

/** https://www.google.com/url?q=TARGET&sa=… → TARGET (only http/https/mailto targets). */
export function unwrapGoogleLink(href) {
  try {
    const u = new URL(href);
    if (/^(www\.)?google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') {
      const q = u.searchParams.get('q');
      if (q && /^(https?:|mailto:)/i.test(q)) return q;
    }
  } catch {
    /* not a URL */
  }
  return href;
}

const DEFAULTS = { color: '#000000', 'background-color': '#ffffff', 'font-size': '11pt', 'font-weight': '400', 'font-style': 'normal', 'text-decoration': 'none', 'vertical-align': 'baseline' };

/**
 * @param {string} html
 * @param {Map<string,string>} [images] path (as written in the HTML) → data: URI
 * @returns {{ html: string, warnings: string[] }}
 */
export function convertGoogleHtml(html, images = new Map()) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const rules = parseClassRules(css);
  const warnings = [];
  const body = doc.body;

  // titles, then formatting
  body.querySelectorAll('p.title').forEach((p) => p.replaceWith(Object.assign(doc.createElement('h1'), { innerHTML: p.innerHTML })));
  body.querySelectorAll('p.subtitle').forEach((p) => p.replaceWith(Object.assign(doc.createElement('h2'), { innerHTML: p.innerHTML })));

  // Google comments are exported as footnote-like lettered references plus a block at the end
  let dropped = 0;
  body.querySelectorAll('sup a[id^="cmnt_ref"]').forEach((a) => {
    a.closest('sup').remove();
    dropped++;
  });
  body.querySelectorAll('a[id^="cmnt"]:not([id^="cmnt_ref"])').forEach((a) => {
    (a.closest('div') || a.closest('p'))?.remove();
  });
  if (dropped) warnings.push(`${dropped} Google Docs comment${dropped === 1 ? ' was' : 's were'} not imported (Google's HTML export does not say which text a comment belongs to). Download as .docx to keep comments.`);

  body.querySelectorAll('[class]').forEach((el) => {
    const merged = {};
    for (const c of el.classList) Object.assign(merged, rules.get(c) || {});
    const inHeading = HEADINGS.test(el.tagName) || !!el.closest('h1,h2,h3,h4,h5,h6');
    const style = [];
    for (const [k, v] of Object.entries(merged)) {
      if (DEFAULTS[k] && v.toLowerCase().replace(/\s/g, '') === DEFAULTS[k]) continue;
      if (inHeading && (k === 'font-size' || k === 'font-weight')) continue;
      if (k === 'vertical-align' && /^(super|sub)$/.test(v)) continue; // becomes <sup>/<sub> below
      if (k === 'text-align' && el.tagName === 'SPAN') continue;
      style.push(`${k}:${v}`);
    }
    el.removeAttribute('class');
    const bg = style.find((d) => d.startsWith('background-color:'));
    if (bg && el.tagName === 'SPAN' && /^#[0-9a-f]{3,8}$/i.test(bg.slice(17))) {
      // highlights are marks in the editor, not styles
      const mark = doc.createElement('mark');
      mark.setAttribute('data-color', bg.slice(17));
      mark.setAttribute('style', `background-color: ${bg.slice(17)}; color: inherit`);
      mark.innerHTML = el.innerHTML;
      el.innerHTML = '';
      el.appendChild(mark);
      style.splice(style.indexOf(bg), 1);
    }
    if (style.length) el.setAttribute('style', `${el.getAttribute('style') ? `${el.getAttribute('style')};` : ''}${style.join(';')}`);
    if (el.tagName === 'SPAN' && /^(super|sub)$/.test(merged['vertical-align'] || '')) {
      const tag = doc.createElement(merged['vertical-align'] === 'super' ? 'sup' : 'sub');
      tag.innerHTML = el.innerHTML;
      el.replaceWith(tag);
    }
  });

  body.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', unwrapGoogleLink(a.getAttribute('href'))));

  let missing = 0;
  body.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const key = decodeURIComponent(src.split('?')[0]).replace(/^\.\//, '');
    if (images.has(key)) img.setAttribute('src', images.get(key));
    else if (!/^data:image\//i.test(src)) {
      img.remove();
      missing++;
    }
  });
  if (missing) warnings.push(`${missing} image${missing === 1 ? ' was' : 's were'} not imported. Download the Google Doc as "Web Page (.html, zipped)" and import the .zip file to include images.`);

  // empty spacer paragraphs Google adds around lists/tables are kept (they are real blank lines in the doc)
  return { html: body.innerHTML, warnings };
}

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_ZIP_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 40 * 1024 * 1024;

/** Read a Google Docs HTML .zip: returns `{ html, images }` (images keyed by their path in the zip). */
export async function readGoogleZip(arrayBuffer) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)__MACOSX\//.test(f.name));
  const htmlEntry = entries.find((f) => /\.html?$/i.test(f.name));
  if (!htmlEntry) return null;
  const declared = (f) => f._data?.uncompressedSize ?? 0;
  if (entries.reduce((a, f) => a + declared(f), 0) > MAX_ZIP_TOTAL_BYTES) throw new Error('The zip file expands to more than 40 MB, which is too big to import in the browser.');
  const base = htmlEntry.name.includes('/') ? htmlEntry.name.slice(0, htmlEntry.name.lastIndexOf('/') + 1) : '';
  const images = new Map();
  let total = 0;
  for (const f of entries) {
    const ext = (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    if (!IMAGE_TYPES[ext] || (declared(f) && declared(f) > MAX_ZIP_IMAGE_BYTES)) continue;
    const b64 = await f.async('base64');
    total += b64.length;
    if (total > MAX_ZIP_TOTAL_BYTES) break;
    images.set(f.name.startsWith(base) ? f.name.slice(base.length) : f.name, `data:${IMAGE_TYPES[ext]};base64,${b64}`);
  }
  return { html: await htmlEntry.async('string'), images, name: htmlEntry.name };
}
