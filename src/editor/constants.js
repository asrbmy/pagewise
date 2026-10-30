/** Fonts use system stacks only: no web-font requests, so nothing leaves the browser. */
export const FONT_FAMILIES = [
  { label: 'Default (Sans)', value: null, css: 'var(--font-doc)' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Monospace', value: 'ui-monospace, Menlo, Consolas, monospace' },
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
export const DEFAULT_FONT_SIZE = 11;

export const LINE_SPACINGS = [
  { label: 'Single', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: 'Double', value: '2' },
];

export const PARAGRAPH_SPACINGS = [
  { label: 'None', before: 0, after: 0 },
  { label: 'Small (6 pt after)', before: 0, after: 6 },
  { label: 'Medium (12 pt after)', before: 0, after: 12 },
  { label: 'Large (12 pt before and after)', before: 12, after: 12 },
];

export const ZOOM_LEVELS = [
  { label: 'Fit width', value: 'fit' },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
];

/** CSS pixels at 96 dpi, 1-inch margins. */
export const PAGE_SIZES = {
  letter: { label: 'US Letter (8.5 × 11 in)', width: 816, height: 1056, docx: { width: 12240, height: 15840 }, css: 'letter' },
  a4: { label: 'A4 (210 × 297 mm)', width: 794, height: 1123, docx: { width: 11906, height: 16838 }, css: 'A4' },
};
export const PAGE_MARGIN = 96;

export const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#b91c1c', '#ea580c', '#ca8a04', '#15803d', '#0f766e', '#1d4ed8',
  '#6d28d9', '#be185d', '#7f1d1d', '#9a3412', '#854d0e', '#14532d', '#134e4a', '#1e3a8a',
];

export const HIGHLIGHT_COLORS = [
  '#fef08a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#e9d5ff', '#fbcfe8', '#fed7aa', '#e5e7eb',
];

export const HEADING_STYLES = [
  { label: 'Normal text', id: 'p' },
  { label: 'Heading 1', id: 'h1', level: 1 },
  { label: 'Heading 2', id: 'h2', level: 2 },
  { label: 'Heading 3', id: 'h3', level: 3 },
  { label: 'Heading 4', id: 'h4', level: 4 },
  { label: 'Heading 5', id: 'h5', level: 5 },
  { label: 'Heading 6', id: 'h6', level: 6 },
  { label: 'Quote', id: 'quote' },
];
