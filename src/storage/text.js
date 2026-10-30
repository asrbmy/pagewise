/**
 * Small text helpers shared by storage (search index), the status bar and exporters.
 * They only use DOMParser, so they work in the browser and under jsdom in tests.
 */

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TR', 'PRE', 'HR',
]);

/** Convert an HTML string to plain text, keeping paragraph/line boundaries as newlines. */
export function htmlToPlainText(html = '') {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (tag === 'IMG') return;
    if (tag === 'TD' || tag === 'TH') {
      node.childNodes.forEach(walk);
      out.push('\t');
      return;
    }
    node.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag)) out.push('\n');
  };
  doc.body.childNodes.forEach(walk);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Count words the way most word processors do: runs of non-whitespace. */
export function countWords(text = '') {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Characters excluding / including spaces. */
export function countCharacters(text = '', { includeSpaces = true } = {}) {
  const t = text.replace(/\n/g, ' ');
  return includeSpaces ? t.length : t.replace(/\s/g, '').length;
}

/** Build a short snippet around the first match of `query` in `text`. */
export function makeSnippet(text, query, radius = 60) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const idx = query ? flat.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx === -1) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : '');
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + query.length + radius);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}
