import { Mark, mergeAttributes } from '@tiptap/core';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids of every comment mark in the document, in order, with the text each one covers. */
export function collectComments(doc) {
  const found = new Map();
  doc.descendants((node) => {
    if (!node.isText) return true;
    node.marks.forEach((m) => {
      if (m.type.name !== 'comment') return;
      const cur = found.get(m.attrs.id) || '';
      found.set(m.attrs.id, cur + node.text);
    });
    return true;
  });
  return found;
}

/**
 * A comment anchors to a span of text with a mark that holds only an id. The comment text itself
 * lives in the document record (see EditorPage), so a mark can be pasted or exported without
 * leaking other people's remarks into other documents.
 */
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '', // comments may overlap

  addAttributes() {
    return { id: { default: null, parseHTML: (el) => (ID.test(el.getAttribute('data-comment-id') || '') ? el.getAttribute('data-comment-id') : null) } };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]', getAttrs: (el) => (ID.test(el.getAttribute('data-comment-id') || '') ? null : false) }];
  },

  renderHTML({ mark }) {
    return ['span', mergeAttributes({ 'data-comment-id': mark.attrs.id, class: 'comment-mark' }), 0];
  },

  addCommands() {
    return {
      addCommentMark:
        (id) =>
        ({ commands, state }) => ID.test(id) && !state.selection.empty && commands.setMark(this.name, { id }),
      removeCommentMark:
        (id) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks.comment;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return true;
            const m = node.marks.find((x) => x.type === type && x.attrs.id === id);
            if (m) {
              tr.removeMark(pos, pos + node.nodeSize, m);
              changed = true;
            }
            return true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
