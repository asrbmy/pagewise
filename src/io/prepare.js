/**
 * Turn editor-only constructs into plain document content before any export:
 *  - footnote markers become superscript numbers, and the notes are appended as a numbered list;
 *  - comment marks are unwrapped (comments are not exported).
 */
export function prepareForExport(html) {
  if (!html || !/data-type="footnote"|data-comment-id/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('span[data-comment-id]').forEach((el) => {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  const notes = [];
  doc.body.querySelectorAll('span[data-type="footnote"]').forEach((el) => {
    notes.push(el.getAttribute('data-note') || '');
    const sup = doc.createElement('sup');
    sup.textContent = String(notes.length);
    el.replaceWith(sup);
  });
  if (notes.length) {
    const hr = doc.createElement('hr');
    const title = doc.createElement('p');
    const strong = doc.createElement('strong');
    strong.textContent = 'Notes';
    title.appendChild(strong);
    const ol = doc.createElement('ol');
    notes.forEach((n) => {
      const li = doc.createElement('li');
      const p = doc.createElement('p');
      p.textContent = n;
      li.appendChild(p);
      ol.appendChild(li);
    });
    doc.body.append(hr, title, ol);
  }
  return doc.body.innerHTML;
}

/** Remove comment anchors (used when a document is copied: the comments themselves stay behind). */
export function stripComments(html) {
  if (!html || !/data-comment-id/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('span[data-comment-id]').forEach((el) => {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  return doc.body.innerHTML;
}
