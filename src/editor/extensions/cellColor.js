import { Extension } from '@tiptap/core';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Background colour for table cells (stored as an inline style, restricted to #rrggbb). */
export const CellColor = Extension.create({
  name: 'cellColor',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          background: {
            default: null,
            parseHTML: (el) => {
              const m = /background(?:-color)?:\s*(#[0-9a-fA-F]{6})/.exec(el.getAttribute('style') || '') || (el.style && /^rgb/.test(el.style.backgroundColor) ? null : null);
              if (m && HEX.test(m[1])) return m[1].toLowerCase();
              const bg = el.style && el.style.backgroundColor;
              const rgb = bg && /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(bg);
              return rgb ? '#' + rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : null;
            },
            renderHTML: (attrs) => (attrs.background && HEX.test(attrs.background) ? { style: `background-color: ${attrs.background}` } : {}),
          },
        },
      },
    ];
  },
});
