/**
 * IndexedDB document storage.
 *
 * Everything lives in the user's browser. If IndexedDB cannot be opened at all
 * (private mode in some browsers, blocked site data, very old browsers) the store
 * transparently falls back to an in-memory Map so the editor still works for the
 * current session, and `store.persistent` is false so the UI can warn the user.
 *
 * Runtime failures (quota exceeded, transaction aborted…) are surfaced as
 * `StorageError` with a human-readable message and a machine-readable `code`.
 */
import { openDB } from 'idb';
import { htmlToPlainText, countWords, countCharacters, makeSnippet } from './text.js';

export const DB_NAME = 'pagewise';
export const DB_VERSION = 1;
export const STORE = 'documents';
export const EMPTY_HTML = '<p></p>';

export class StorageError extends Error {
  constructor(message, code = 'unknown', cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

function classify(err) {
  const name = err && err.name;
  if (name === 'QuotaExceededError') {
    return new StorageError(
      'Your browser has no storage space left for Pagewise. Export your documents, free some space, and try again.',
      'quota',
      err,
    );
  }
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'UnknownError') {
    return new StorageError(
      'Browser storage is unavailable (it may be blocked or disabled for this site).',
      'unavailable',
      err,
    );
  }
  return new StorageError(`Storage error: ${(err && err.message) || 'unknown problem'}`, 'unknown', err);
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Strip the heavy fields so list views stay cheap. */
function toSummary(doc, query) {
  const { html, text, ...meta } = doc; // eslint-disable-line no-unused-vars
  return { ...meta, snippet: makeSnippet(text || '', query) };
}

export const SORTS = {
  'modified-desc': { label: 'Last modified (newest first)', cmp: (a, b) => b.updatedAt - a.updatedAt },
  'modified-asc': { label: 'Last modified (oldest first)', cmp: (a, b) => a.updatedAt - b.updatedAt },
  'name-asc': { label: 'Name (A–Z)', cmp: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) },
  'name-desc': { label: 'Name (Z–A)', cmp: (a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: 'base' }) },
  'created-desc': { label: 'Date created (newest first)', cmp: (a, b) => b.createdAt - a.createdAt },
};

export class DocumentStore {
  constructor({ dbName = DB_NAME } = {}) {
    this.dbName = dbName;
    this.memory = new Map();
    this.persistent = false;
    this.initError = null;
    this._ready = null;
    this._db = null;
    this._chain = Promise.resolve();
  }

  /**
   * Run read-modify-write operations one at a time. Without this, an autosave that read the
   * document before a rename and wrote it afterwards would silently undo the rename.
   */
  _serial(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.catch(() => {});
    return run;
  }

  /** Open the database once. Never rejects: failure switches to memory mode. */
  init() {
    if (!this._ready) {
      this._ready = (async () => {
        try {
          if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not supported in this browser.');
          this._db = await openDB(this.dbName, DB_VERSION, {
            upgrade(db) {
              const store = db.createObjectStore(STORE, { keyPath: 'id' });
              store.createIndex('updatedAt', 'updatedAt');
            },
          });
          this.persistent = true;
        } catch (err) {
          this.persistent = false;
          this.initError = classify(err);
        }
        return this.persistent;
      })();
    }
    return this._ready;
  }

  async _getAll() {
    await this.init();
    if (!this._db) return [...this.memory.values()];
    try {
      return await this._db.getAll(STORE);
    } catch (err) {
      throw classify(err);
    }
  }

  async _put(doc) {
    await this.init();
    if (!this._db) {
      this.memory.set(doc.id, doc);
      return;
    }
    try {
      await this._db.put(STORE, doc);
    } catch (err) {
      throw classify(err);
    }
  }

  async _get(id) {
    await this.init();
    if (!this._db) return this.memory.get(id);
    try {
      return await this._db.get(STORE, id);
    } catch (err) {
      throw classify(err);
    }
  }

  async _delete(id) {
    await this.init();
    if (!this._db) {
      this.memory.delete(id);
      return;
    }
    try {
      await this._db.delete(STORE, id);
    } catch (err) {
      throw classify(err);
    }
  }

  /** Create and persist a new document. */
  async createDocument({ title = 'Untitled document', html = EMPTY_HTML, pageSize = 'letter' } = {}) {
    const now = Date.now();
    const text = htmlToPlainText(html);
    const doc = {
      id: newId(),
      title: title.trim() || 'Untitled document',
      html,
      text,
      wordCount: countWords(text),
      charCount: countCharacters(text),
      pageSize,
      createdAt: now,
      updatedAt: now,
    };
    await this._put(doc);
    return doc;
  }

  /** Full document (including HTML) or null. */
  async getDocument(id) {
    const doc = await this._get(id);
    return doc || null;
  }

  /**
   * Update fields of an existing document. `updatedAt` is bumped when the content or title
   * changes. Returns the stored document.
   */
  saveDocument(id, changes) {
    return this._serial(() => this._saveDocument(id, changes));
  }

  async _saveDocument(id, changes) {
    const existing = await this._get(id);
    if (!existing) throw new StorageError('This document no longer exists in browser storage.', 'missing');
    const next = { ...existing, ...changes };
    if (typeof changes.html === 'string') {
      next.text = htmlToPlainText(changes.html);
      next.wordCount = countWords(next.text);
      next.charCount = countCharacters(next.text);
    }
    if (typeof changes.title === 'string') next.title = changes.title.trim() || 'Untitled document';
    next.updatedAt = changes.updatedAt || Date.now();
    await this._put(next);
    return next;
  }

  async renameDocument(id, title) {
    return this.saveDocument(id, { title });
  }

  async duplicateDocument(id) {
    const src = await this._get(id);
    if (!src) throw new StorageError('The document to copy was not found.', 'missing');
    return this.createDocument({ title: `Copy of ${src.title}`, html: src.html, pageSize: src.pageSize });
  }

  async deleteDocument(id) {
    await this._delete(id);
  }

  /**
   * List document summaries. `query` matches title and content (case-insensitive).
   * @param {{query?: string, sort?: keyof typeof SORTS}} opts
   */
  async listDocuments({ query = '', sort = 'modified-desc' } = {}) {
    const all = await this._getAll();
    const q = query.trim().toLowerCase();
    const cmp = (SORTS[sort] || SORTS['modified-desc']).cmp;
    return all
      .filter((d) => !q || d.title.toLowerCase().includes(q) || (d.text || '').toLowerCase().includes(q))
      .sort(cmp)
      .map((d) => toSummary(d, q));
  }

  async count() {
    return (await this._getAll()).length;
  }

  /** Full documents for backup. */
  async exportAll() {
    return this._getAll();
  }

  /**
   * Insert documents from a backup. Documents whose id already exists are stored as new
   * copies so nothing is ever overwritten.
   * @returns {Promise<{added:number, copied:number}>}
   */
  async importAll(docs) {
    let added = 0;
    let copied = 0;
    for (const d of docs) {
      const exists = await this._get(d.id);
      const doc = { ...d };
      if (!doc.id || exists) {
        doc.id = newId();
        if (exists) {
          doc.title = `${doc.title} (restored)`;
          copied += 1;
        }
      }
      if (!exists) added += 1;
      await this._put(doc);
    }
    return { added, copied };
  }

  /** Close the DB (used by tests). */
  close() {
    if (this._db) this._db.close();
    this._db = null;
    this._ready = null;
  }
}

/** App-wide singleton. */
export const store = new DocumentStore();

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Usage numbers for the privacy/storage dialog. */
export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return { usage, quota, persisted };
    }
  } catch {
    /* ignore */
  }
  return null;
}
