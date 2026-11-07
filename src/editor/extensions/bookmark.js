import { Extension } from '@tiptap/core';

export const BOOKMARK_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Turn free text into a bookmark name ("My Section 2" -> "my-section-2"). */
export function slugifyBookmark(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** All bookmarks in a document, in order. */
export function collectBookmarks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && node.attrs.bookmark) out.push({ name: node.attrs.bookmark, pos, text: node.textContent.trim().slice(0, 60) });
    return true;
  });
  return out;
}

/** A named anchor on a paragraph or heading that links (#bm-name) can jump to. */
export const Bookmark = Extension.create({
  name: 'bookmark',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          bookmark: {
            default: null,
            parseHTML: (el) => (BOOKMARK_NAME.test(el.getAttribute('data-bookmark') || '') ? el.getAttribute('data-bookmark') : null),
            renderHTML: (a) => (a.bookmark ? { 'data-bookmark': a.bookmark } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      /** Name the block the cursor is in (a name is unique: it moves here if used elsewhere). */
      setBookmark:
        (name) =>
        ({ state, tr, dispatch }) => {
          if (!BOOKMARK_NAME.test(name)) return false;
          const { $from } = state.selection;
          if (!$from.depth) return false;
          if (dispatch) {
            state.doc.descendants((node, pos) => {
              if (node.isTextblock && node.attrs.bookmark === name) tr.setNodeMarkup(pos, undefined, { ...node.attrs, bookmark: null });
              return true;
            });
            const pos = $from.before($from.depth);
            const node = tr.doc.nodeAt(pos);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, bookmark: name });
            dispatch(tr);
          }
          return true;
        },
      removeBookmark:
        (name) =>
        ({ state, tr, dispatch }) => {
          if (dispatch) {
            state.doc.descendants((node, pos) => {
              if (node.isTextblock && node.attrs.bookmark === name) tr.setNodeMarkup(pos, undefined, { ...node.attrs, bookmark: null });
              return true;
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

export const isBookmarkHref = (href) => /^#bm-[a-z0-9][a-z0-9-]{0,39}$/.test(href || '');
