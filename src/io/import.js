/**
 * Import .docx, .txt, .md and .html files into editor-ready HTML.
 * Everything runs locally; the file never leaves the browser.
 * Every importer resolves to `{ title, html, warnings }`.
 */
import { sanitizeHtml } from './sanitize.js';
import { embedColorsInDocx, makeTransform, styleMapRules, applyFormatting } from './wordFormat.js';

export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
export const IMPORT_ACCEPT = '.docx,.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class ImportError extends Error {}

export function titleFromFilename(name) {
  return (name || 'Imported document').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported document';
}

export function textToHtml(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = clean.split(/\n{2,}/).filter((b) => b.trim().length);
  if (!blocks.length) return '<p></p>';
  return blocks.map((b) => `<p>${esc(b.replace(/\n+$/, '')).replace(/\n/g, '<br>')}</p>`).join('');
}

export async function markdownToHtml(md) {
  const { marked } = await import('marked');
  const raw = marked.parse(md.replace(/^﻿/, ''), { gfm: true, breaks: false, async: false });
  // Task-list checkboxes would be stripped by the sanitiser; keep their meaning as text.
  const withBoxes = raw
    .replace(/<input[^>]*checked[^>]*>/gi, '☑ ')
    .replace(/<input[^>]*type="checkbox"[^>]*>/gi, '☐ ');
  return sanitizeHtml(withBoxes);
}

async function importDocx(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isZip) {
    throw new ImportError(
      'This file is not a .docx document. Old binary Word files (.doc) are not supported; open it in Word or LibreOffice and choose Save As → .docx.',
    );
  }
  const mammoth = (await import('mammoth')).default || (await import('mammoth'));
  const original = await file.arrayBuffer();
  const arrayBuffer = await embedColorsInDocx(original);
  // Browsers use `arrayBuffer`; mammoth's Node build (used by the test-suite) wants `buffer`.
  const input = (buf) => ({ arrayBuffer: buf, ...(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(buf) } : {}) });
  const baseStyles = [
    "p[style-name='Title'] => h1:fresh",
    "p[style-name='Subtitle'] => h2:fresh",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote:fresh",
    'u => u',
  ];
  let result;
  let table = new Map();
  try {
    // Pass 1 discovers the distinct formatting combinations; pass 2 renders them.
    const probe = new Map();
    await mammoth.convertToHtml(input(arrayBuffer), { styleMap: baseStyles, transformDocument: makeTransform(probe) });
    table = probe;
    result = await mammoth.convertToHtml(input(arrayBuffer), {
      styleMap: [...styleMapRules(table), ...baseStyles],
      transformDocument: makeTransform(new Map(table)),
    });
  } catch (err) {
    throw new ImportError(`This .docx file could not be read (${err.message || 'it may be corrupted or password-protected'}).`);
  }
  const warnings = [];
  const seen = new Set();
  (result.messages || []).forEach((m) => {
    const msg = m.message.replace(/^\s+|\s+$/g, '');
    if (!seen.has(msg)) {
      seen.add(msg);
      warnings.push(msg);
    }
  });
  warnings.push(
    'Imported text formatting (bold, italic, colours, highlights, fonts, sizes, alignment) is kept where it was applied directly to the text. Formatting that comes from Word styles, plus headers/footers, comments, columns and page layout, is not carried over.',
  );
  return { html: sanitizeHtml(applyFormatting(result.value, table)) || '<p></p>', warnings };
}

/** Pick an importer from the file name / type. */
export async function importFile(file) {
  if (!file) throw new ImportError('No file selected.');
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('This file is larger than 40 MB, which is too big to import in the browser.');
  const name = file.name || '';
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  const title = titleFromFilename(name);

  if (ext === 'docx') return { title, ...(await importDocx(file)) };
  if (ext === 'doc') throw new ImportError('Old .doc files are not supported. Save the file as .docx in Word or LibreOffice and import that.');
  if (ext === 'md' || ext === 'markdown' || file.type === 'text/markdown') {
    return { title, html: (await markdownToHtml(await file.text())) || '<p></p>', warnings: [] };
  }
  if (ext === 'html' || ext === 'htm' || file.type === 'text/html') {
    return {
      title,
      html: sanitizeHtml(await file.text()) || '<p></p>',
      warnings: ['Only the HTML content was imported; stylesheets and scripts from the page were discarded.'],
    };
  }
  if (ext === 'txt' || file.type === 'text/plain' || !ext) {
    return { title, html: textToHtml(await file.text()), warnings: [] };
  }
  throw new ImportError(`".${ext}" files are not supported. Import .docx, .txt, .md or .html files.`);
}
