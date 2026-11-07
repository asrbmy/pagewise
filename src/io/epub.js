import { sanitizeHtml } from './sanitize.js';

const XHTML = 'http://www.w3.org/1999/xhtml';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function dataUriToBytes(uri) {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri);
  if (!m) return null;
  const bin = atob(m[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1].toLowerCase(), bytes };
}

/** Serialise a DOM node as well-formed XHTML. */
function toXhtml(nodes) {
  const ser = new XMLSerializer();
  return nodes
    .map((n) => ser.serializeToString(n).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, ''))
    .join('\n');
}

/**
 * Build an EPUB 3 e-book: one chapter per Heading 1 (or a single chapter), a navigation list, and any
 * embedded images stored as files. Remote images are replaced by their alt text, since e-readers are offline.
 */
export async function buildEpub(html, { title = 'Untitled document', lang = 'en' } = {}) {
  const { default: JSZip } = await import('jszip');
  const doc = new DOMParser().parseFromString(`<body>${sanitizeHtml(html) || ''}</body>`, 'text/html');
  const images = [];
  doc.body.querySelectorAll('img').forEach((img) => {
    const parsed = dataUriToBytes(img.getAttribute('src') || '');
    if (!parsed) {
      const alt = img.getAttribute('alt') || '';
      img.replaceWith(doc.createTextNode(alt ? `[${alt}]` : ''));
      return;
    }
    const name = `images/img${images.length + 1}.${MIME_EXT[parsed.mime]}`;
    images.push({ name, ...parsed });
    img.setAttribute('src', name);
    img.removeAttribute('style');
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  });
  // Strip things XHTML readers reject or that are screen-only.
  doc.body.querySelectorAll('[data-type="tableOfContents"], .page-spacer').forEach((e) => e.remove());
  doc.body.querySelectorAll('*').forEach((e) => {
    [...e.attributes].forEach((a) => {
      if (/^data-|^on|^class$|^contenteditable$/.test(a.name)) e.removeAttribute(a.name);
    });
  });

  // Split into chapters at each h1.
  const chapters = [];
  let current = { title, nodes: [] };
  for (const node of [...doc.body.childNodes]) {
    if (node.nodeType === 1 && node.tagName === 'H1' && (current.nodes.length || chapters.length)) {
      chapters.push(current);
      current = { title: node.textContent.trim() || title, nodes: [] };
    } else if (node.nodeType === 1 && node.tagName === 'H1') {
      current.title = node.textContent.trim() || title;
    }
    current.nodes.push(node);
  }
  chapters.push(current);

  const page = (t, body) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>\n${body}\n</body></html>`;

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/style.css', 'body{font-family:serif;line-height:1.5}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #888;padding:4px}blockquote{margin-left:1.5em;color:#444}');

  chapters.forEach((c, i) => zip.file(`OEBPS/ch${i + 1}.xhtml`, page(c.title, toXhtml(c.nodes))));
  images.forEach((im) => zip.file(`OEBPS/${im.name}`, im.bytes));

  const navItems = chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join('');
  zip.file('OEBPS/nav.xhtml', page(title, `<nav epub:type="toc" id="toc"><h1>${esc(title)}</h1><ol>${navItems}</ol></nav>`));

  const id = `urn:uuid:${crypto.randomUUID()}`;
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
    ...images.map((im, i) => `<item id="img${i + 1}" href="${im.name}" media-type="${im.mime}"/>`),
  ].join('');
  const spine = chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>${esc(lang)}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  );

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
  const warnings = [];
  if (/\$[^$]+\$|data-latex/.test(html)) warnings.push('Equations are exported as LaTeX text.');
  return { blob, warnings };
}
