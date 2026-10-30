import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { FontFamily } from '@tiptap/extension-font-family';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { FontSize } from './fontSize.js';
import { ParagraphFormat } from './paragraphFormat.js';
import { PageBreak } from './pageBreak.js';
import { FindReplace } from './findReplace.js';
import { TableOfContents } from './tableOfContents.js';

/** Image with an optional width (percentage of the text column) so images can be resized. */
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-width') || (el.style.width && el.style.width.endsWith('%') ? el.style.width : null),
        renderHTML: (a) => (a.width ? { 'data-width': a.width, style: `width: ${a.width}; height: auto` } : {}),
      },
    };
  },
});

/**
 * The complete extension set. Kept in one place so tests, the editor component and the
 * import/export code all agree on what the document schema is.
 */
export function buildExtensions({ placeholder = 'Start typing…' } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: false,
      trailingNode: false,
      underline: false,
      code: { HTMLAttributes: { class: 'pw-code' } },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto', 'tel'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    ResizableImage.configure({ inline: true, allowBase64: true }),
    Table.configure({ resizable: true, HTMLAttributes: { class: 'pw-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    FontFamily,
    FontSize,
    Subscript,
    Superscript,
    ParagraphFormat,
    PageBreak,
    TableOfContents,
    FindReplace,
    Placeholder.configure({ placeholder }),
    CharacterCount,
  ];
}
