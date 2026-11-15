/**
 * Import Word comments. mammoth drops comment anchors, so before conversion the comment range
 * markers in document.xml are replaced with private-use marker text; after conversion the markers
 * are turned into comment marks (<span data-comment-id>) in the HTML. Comment texts come from
 * word/comments.xml (author, date and "resolved" from commentsExtended.xml when present).
 */
import { newCommentId, MAX_COMMENTS, MAX_COMMENT_TEXT } from '../editor/comments.js';

const OPEN = '';
const CLOSE = '';
const MARKER = new RegExp(`${OPEN}pwc([se]):(\\d{1,9})${CLOSE}`, 'g');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function textOf(el) {
  const out = [];
  const walk = (n) => {
    if (n.nodeType !== 1) return;
    const name = n.localName;
    if (name === 't') out.push(n.textContent);
    else if (name === 'tab') out.push('\t');
    else if (name === 'br' || name === 'cr') out.push('\n');
    else if (name === 'p' && out.length) out.push('\n');
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Parse comments.xml (+ commentsExtended.xml). Returns Map(wordId → {author, date, text, done}). */
export function parseCommentsXml(xml, extXml) {
  const out = new Map();
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return out;
  const done = new Set();
  if (extXml) {
    const ext = new DOMParser().parseFromString(extXml, 'application/xml');
    for (const e of ext.getElementsByTagName('*')) {
      if (e.localName === 'commentEx' && (e.getAttribute('w15:done') === '1' || e.getAttribute('done') === '1')) {
        done.add(e.getAttribute('w15:paraId') || e.getAttribute('paraId'));
      }
    }
  }
  for (const c of doc.getElementsByTagNameNS(W, 'comment')) {
    const id = c.getAttributeNS(W, 'id') ?? c.getAttribute('w:id');
    if (id == null || !/^\d{1,9}$/.test(id)) continue;
    const paras = c.getElementsByTagNameNS(W, 'p');
    const lastPara = paras[paras.length - 1];
    const paraId = lastPara && (lastPara.getAttribute('w14:paraId') || lastPara.getAttribute('paraId'));
    const text = textOf(c);
    if (!text) continue;
    const date = Date.parse(c.getAttributeNS(W, 'date') || c.getAttribute('w:date') || '');
    out.set(id, {
      author: (c.getAttributeNS(W, 'author') || c.getAttribute('w:author') || '').slice(0, 80),
      date: Number.isFinite(date) ? date : null,
      text,
      done: !!(paraId && done.has(paraId)),
    });
  }
  return out;
}

/** Swap comment range markers in document.xml for marker text runs. */
export function embedCommentMarkers(xml, ids) {
  const marker = (kind, id) => `<w:r><w:t xml:space="preserve">${OPEN}pwc${kind}:${id}${CLOSE}</w:t></w:r>`;
  const ranged = new Set([...xml.matchAll(/<w:commentRangeEnd\b[^>]*?\bw:id="(\d+)"/g)].map((m) => m[1]));
  return xml
    // a comment with no range (a point comment) is anchored where its reference sits, inside a run
    .replace(/<w:commentReference\b[^>]*?\bw:id="(\d+)"[^>]*?\/>/g, (m, id) => (ids.has(id) && !ranged.has(id) ? `<w:t xml:space="preserve">${OPEN}pwce:${id}${CLOSE}</w:t>` : m))
    .replace(/<w:commentRangeStart\b[^>]*?\bw:id="(\d+)"[^>]*?\/>/g, (m, id) => (ids.has(id) ? marker('s', id) : m))
    .replace(/<w:commentRangeEnd\b[^>]*?\bw:id="(\d+)"[^>]*?\/>/g, (m, id) => (ids.has(id) ? marker('e', id) : m));
}

/** Read comments out of the .docx and put markers in its body. Returns the buffer to convert. */
export async function embedCommentsInDocx(arrayBuffer) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const cx = zip.file('word/comments.xml');
    const body = zip.file('word/document.xml');
    if (!cx || !body) return { buffer: arrayBuffer, comments: new Map() };
    const ex = zip.file('word/commentsExtended.xml');
    const comments = parseCommentsXml(await cx.async('string'), ex ? await ex.async('string') : '');
    if (!comments.size) return { buffer: arrayBuffer, comments };
    zip.file('word/document.xml', embedCommentMarkers(await body.async('string'), new Set(comments.keys())));
    return { buffer: await zip.generateAsync({ type: 'arraybuffer' }), comments };
  } catch {
    return { buffer: arrayBuffer, comments: new Map() };
  }
}

/**
 * Turn the markers in converted HTML into comment marks. Returns `{ html, comments }` where
 * `comments` are records for the document (ids are fresh, texts prefixed with the author).
 */
export function anchorComments(html, wordComments) {
  if (!html.includes(OPEN)) return { html, comments: [], dropped: wordComments.size };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);

  const ours = new Map(); // word id → our id
  const wrapped = new Map(); // word id → number of text pieces wrapped
  const idFor = (wid) => {
    if (!ours.has(wid)) ours.set(wid, newCommentId());
    return ours.get(wid);
  };
  const open = []; // word ids currently open, in start order
  let prev = null; // last text node holding real text

  const wrapNode = (node, wids) => {
    const parent = node.parentNode;
    const hold = doc.createComment('');
    parent.replaceChild(hold, node);
    let cur = node;
    for (let k = wids.length - 1; k >= 0; k--) {
      const span = doc.createElement('span');
      span.setAttribute('data-comment-id', idFor(wids[k]));
      span.appendChild(cur);
      cur = span;
    }
    parent.replaceChild(cur, hold);
  };

  const wrapFragmentText = (parent, textNode, wids) => {
    // build spans around a freshly created text node that is not yet in the DOM
    let cur = textNode;
    for (let i = wids.length - 1; i >= 0; i--) {
      const span = doc.createElement('span');
      span.setAttribute('data-comment-id', idFor(wids[i]));
      span.appendChild(cur);
      cur = span;
      wrapped.set(wids[i], (wrapped.get(wids[i]) || 0) + 1);
    }
    parent.appendChild(cur);
  };

  const wrapTrailingWord = (textNode, wid) => {
    const m = textNode.data.match(/(\S+)\s*$/);
    if (!m) return false;
    const tail = textNode.splitText(m.index);
    const span = doc.createElement('span');
    span.setAttribute('data-comment-id', idFor(wid));
    tail.parentNode.replaceChild(span, tail);
    span.appendChild(tail);
    wrapped.set(wid, (wrapped.get(wid) || 0) + 1);
    return true;
  };

  for (const node of nodes) {
    if (!node.data.includes(OPEN)) {
      if (open.length && node.data.trim()) {
        const wids = open.slice();
        wids.forEach((w) => wrapped.set(w, (wrapped.get(w) || 0) + 1));
        wrapNode(node, wids);
      }
      if (node.data.trim()) prev = node;
      continue;
    }
    const frag = doc.createDocumentFragment();
    let last = 0;
    let m;
    MARKER.lastIndex = 0;
    const emit = (text) => {
      if (!text) return;
      const t = doc.createTextNode(text);
      if (open.length && text.trim()) wrapFragmentText(frag, t, open.slice());
      else frag.appendChild(t);
      if (text.trim()) prev = t;
    };
    const pending = [];
    while ((m = MARKER.exec(node.data))) {
      emit(node.data.slice(last, m.index));
      last = m.index + m[0].length;
      const [, kind, wid] = m;
      if (!wordComments.has(wid)) continue;
      if (kind === 's') {
        if (!open.includes(wid)) open.push(wid);
      } else {
        const i = open.indexOf(wid);
        if (i >= 0) open.splice(i, 1);
        pending.push({ wid, at: prev });
      }
    }
    emit(node.data.slice(last));
    node.parentNode.replaceChild(frag, node);
    // a range with no text in it (a point comment): attach it to the word just before
    for (const { wid, at } of pending) {
      if (!wrapped.get(wid) && at && at.parentNode) wrapTrailingWord(at, wid);
    }
  }

  const records = [];
  for (const [wid, c] of wordComments) {
    if (!ours.has(wid) || !wrapped.get(wid)) continue;
    const who = c.author ? `${c.author}: ` : '';
    records.push({ id: ours.get(wid), text: `${who}${c.text}`.slice(0, MAX_COMMENT_TEXT), createdAt: c.date || Date.now(), resolved: c.done });
    if (records.length >= MAX_COMMENTS) break;
  }
  // markers that never matched a known comment are stripped
  const out = doc.body.innerHTML.replace(new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}`, 'g'), '');
  return { html: out, comments: records, dropped: wordComments.size - records.length };
}
