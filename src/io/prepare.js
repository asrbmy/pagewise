/**
 * Turn editor-only constructs into plain document content before any export:
 *  - footnote markers become superscript numbers, and the notes are appended as a numbered list;
 *  - comment marks are unwrapped (comments are not exported);
 *  - tracked changes are accepted unless `keepTracked` (HTML and Word keep them).
 */
export function prepareForExport(html, { keepAnchors = false, keepTracked = false } = {}) {
  const tracked = !keepTracked && /data-change-id/.test(html || '');
  const hasAnchors = !keepAnchors && /href="#(?:h-\d+|bm-[a-z0-9-]+)"/.test(html || '');
  const marks = keepAnchors && /data-bookmark=/.test(html || '');
  if (!html || !(hasAnchors || marks || tracked || /data-type="footnote"|data-comment-id/.test(html))) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  if (marks) {
    // Exported pages have no editor script, so give each bookmarked block a real anchor element to jump to.
    doc.body.querySelectorAll('[data-bookmark]').forEach((el) => {
      const a = doc.createElement('a');
      a.id = `bm-${el.getAttribute('data-bookmark')}`;
      el.insertBefore(a, el.firstChild);
    });
  }
  if (hasAnchors) {
    // In-document links only work in HTML; elsewhere they would be dead links, so keep the text.
    doc.body.querySelectorAll('a[href^="#h-"], a[href^="#bm-"]').forEach((a) => {
      while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
      a.remove();
    });
  }
  if (tracked) {
    // formats without change tracking get the document as it would read with every change accepted
    doc.body.querySelectorAll('del[data-change-id]').forEach((el) => el.remove());
    doc.body.querySelectorAll('ins[data-change-id]').forEach((el) => el.replaceWith(...el.childNodes));
  }
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
