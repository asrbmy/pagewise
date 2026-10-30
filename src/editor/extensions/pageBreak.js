import { Node, mergeAttributes } from '@tiptap/core';

/** A hard page break. Rendered as a labelled divider on screen and as a real break when printing. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  // StarterKit's HardBreak also binds Mod-Enter; a higher priority makes Ctrl/Cmd+Enter insert a page break.
  priority: 1000,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="page-break"]' },
      {
        tag: 'div',
        getAttrs: (el) =>
          /page-break-(after|before)\s*:\s*always|break-(after|before)\s*:\s*page/.test(el.getAttribute('style') || '') &&
          !el.textContent.trim()
            ? {}
            : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-break',
        class: 'page-break',
        style: 'page-break-after: always; break-after: page;',
      }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          // A paragraph follows the break so the caret lands on the next page (a bare selected node
          // would be replaced by the next keystroke).
          chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});
