import { Extension } from '@tiptap/core';

const ID = /^h-\d{1,5}$/;

/** Stable `id="h-n"` on headings so a table of contents can link to them. Ids are (re)assigned on TOC update. */
export const HeadingIds = Extension.create({
  name: 'headingIds',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (el) => (ID.test(el.getAttribute('id') || '') ? el.getAttribute('id') : null),
            renderHTML: (attrs) => (attrs.id ? { id: attrs.id } : {}),
          },
        },
      },
    ];
  },
});
