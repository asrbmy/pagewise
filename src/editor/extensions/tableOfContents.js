import { Node, mergeAttributes } from '@tiptap/core';

const MAX_LEVEL = 3;

/** Headings (levels 1-3) in document order, ignoring any inside a table of contents. */
export function collectHeadings(doc) {
  const out = [];
  doc.descendants((node) => {
    if (node.type.name === 'tableOfContents') return false;
    if (node.type.name === 'heading' && node.attrs.level <= MAX_LEVEL && node.textContent.trim()) {
      out.push({ level: node.attrs.level, text: node.textContent.trim() });
    }
    return true;
  });
  return out;
}

/** Editor JSON for the contents of a table of contents. */
export function tocContent(headings) {
  const title = { type: 'paragraph', content: [{ type: 'text', text: 'Table of contents', marks: [{ type: 'bold' }] }] };
  if (!headings.length) {
    return [title, { type: 'paragraph', content: [{ type: 'text', text: 'Add headings (Heading 1–3) to your document, then choose Insert → Update table of contents.', marks: [{ type: 'italic' }] }] }];
  }
  return [
    title,
    ...headings.map((h) => ({
      type: 'paragraph',
      attrs: { indent: h.level - 1 },
      content: [{ type: 'text', text: h.text }],
    })),
  ];
}

/**
 * A table of contents built from the document's headings. It is ordinary, editable content kept
 * in a wrapper block so "Update table of contents" can regenerate it later; exports see plain
 * paragraphs. Entries are not page-numbered or linked (the editor has no true pagination).
 */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc', class: 'toc' }), 0];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ editor, chain }) =>
          chain()
            .insertContent([{ type: this.name, content: tocContent(collectHeadings(editor.state.doc)) }, { type: 'paragraph' }])
            .run(),

      updateTableOfContents:
        () =>
        ({ editor, tr, dispatch }) => {
          const { doc, schema } = editor.state;
          const headings = collectHeadings(doc);
          const found = [];
          doc.descendants((node, pos) => {
            if (node.type.name === this.name) found.push({ node, pos });
            return node.type.name !== this.name;
          });
          if (!found.length) return false;
          if (dispatch) {
            const content = tocContent(headings).map((j) => schema.nodeFromJSON(j));
            // Replace from the end so earlier positions stay valid.
            for (const { node, pos } of found.reverse()) {
              tr.replaceWith(pos + 1, pos + node.nodeSize - 1, content);
            }
          }
          return true;
        },
    };
  },
});
