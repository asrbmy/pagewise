/** Comment records kept with a document (the text range they refer to is a mark in the HTML). */
export const MAX_COMMENTS = 300;
export const MAX_COMMENT_TEXT = 2000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function newCommentId() {
  const bytes = new Uint8Array(9);
  (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }) }).getRandomValues(bytes);
  return `c${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}

/** Validate untrusted comment data (from storage or a backup file). */
export function normalizeComments(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !ID.test(c.id) || seen.has(c.id) || typeof c.text !== 'string' || !c.text.trim()) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      text: c.text.trim().slice(0, MAX_COMMENT_TEXT),
      createdAt: Number.isFinite(c.createdAt) && c.createdAt > 0 ? c.createdAt : Date.now(),
      resolved: c.resolved === true,
    });
    if (out.length >= MAX_COMMENTS) break;
  }
  return out;
}

/** CSS that hides the highlight of resolved comments (ids are validated, so this cannot inject CSS). */
export function resolvedCss(comments) {
  return comments
    .filter((c) => c.resolved && ID.test(c.id))
    .map((c) => `.pw-prose .comment-mark[data-comment-id="${c.id}"]{background:none;border-bottom-color:transparent}`)
    .join('\n');
}
