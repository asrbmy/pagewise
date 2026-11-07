import { Node, mergeAttributes } from '@tiptap/core';
import { paginationKey } from './pagination.js';

const MAX_LEVEL = 3;

/** Give every contents-eligible heading its `h-n` id (in document order) inside a transaction. */
export function assignHeadingIds(tr) {
  let n = 0;
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'tableOfContents') return false;
    if (node.type.name === 'heading' && node.attrs.level <= MAX_LEVEL && node.textContent.trim()) {
      n += 1;
      const id = `h-${n}`;
      if (node.attrs.id !== id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
    }
    return true;
  });
}

/** Headings (levels 1-3) in document order, ignoring any inside a table of contents. */
export function collectHeadings(doc, pageOf = null) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableOfContents') return false;
    if (node.type.name === 'heading' && node.attrs.level <= MAX_LEVEL && node.textContent.trim()) {
      out.push({ level: node.attrs.level, text: node.textContent.trim(), id: `h-${out.length + 1}`, page: pageOf ? pageOf(pos) : null });
    }
    return true;
  });
  return out;
}

/** Page number of the block at `pos` from the on-screen layout, or null when page gaps are off. */
export function pageResolver(editor) {
  const st = paginationKey.getState(editor.state);
  if (!st || !st.enabled || !editor.view) return null;
  return (pos) => {
    try {
      const dom = editor.view.nodeDOM(pos);
      return dom && dom.nodeType === 1 && dom.offsetHeight ? Math.floor((dom.offsetTop + 1) / st.pageHeight) + 1 : null;
    } catch {
      return null;
    }
  };
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
      content: [
        { type: 'text', text: h.text, marks: [{ type: 'link', attrs: { href: `#${h.id}` } }] },
        ...(h.page ? [{ type: 'text', text: ` · p. ${h.page}` }] : []),
      ],
    })),
  ];
}

/**
 * A table of contents built from the document's headings. It is ordinary, editable content kept
 * in a wrapper block so "Update table of contents" can regenerate it later; exports see plain
 * paragraphs. Entries link to their headings (Ctrl/Cmd-click or click in the editor jumps there); with page gaps on (View menu) they also show page numbers, which are as exact as the on-screen layout.
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
        ({ editor, tr, dispatch, commands }) => {
          if (dispatch) assignHeadingIds(tr);
          return commands.insertContent([{ type: this.name, content: tocContent(collectHeadings(tr.doc, pageResolver(editor))) }, { type: 'paragraph' }]);
        },

      updateTableOfContents:
        () =>
        ({ editor, tr, dispatch }) => {
          const { schema } = editor.state;
          if (dispatch) assignHeadingIds(tr);
          const headings = collectHeadings(tr.doc, pageResolver(editor));
          const found = [];
          tr.doc.descendants((node, pos) => {
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
