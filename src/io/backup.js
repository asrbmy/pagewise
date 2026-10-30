/**
 * Full-library backup and restore as a single JSON file. This is the user's safety net:
 * browser storage can be cleared at any time, so a backup file kept elsewhere is the only
 * durable copy.
 */
import { sanitizeHtml } from './sanitize.js';
import { downloadBlob } from './export.js';
import { htmlToPlainText, countWords, countCharacters } from '../storage/text.js';

export const BACKUP_FORMAT = 'pagewise-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
export const MAX_BACKUP_DOCS = 5000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function buildBackup(docs) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    documents: docs.map(({ id, title, html, pageSize, createdAt, updatedAt }) => ({ id, title, html, pageSize, createdAt, updatedAt })),
  };
}

export async function downloadBackup(store) {
  const docs = await store.exportAll();
  const backup = buildBackup(docs);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `pagewise-backup-${stamp}.json`);
  return docs.length;
}

/** Validate and sanitise backup JSON text. Throws Error with a readable message on bad input. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON, so it cannot be a Pagewise backup.');
  }
  if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.documents)) {
    throw new Error('This file is not a Pagewise backup.');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Pagewise. Please update the app and try again.');
  }
  if (data.documents.length > MAX_BACKUP_DOCS) {
    throw new Error(`This backup has more than ${MAX_BACKUP_DOCS.toLocaleString()} documents, which is more than Pagewise will restore at once.`);
  }
  return data.documents
    .filter((d) => d && typeof d.html === 'string')
    .map((d) => {
      const html = sanitizeHtml(d.html) || '<p></p>';
      const textContent = htmlToPlainText(html);
      const now = Date.now();
      return {
        id: typeof d.id === 'string' && SAFE_ID.test(d.id) ? d.id : undefined,
        title: typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 200) : 'Untitled document',
        html,
        text: textContent,
        wordCount: countWords(textContent),
        charCount: countCharacters(textContent),
        pageSize: d.pageSize === 'a4' ? 'a4' : 'letter',
        createdAt: Number.isFinite(d.createdAt) && d.createdAt > 0 ? d.createdAt : now,
        updatedAt: Number.isFinite(d.updatedAt) && d.updatedAt > 0 ? d.updatedAt : now,
      };
    });
}

export async function restoreBackup(file, store) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('This file is too large to be a Pagewise backup.');
  const docs = parseBackup(await file.text());
  if (!docs.length) throw new Error('The backup file does not contain any documents.');
  return store.importAll(docs);
}
