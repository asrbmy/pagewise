import { Extension } from '@tiptap/core';

export const MAX_INDENT = 8;
export const INDENT_PX = 48; // 0.5 inch per level

/**
 * Block-level formatting that StarterKit lacks: line height, space before/after a paragraph,
 * and indentation. Values are stored as node attributes and serialised as inline styles so
 * they survive save/reload, copy/paste and HTML export.
 */
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addOptions() {
    return { types: ['paragraph', 'heading'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-space-before') || null,
            renderHTML: (a) =>
              a.spaceBefore != null ? { 'data-space-before': a.spaceBefore, style: `margin-top: ${a.spaceBefore}pt` } : {},
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-space-after') || null,
            renderHTML: (a) =>
              a.spaceAfter != null ? { 'data-space-after': a.spaceAfter, style: `margin-bottom: ${a.spaceAfter}pt` } : {},
          },
          indent: {
            default: 0,
            parseHTML: (el) => {
              const v = parseInt(el.getAttribute('data-indent') || '0', 10);
              if (v) return v;
              const ml = parseFloat(el.style.marginLeft || '0');
              return ml > 0 && el.style.marginLeft.endsWith('px') ? Math.min(MAX_INDENT, Math.round(ml / INDENT_PX)) : 0;
            },
            renderHTML: (a) =>
              a.indent ? { 'data-indent': a.indent, style: `margin-left: ${a.indent * INDENT_PX}px` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    const forTextBlocks = (tr, state, fn) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (this.options.types.includes(node.type.name)) {
          const attrs = fn(node.attrs);
          if (attrs) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
            changed = true;
          }
        }
      });
      return changed;
    };

    return {
      setLineHeight:
        (value) =>
        ({ tr, state, dispatch }) => {
          const changed = forTextBlocks(tr, state, () => ({ lineHeight: value || null }));
          if (changed && dispatch) dispatch(tr);
          return changed;
        },

      /** @param {{before?: number|null, after?: number|null}} spacing in points; `undefined` leaves a side alone */
      setParagraphSpacing:
        (spacing) =>
        ({ tr, state, dispatch }) => {
          const changed = forTextBlocks(tr, state, () => {
            const attrs = {};
            if ('before' in spacing) attrs.spaceBefore = spacing.before;
            if ('after' in spacing) attrs.spaceAfter = spacing.after;
            return attrs;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },

      /** Indent paragraphs/headings; inside a list this nests the list item instead. */
      indent:
        () =>
        ({ tr, state, dispatch, commands, editor }) => {
          if (editor.isActive('listItem')) return commands.sinkListItem('listItem');
          const changed = forTextBlocks(tr, state, (attrs) =>
            (attrs.indent || 0) < MAX_INDENT ? { indent: (attrs.indent || 0) + 1 } : null,
          );
          if (changed && dispatch) dispatch(tr);
          return changed;
        },

      outdent:
        () =>
        ({ tr, state, dispatch, commands, editor }) => {
          if (editor.isActive('listItem')) return commands.liftListItem('listItem');
          const changed = forTextBlocks(tr, state, (attrs) =>
            (attrs.indent || 0) > 0 ? { indent: attrs.indent - 1 } : null,
          );
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});
