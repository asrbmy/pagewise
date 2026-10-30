import { PAGE_SIZES, PAGE_MARGIN } from '../editor/constants.js';

/**
 * Typographic CSS shared by the HTML export and the PDF renderer, so exported documents
 * look like the editor. (The editor itself uses src/styles/app.css.)
 */
export function documentCss(pageSize = 'letter') {
  const page = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
  return `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #1f2937; }
  .doc { box-sizing: border-box; max-width: ${page.width}px; margin: 0 auto; padding: ${PAGE_MARGIN}px;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
  .doc p { margin: 0 0 8pt; min-height: 1em; }
  .doc h1 { font-size: 26pt; margin: 18pt 0 6pt; line-height: 1.2; }
  .doc h2 { font-size: 20pt; margin: 16pt 0 6pt; line-height: 1.25; }
  .doc h3 { font-size: 16pt; margin: 14pt 0 4pt; }
  .doc h4 { font-size: 13pt; margin: 12pt 0 4pt; }
  .doc h5 { font-size: 11pt; margin: 10pt 0 4pt; }
  .doc h6 { font-size: 11pt; margin: 10pt 0 4pt; font-style: italic; }
  .doc ul, .doc ol { margin: 0 0 8pt; padding-left: 28px; }
  .doc blockquote { margin: 8pt 0; padding: 2pt 0 2pt 14px; border-left: 3px solid #9ca3af; color: #4b5563; }
  .doc a { color: #0b5cad; }
  .doc img { max-width: 100%; height: auto; }
  .doc table { border-collapse: collapse; width: 100%; margin: 8pt 0; table-layout: fixed; }
  .doc th, .doc td { border: 1px solid #9ca3af; padding: 4pt 8pt; vertical-align: top; text-align: left; }
  .doc th { background: #f1f3f4; font-weight: 600; }
  .doc td > p, .doc th > p { margin: 0; }
  .doc code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
  .doc hr { border: 0; border-top: 1px solid #9ca3af; margin: 12pt 0; }
  .doc mark { color: inherit; }
  .doc .toc { margin: 8pt 0; padding: 8pt 12pt; border: 1px solid #9ca3af; border-radius: 6px; }
  .doc .toc p { margin: 2pt 0; }
  .doc .page-break { break-after: page; page-break-after: always; height: 0; }
  @page { size: ${page.css}; margin: 1in; }
  @media print { .doc { padding: 0; max-width: none; } }
  `;
}
