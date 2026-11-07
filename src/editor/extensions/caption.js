import { Extension } from '@tiptap/core';

/** Paragraph flag `data-caption` (styled by CSS, numbered by the command below). */
export const Caption = Extension.create({
  name: 'caption',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          caption: {
            default: null,
            parseHTML: (el) => (el.getAttribute('data-caption') === 'figure' || el.getAttribute('data-caption') === 'table' ? el.getAttribute('data-caption') : null),
            renderHTML: (a) => (a.caption ? { 'data-caption': a.caption } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      /** Insert a numbered caption ("Figure 3: " / "Table 2: ") under the selected image, table or block. */
      insertCaption:
        (labels = { figure: 'Figure', table: 'Table' }) =>
        ({ state, tr, dispatch, editor }) => {
          const { selection, doc, schema } = state;
          let kind = 'figure';
          let after = null;
          if (selection.node && selection.node.type.name === 'image') {
            after = selection.to;
          } else {
            const $from = selection.$from;
            for (let d = $from.depth; d > 0; d -= 1) {
              if ($from.node(d).type.name === 'table') {
                kind = 'table';
                after = $from.after(d);
                break;
              }
            }
            if (after === null) {
              // A paragraph that only holds an image gets the figure caption under it; any other block gets it too.
              after = $from.depth ? $from.after(1) : $from.pos;
              kind = 'figure';
            }
          }
          let count = 0;
          doc.descendants((n) => {
            if (n.type.name === 'paragraph' && n.attrs.caption === kind) count += 1;
          });
          if (!dispatch) return true;
          const text = `${kind === 'table' ? labels.table : labels.figure} ${count + 1}: `;
          const node = schema.nodes.paragraph.create(
            { caption: kind, textAlign: 'center' },
            schema.text(text, [schema.marks.italic.create()]),
          );
          tr.insert(after, node);
          // place the cursor at the end of the new caption so the person can type the description
          const end = after + node.nodeSize - 1;
          tr.setSelection(state.selection.constructor.near(tr.doc.resolve(end), -1));
          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
});
