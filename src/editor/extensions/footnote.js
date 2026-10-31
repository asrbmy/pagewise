import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const MAX_NOTE = 1000;
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

/** Footnotes in document order: [{ number, note, pos }]. */
export function collectFootnotes(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') out.push({ number: out.length + 1, note: node.attrs.note, pos });
    return true;
  });
  return out;
}

const key = new PluginKey('footnoteList');

/**
 * Footnotes: a numbered marker in the text, with the note text listed under the document. The
 * numbers are never stored; they follow document order, so adding or moving a footnote renumbers
 * the rest. Exports turn markers into superscript numbers and append the list of notes.
 */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { note: { default: '', parseHTML: (el) => clean(el.getAttribute('data-note')) } };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="footnote"]' }];
  },

  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-type': 'footnote', 'data-note': clean(node.attrs.note), class: 'footnote-ref' })];
  },

  addCommands() {
    return {
      insertFootnote:
        (note) =>
        ({ commands }) =>
          !!clean(note) && commands.insertContent({ type: this.name, attrs: { note: clean(note) } }),
      updateFootnote:
        (note) =>
        ({ state, tr, dispatch }) => {
          const sel = state.selection;
          if (!sel.node || sel.node.type.name !== this.name || !clean(note)) return false;
          if (dispatch) dispatch(tr.setNodeMarkup(sel.from, undefined, { note: clean(note) }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const notes = collectFootnotes(state.doc);
            if (!notes.length) return null;
            const signature = notes.map((n) => n.note).join('\u0001');
            const widget = () => {
              const box = document.createElement('div');
              box.className = 'footnote-list';
              box.setAttribute('contenteditable', 'false');
              box.setAttribute('role', 'note');
              const h = document.createElement('div');
              h.className = 'footnote-list-title';
              h.textContent = 'Notes';
              box.appendChild(h);
              const ol = document.createElement('ol');
              notes.forEach((n) => {
                const li = document.createElement('li');
                li.textContent = n.note;
                ol.appendChild(li);
              });
              box.appendChild(ol);
              return box;
            };
            return DecorationSet.create(state.doc, [Decoration.widget(state.doc.content.size, widget, { side: 1, key: `fn-${signature}`, ignoreSelection: true })]);
          },
        },
      }),
    ];
  },
});
