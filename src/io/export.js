/**
 * Export documents to .txt, .html, .md, .pdf and .docx. Every exporter takes
 * `{ title, html, pageSize }` (HTML as produced by the editor) and resolves to
 * `{ blob, filename, warnings }`. `warnings` lists anything the target format cannot represent.
 */
import { htmlToPlainText } from '../storage/text.js';
import { sanitizeHtml } from './sanitize.js';
import { prepareForExport } from './prepare.js';
import { normalizeLayout, pageMarginRules } from '../editor/layout.js';
import { documentCss } from './docStyles.js';

export function safeFilename(title, ext) {
  const base =
    (title || 'Untitled document')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Untitled document';
  return `${base}.${ext}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Describe what plain-text style formats will lose, based on what the document actually uses. */
export function detectRichFeatures(html) {
  const f = [];
  if (/color\s*:|<mark/i.test(html)) f.push('text colours and highlights');
  if (/font-family\s*:/i.test(html)) f.push('font families');
  if (/font-size\s*:/i.test(html)) f.push('font sizes');
  if (/text-align\s*:\s*(center|right|justify)/i.test(html)) f.push('text alignment');
  if (/line-height\s*:|data-space-|data-indent/i.test(html)) f.push('line and paragraph spacing');
  if (/<img/i.test(html)) f.push('images');
  if (/<table/i.test(html)) f.push('table structure');
  return f;
}

// ---------------------------------------------------------------- TXT

export async function exportTxt({ title, html }) {
  const text = htmlToPlainText(html).replace(/\t\n/g, '\n').replace(/\t/g, '\t');
  const lost = detectRichFeatures(html).filter((x) => x !== 'table structure');
  return {
    blob: new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }),
    filename: safeFilename(title, 'txt'),
    warnings: lost.length ? [`Plain text cannot keep ${lost.join(', ')}.`] : [],
  };
}

// ---------------------------------------------------------------- HTML

/** A complete standalone HTML file with styles inlined (no external requests). */
export function buildStandaloneHtml({ title, html, pageSize, layout }) {
  const l = normalizeLayout(layout);
  const safe = sanitizeHtml(html);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Pagewise">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${esc(title || 'Untitled document')}</title>
<style>${documentCss(pageSize)}${pageMarginRules(l) ? ` @page { ${pageMarginRules(l)} }` : ''}${l.header || l.footer ? ' .doc-furniture{font:9pt sans-serif;color:#555;text-align:center;margin:0 auto;max-width:816px} @media print{.doc-furniture{display:none}}' : ''}</style>
</head>
<body>
${l.header ? `<div class="doc-furniture">${esc(l.header)}</div>\n` : ''}<main class="doc">
${safe}
</main>${l.footer ? `\n<div class="doc-furniture">${esc(l.footer)}</div>` : ''}
</body>
</html>
`;
}

export async function exportHtml({ title, html, pageSize, layout }) {
  return {
    blob: new Blob([buildStandaloneHtml({ title, html, pageSize, layout })], { type: 'text/html;charset=utf-8' }),
    filename: safeFilename(title, 'html'),
    warnings: [],
  };
}

// ---------------------------------------------------------------- Markdown

const PAGE_BREAK_TOKEN = 'PAGEWISEPAGEBREAKTOKEN';

export async function htmlToMarkdown(html) {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')]);
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
  });
  td.use(gfm);
  td.keep(['u', 'mark', 'sub', 'sup']);
  td.addRule('math', {
    filter: (n) => n.nodeName === 'SPAN' && n.getAttribute('data-type') === 'math',
    replacement: (_c, n) => (n.getAttribute('data-display') === 'true' ? `$$${n.getAttribute('data-latex') || ''}$$` : `$${n.getAttribute('data-latex') || ''}$`),
  });
  td.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => `~~${content}~~`,
  });
  td.addRule('alignedParagraph', {
    filter: (n) => n.nodeName === 'P' && /text-align:\s*(center|right)/.test(n.getAttribute('style') || ''),
    replacement: (content, n) => {
      const a = /text-align:\s*(center|right)/.exec(n.getAttribute('style'))[1];
      return `\n\n<p align="${a}">${content}</p>\n\n`;
    },
  });

  // Markdown tables need a header row: promote the first row if the table has none.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // Turndown skips empty elements, so give page breaks a placeholder to swap afterwards.
  doc.querySelectorAll('div[data-type="page-break"]').forEach((d) => {
    const p = doc.createElement('p');
    p.textContent = PAGE_BREAK_TOKEN;
    d.replaceWith(p);
  });
  doc.querySelectorAll('table').forEach((t) => {
    // <colgroup> (added by the table-resize plugin) sits before <tbody> and stops the GFM
    // plugin from recognising the header row, so drop it.
    t.querySelectorAll('colgroup').forEach((c) => c.remove());
    const first = t.querySelector('tr');
    if (first && !first.querySelector('th')) {
      first.querySelectorAll('td').forEach((td0) => {
        const th = doc.createElement('th');
        th.innerHTML = td0.innerHTML;
        td0.replaceWith(th);
      });
    }
    // cell contents are <p>; flatten so rows stay on one line
    t.querySelectorAll('td, th').forEach((c) => {
      c.innerHTML = c.innerHTML.replace(/<\/p>\s*<p[^>]*>/g, '<br>').replace(/<\/?p[^>]*>/g, '');
    });
  });
  return td.turndown(doc.body.innerHTML).split(PAGE_BREAK_TOKEN).join('<div style="page-break-after: always"></div>').trim() + '\n';
}

export async function exportMarkdown({ title, html }) {
  const md = await htmlToMarkdown(html);
  const lost = detectRichFeatures(html).filter((x) => !['images', 'table structure', 'text alignment'].includes(x));
  const warnings = [];
  if (lost.length) warnings.push(`Markdown cannot keep ${lost.join(', ')}.`);
  if (/<img/i.test(html) && /src="data:/i.test(html)) warnings.push('Images are embedded in the .md file as data URLs, which makes it large.');
  return { blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }), filename: safeFilename(title, 'md'), warnings };
}

// ---------------------------------------------------------------- DOCX

export async function exportDocx({ title, html, pageSize, layout }) {
  const { htmlToDocxBlob } = await import('./docx.js');
  const { blob, warnings } = await htmlToDocxBlob(html, { title, pageSize, layout });
  return { blob, filename: safeFilename(title, 'docx'), warnings };
}

// ---------------------------------------------------------------- PDF

/**
 * PDF via html2canvas + jsPDF (see ./pdf.js). The page is an image with an invisible text layer
 * on top (selectable, copyable, searchable for Latin text); for true vector text use File ->
 * Print and choose "Save as PDF".
 */
export async function exportPdf({ title, html, pageSize, layout }) {
  const { buildPdf } = await import('./pdf.js');
  const { blob, warnings } = await buildPdf({ title, html, pageSize, layout });
  return { blob, filename: safeFilename(title, 'pdf'), warnings };
}

export async function exportRtf({ title, html, pageSize, layout }) {
  const { buildRtf } = await import('./rtf.js');
  const { rtf, warnings } = buildRtf(html, { title, pageSize, layout });
  return { blob: new Blob([rtf], { type: 'application/rtf' }), filename: safeFilename(title, 'rtf'), warnings };
}

export async function exportOdt({ title, html, pageSize, layout }) {
  const { buildOdt } = await import('./odt.js');
  const { blob, warnings } = await buildOdt(html, { title, pageSize, layout });
  return { blob, filename: safeFilename(title, 'odt'), warnings };
}

export const EXPORTERS = {
  docx: { label: 'Microsoft Word (.docx)', run: exportDocx },
  pdf: { label: 'PDF document (.pdf)', run: exportPdf },
  html: { label: 'Web page (.html)', run: exportHtml },
  odt: { label: 'OpenDocument Text (.odt)', run: exportOdt },
  rtf: { label: 'Rich Text Format (.rtf)', run: exportRtf },
  md: { label: 'Markdown (.md)', run: exportMarkdown },
  txt: { label: 'Plain text (.txt)', run: exportTxt },
};

/** Convenience used by the UI: run an exporter and trigger the download. */
export async function exportAndDownload(format, doc) {
  const exporter = EXPORTERS[format];
  if (!exporter) throw new Error(`Unknown export format: ${format}`);
  const result = await exporter.run({ ...doc, html: prepareForExport(doc.html) });
  downloadBlob(result.blob, result.filename);
  return result;
}
