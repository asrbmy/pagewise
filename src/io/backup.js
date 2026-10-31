/**
 * Full-library backup and restore as a single JSON file. This is the user's safety net:
 * browser storage can be cleared at any time, so a backup file kept elsewhere is the only
 * durable copy.
 */
import { sanitizeHtml } from './sanitize.js';
import { setPrefs } from '../settings/prefs.js';
import { normalizeLayout } from '../editor/layout.js';
import { normalizeComments } from '../editor/comments.js';
import { downloadBlob } from './export.js';
import { isValidBlob } from '../storage/crypto.js';
import { htmlToPlainText, countWords, countCharacters } from '../storage/text.js';

export const BACKUP_FORMAT = 'pagewise-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
export const MAX_BACKUP_DOCS = 5000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function buildBackup(docs, folders = []) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    folders: folders.map(({ id, name }) => ({ id, name })),
    documents: docs.map(({ id, title, html, pageSize, layout, folderId, comments, locked, crypto, createdAt, updatedAt }) => ({ id, title, html, pageSize, layout, folderId, comments, ...(locked ? { locked: true, crypto } : {}), createdAt, updatedAt })),
  };
}

export async function downloadBackup(store) {
  const docs = await store.exportAll();
  const backup = buildBackup(docs, await store.listFolders());
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `pagewise-backup-${stamp}.json`);
  setPrefs({ lastBackupAt: Date.now() });
  return docs.length;
}

export const BACKUP_REMINDER_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Should the home page nudge the user to back up? Yes when there are documents and the last
 * backup (or, if never backed up, the oldest document) is more than two weeks old, unless snoozed.
 */
export function backupReminderDue({ lastBackupAt = 0, backupSnoozedUntil = 0 }, docs, now = Date.now()) {
  if (!docs || !docs.length || now < backupSnoozedUntil) return false;
  const since = lastBackupAt || Math.min(...docs.map((d) => d.createdAt || now));
  return now - since > BACKUP_REMINDER_DAYS * DAY;
}

/** Validate and sanitise backup JSON text. Throws Error with a readable message on bad input. */
export function parseBackup(text) {
  return parseBackupFull(text).docs;
}

export function parseBackupFull(text) {
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
  const folders = (Array.isArray(data.folders) ? data.folders : [])
    .filter((f) => f && typeof f.id === 'string' && SAFE_ID.test(f.id) && typeof f.name === 'string' && f.name.trim())
    .slice(0, 500)
    .map((f) => ({ id: f.id, name: f.name.trim().slice(0, 60) }));
  const folderIds = new Set(folders.map((f) => f.id));
  const docs = data.documents
    .filter((d) => d && typeof d.html === 'string')
    .map((d) => {
      const base = {
        id: typeof d.id === 'string' && SAFE_ID.test(d.id) ? d.id : undefined,
        title: typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 200) : 'Untitled document',
        pageSize: d.pageSize === 'a4' ? 'a4' : 'letter',
        layout: normalizeLayout(d.layout),
        folderId: typeof d.folderId === 'string' && folderIds.has(d.folderId) ? d.folderId : null,
        createdAt: Number.isFinite(d.createdAt) && d.createdAt > 0 ? d.createdAt : Date.now(),
        updatedAt: Number.isFinite(d.updatedAt) && d.updatedAt > 0 ? d.updatedAt : Date.now(),
      };
      if (d.locked === true) {
        // Encrypted content is kept as is: it is opaque, so nothing can be sanitised or run.
        if (!isValidBlob(d.crypto)) return null;
        const c = d.crypto;
        return { ...base, html: '<p></p>', text: '', wordCount: 0, charCount: 0, comments: [], locked: true, crypto: { v: 1, salt: c.salt, iv: c.iv, iterations: c.iterations, data: c.data } };
      }
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
        layout: normalizeLayout(d.layout),
        comments: normalizeComments(d.comments),
        folderId: typeof d.folderId === 'string' && folderIds.has(d.folderId) ? d.folderId : null,
        createdAt: Number.isFinite(d.createdAt) && d.createdAt > 0 ? d.createdAt : now,
        updatedAt: Number.isFinite(d.updatedAt) && d.updatedAt > 0 ? d.updatedAt : now,
      };
    })
    .filter(Boolean);
  return { docs, folders };
}

export async function restoreBackup(file, store) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('This file is too large to be a Pagewise backup.');
  const { docs, folders } = parseBackupFull(await file.text());
  if (!docs.length) throw new Error('The backup file does not contain any documents.');
  return store.importAll(docs, folders);
}
