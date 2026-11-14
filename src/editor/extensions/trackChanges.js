import { Mark, Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TIME = /^\d{10,14}$/;
export const trackKey = new PluginKey('trackChanges');

export function newChangeId() {
  const a = new Uint32Array(2);
  (globalThis.crypto || { getRandomValues: (x) => x.map(() => Math.floor(Math.random() * 2 ** 32)) }).getRandomValues(a);
  return `t${a[0].toString(36)}${a[1].toString(36)}`;
}

const attrsFor = (tag) => ({
  id: { default: null, parseHTML: (el) => (ID.test(el.getAttribute('data-change-id') || '') ? el.getAttribute('data-change-id') : null) },
  time: { default: null, parseHTML: (el) => (TIME.test(el.getAttribute('data-change-time') || '') ? Number(el.getAttribute('data-change-time')) : null) },
});

function trackedMark(name, tag, cls) {
  return Mark.create({
    name,
    inclusive: false,
    excludes: '',
    addAttributes: () => attrsFor(tag),
    // priority beats Strike's own `del` rule; a <del> without our id still becomes ordinary strikethrough
    parseHTML: () => [{ tag: `${tag}[data-change-id]`, priority: 100, getAttrs: (el) => (ID.test(el.getAttribute('data-change-id') || '') ? null : false) }],
    renderHTML: ({ mark }) => [
      tag,
      { 'data-change-id': mark.attrs.id, ...(mark.attrs.time ? { 'data-change-time': String(mark.attrs.time) } : {}), class: cls },
      0,
    ],
  });
}

export const Insertion = trackedMark('insertion', 'ins', 'tc-ins');
export const Deletion = trackedMark('deletion', 'del', 'tc-del');

const isTracked = (m) => m.type.name === 'insertion' || m.type.name === 'deletion';

/** Every pending change, in document order, with the text it covers. */
export function collectChanges(doc) {
  const found = new Map();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    node.marks.forEach((m) => {
      if (!isTracked(m)) return;
      const cur = found.get(m.attrs.id) || { id: m.attrs.id, kind: m.type.name, time: m.attrs.time, text: '', from: pos };
      cur.text += node.isText ? node.text : '▣';
      found.set(m.attrs.id, cur);
    });
    return true;
  });
  return [...found.values()];
}

/** Accept or reject one change (by id) or all of them. Insertions: accept keeps, reject removes. Deletions: the reverse. */
export function resolveChanges(state, id, accept) {
  const { insertion } = state.schema.marks;
  const jobs = [];
  state.doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    const tracked = node.marks.filter((m) => isTracked(m) && (!id || m.attrs.id === id));
    if (!tracked.length) return true;
    const remove = tracked.some((m) => (m.type === insertion ? !accept : accept));
    jobs.push({ from: pos, to: pos + node.nodeSize, remove, marks: tracked });
    return true;
  });
  if (!jobs.length) return null;
  const tr = state.tr;
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (j.remove) tr.delete(j.from, j.to);
    else j.marks.forEach((m) => tr.removeMark(j.from, j.to, m));
  }
  return tr;
}

/**
 * Mark [from, to) as deleted. Text the user typed in suggesting mode is removed for real
 * (deleting your own suggestion just withdraws it). Returns where the range now ends.
 */
function suggestDeletion(tr, from, to, typeDel, typeIns) {
  const doc = tr.doc;
  const before = doc.resolve(from).nodeBefore;
  const after = doc.resolve(to).nodeAfter;
  const adj = [before, after].map((n) => n && n.marks.find((m) => m.type === typeDel)).find(Boolean);
  const mark = typeDel.create({ id: adj ? adj.attrs.id : newChangeId(), time: adj ? adj.attrs.time : Date.now() });
  const own = [];
  const ranges = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const a = Math.max(pos, from);
    const b = Math.min(pos + node.nodeSize, to);
    if (node.marks.some((m) => m.type === typeIns)) own.push([a, b]);
    else if (!node.marks.some((m) => m.type === typeDel)) ranges.push([a, b]);
    return true;
  });
  ranges.forEach(([a, b]) => tr.addMark(a, b, mark));
  for (let i = own.length - 1; i >= 0; i--) tr.delete(own[i][0], own[i][1]);
  return tr.mapping.map(to, -1);
}

function clipText(html) {
  if (!html || !/data-change-id/.test(html)) return html;
  const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  d.body.querySelectorAll('del[data-change-id]').forEach((e) => e.remove());
  d.body.querySelectorAll('ins[data-change-id]').forEach((e) => e.replaceWith(...e.childNodes));
  return d.body.innerHTML;
}

/**
 * "Suggesting" mode: typing, deleting, cutting and pasting are recorded as pending insertions and
 * deletions instead of changing the text, so each can be accepted or rejected later.
 * Not tracked: paragraph splits/joins, formatting, tables and images added from menus.
 */
export const TrackChanges = Extension.create({
  name: 'trackChanges',

  addCommands() {
    return {
      setSuggesting:
        (on) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(trackKey, { suggesting: !!on }));
          return true;
        },
      resolveChange:
        (id, accept) =>
        ({ state, dispatch }) => {
          const tr = resolveChanges(state, id, accept);
          if (!tr) return false;
          if (dispatch) dispatch(tr);
          return true;
        },
      resolveAllChanges:
        (accept) =>
        ({ state, dispatch }) => {
          const tr = resolveChanges(state, null, accept);
          if (!tr) return false;
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const on = (state) => !!trackKey.getState(state)?.suggesting;
    const types = (state) => ({ del: state.schema.marks.deletion, ins: state.schema.marks.insertion });

    /** Insert `content` (text or slice) at `pos`, marked as an insertion; returns the transaction. */
    const insertTracked = (state, from, to, build) => {
      const { del, ins } = types(state);
      const tr = state.tr;
      let pos = to;
      if (from !== to) pos = suggestDeletion(tr, from, to, del, ins);
      const prev = tr.doc.resolve(pos).nodeBefore;
      const adj = prev && prev.marks.find((m) => m.type === ins);
      const mark = ins.create({ id: adj ? adj.attrs.id : newChangeId(), time: adj ? adj.attrs.time : Date.now() });
      const end = build(tr, pos, mark);
      return { tr, end };
    };

    return [
      new Plugin({
        key: trackKey,
        state: {
          init: () => ({ suggesting: false }),
          apply: (tr, value) => tr.getMeta(trackKey) || value,
        },
        props: {
          attributes: (state) => (on(state) ? { 'data-suggesting': 'true' } : {}),

          handleTextInput(view, from, to, text) {
            const { state } = view;
            if (!on(state)) return false;
            const { tr, end } = insertTracked(state, from, to, (t, pos, mark) => {
              const $p = t.doc.resolve(pos);
              const keep = (state.storedMarks || $p.marks()).filter((m) => !isTracked(m));
              t.insert(pos, state.schema.text(text, [...keep, mark]));
              return pos + text.length;
            });
            tr.setSelection(TextSelection.create(tr.doc, end));
            view.dispatch(tr.scrollIntoView());
            return true;
          },

          handlePaste(view, event, slice) {
            const { state } = view;
            if (!on(state)) return false;
            const { from, to } = state.selection;
            const { tr, end } = insertTracked(state, from, to, (t, pos, mark) => {
              t.replace(pos, pos, slice);
              const stop = t.mapping.map(pos, 1);
              t.doc.nodesBetween(pos, stop, (node, p) => {
                if (node.isInline) t.addMark(Math.max(p, pos), Math.min(p + node.nodeSize, stop), mark);
                return true;
              });
              return stop;
            });
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size))));
            view.dispatch(tr.scrollIntoView().setMeta('paste', true));
            return true;
          },

          handleDrop(view) {
            // moving text by dragging would change the document without a record
            return on(view.state) && !!view.dragging;
          },

          transformPastedHTML: clipText,

          handleKeyDown(view, event) {
            const { state } = view;
            if (!on(state) || (event.key !== 'Backspace' && event.key !== 'Delete')) return false;
            const back = event.key === 'Backspace';
            const { del, ins } = types(state);
            const sel = state.selection;
            let from = sel.from;
            let to = sel.to;
            if (sel.empty) {
              const wordwise = event.ctrlKey || event.altKey || event.metaKey;
              let pos = sel.from;
              const skip = (n) => n && n.marks.some((m) => m.type === del);
              // step over text that is already struck, so repeated presses keep moving
              if (back) while (skip(state.doc.resolve(pos).nodeBefore) && state.doc.resolve(pos).parentOffset > 0) pos -= 1;
              else while (skip(state.doc.resolve(pos).nodeAfter) && pos < state.doc.resolve(pos).end()) pos += 1;
              const $p = state.doc.resolve(pos);
              if (back ? $p.parentOffset === 0 : pos >= $p.end()) {
                if (pos !== sel.from) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
                return pos !== sel.from; // at a paragraph edge: let the editor join paragraphs
              }
              const node = back ? $p.nodeBefore : $p.nodeAfter;
              let len = 1;
              if (node.isText) {
                const t = node.text;
                const chars = back ? t.slice(Math.max(0, t.length - 40)) : t.slice(0, 40);
                if (wordwise) {
                  const m = back ? chars.match(/(\s*[^\s]+|\s+)$/u) : chars.match(/^([^\s]+\s*|\s+)/u);
                  len = m ? m[0].length : 1;
                } else {
                  const cps = Array.from(chars);
                  len = (back ? cps[cps.length - 1] : cps[0]).length;
                }
              }
              from = back ? pos - len : pos;
              to = back ? pos : pos + len;
            }
            const tr = state.tr;
            const end = suggestDeletion(tr, from, to, del, ins);
            const caret = back ? tr.mapping.map(from, -1) : end;
            tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
            view.dispatch(tr.scrollIntoView());
            return true;
          },

          handleDOMEvents: {
            cut(view, event) {
              const { state } = view;
              if (!on(state) || state.selection.empty || !event.clipboardData) return false;
              event.preventDefault();
              const { dom, text } = view.serializeForClipboard(state.selection.content());
              event.clipboardData.setData('text/html', dom.innerHTML);
              event.clipboardData.setData('text/plain', text);
              const { del, ins } = types(state);
              const tr = state.tr;
              const end = suggestDeletion(tr, state.selection.from, state.selection.to, del, ins);
              tr.setSelection(TextSelection.create(tr.doc, Math.min(end, tr.doc.content.size)));
              view.dispatch(tr.scrollIntoView());
              return true;
            },
          },
        },
      }),
    ];
  },
});
