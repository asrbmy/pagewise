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
import { deriveKey, newSalt, encryptJson, decryptJson, fromB64, cryptoAvailable, DEFAULT_ITERATIONS, MIN_PASSWORD } from './crypto.js';
import { openDB } from 'idb';
import { normalizeLayout } from '../editor/layout.js';
import { stripComments } from '../io/prepare.js';
import { normalizeComments } from '../editor/comments.js';
import { htmlToPlainText, countWords, countCharacters, makeSnippet } from './text.js';

export const DB_NAME = 'pagewise';
export const DB_VERSION = 3;
export const FOLDERS = 'folders';
export const STORE = 'documents';
export const VERSIONS = 'versions';
export const MAX_AUTO_VERSIONS = 40;
export const AUTO_VERSION_INTERVAL = 10 * 60 * 1000;
export const EMPTY_HTML = '<p></p>';
// Lowered by tests; real use keeps the default.
export const cryptoSettings = { iterations: DEFAULT_ITERATIONS };

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
    this.memoryVersions = new Map();
    this.memoryFolders = new Map();
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
            upgrade(db, oldVersion) {
              if (oldVersion < 1) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt');
              }
              if (oldVersion < 2) {
                const versions = db.createObjectStore(VERSIONS, { keyPath: 'vid' });
                versions.createIndex('docId', 'docId');
              }
              if (oldVersion < 3) db.createObjectStore(FOLDERS, { keyPath: 'id' });
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

  _keys = new Map();

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
  async createDocument({ title = 'Untitled document', html = EMPTY_HTML, pageSize = 'letter', layout, folderId = null } = {}) {
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
      layout: normalizeLayout(layout),
      folderId,
      createdAt: now,
      updatedAt: now,
    };
    await this._put(doc);
    return doc;
  }

  /** Full document (including HTML) or null. */
  async getDocument(id) {
    const doc = await this._get(id);
    if (!doc) return null;
    if (doc.locked && this._keys.has(id)) {
      try {
        const { html, comments } = await decryptJson(this._keys.get(id).key, doc.crypto);
        return { ...doc, html, comments: normalizeComments(comments), unlocked: true };
      } catch {
        this._keys.delete(id);
        return doc;
      }
    }
    return doc;
  }

  hasKey(id) {
    return this._keys.has(id);
  }

  /** Forget the key so the document must be unlocked again. */
  forgetKey(id) {
    this._keys.delete(id);
  }

  /** Encrypt a document with a password. Its history is deleted (it would hold plaintext). */
  lockDocument(id, password) {
    return this._serial(async () => {
      if (!cryptoAvailable()) throw new StorageError('This browser cannot encrypt documents (Web Crypto is unavailable).', 'crypto');
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new StorageError(`Use a password of at least ${MIN_PASSWORD} characters.`, 'weak-password');
      const doc = await this._get(id);
      if (!doc) throw new StorageError('This document no longer exists in browser storage.', 'missing');
      if (doc.locked) throw new StorageError('This document is already locked.', 'locked');
      const salt = newSalt();
      const iterations = cryptoSettings.iterations;
      const key = await deriveKey(password, salt, iterations);
      const blob = await encryptJson(key, { html: doc.html, comments: doc.comments || [] }, salt, iterations);
      const next = { ...doc, html: EMPTY_HTML, text: '', wordCount: 0, charCount: 0, comments: [], locked: true, crypto: blob };
      await this._put(next);
      await this._deleteVersionsOf(id);
      this._keys.set(id, { key, salt, iterations });
      return next;
    });
  }

  /** Unlock for this session. Throws StorageError('wrong-password') on a bad password. */
  async unlockDocument(id, password) {
    const doc = await this._get(id);
    if (!doc) throw new StorageError('This document no longer exists in browser storage.', 'missing');
    if (!doc.locked) return doc;
    const salt = fromB64(doc.crypto.salt);
    const key = await deriveKey(String(password), salt, doc.crypto.iterations);
    try {
      await decryptJson(key, doc.crypto);
    } catch {
      throw new StorageError('That password is not correct.', 'wrong-password');
    }
    this._keys.set(id, { key, salt, iterations: doc.crypto.iterations });
    return this.getDocument(id);
  }

  /** Permanently remove the password (requires the document to be unlocked). */
  removeLock(id) {
    return this._serial(async () => {
      const doc = await this._get(id);
      if (!doc || !doc.locked) return doc;
      if (!this._keys.has(id)) throw new StorageError('Unlock the document first.', 'locked');
      const { html, comments } = await decryptJson(this._keys.get(id).key, doc.crypto);
      const text = htmlToPlainText(html);
      const { crypto: _c, locked: _l, ...rest } = doc; // eslint-disable-line no-unused-vars
      const next = { ...rest, html, text, wordCount: countWords(text), charCount: countCharacters(text), comments: normalizeComments(comments) };
      await this._put(next);
      this._keys.delete(id);
      return next;
    });
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
    if (existing.locked) return this._saveLocked(existing, changes);
    const next = { ...existing, ...changes };
    if (typeof changes.html === 'string') {
      next.text = htmlToPlainText(changes.html);
      next.wordCount = countWords(next.text);
      next.charCount = countCharacters(next.text);
    }
    if ('layout' in changes) next.layout = normalizeLayout(changes.layout);
    if ('comments' in changes) next.comments = normalizeComments(changes.comments);
    if (typeof changes.title === 'string') next.title = changes.title.trim() || 'Untitled document';
    next.updatedAt = changes.updatedAt || Date.now();
    await this._put(next);
    return next;
  }

  async _saveLocked(existing, changes) {
    const entry = this._keys.get(existing.id);
    const touchesContent = typeof changes.html === 'string' || 'comments' in changes;
    if (!entry && touchesContent) throw new StorageError('This document is locked. Unlock it to keep editing.', 'locked');
    const { html: _h, comments: _c, ...meta } = changes; // eslint-disable-line no-unused-vars
    const next = { ...existing, ...meta, html: EMPTY_HTML, text: '', comments: [] };
    let payload = null;
    if (entry && touchesContent) {
      const current = await decryptJson(entry.key, existing.crypto);
      payload = {
        html: typeof changes.html === 'string' ? changes.html : current.html,
        comments: 'comments' in changes ? normalizeComments(changes.comments) : current.comments || [],
      };
      next.crypto = await encryptJson(entry.key, payload, entry.salt, entry.iterations);
    }
    if ('layout' in changes) next.layout = normalizeLayout(changes.layout);
    if (typeof changes.title === 'string') next.title = changes.title.trim() || 'Untitled document';
    if (typeof changes.html === 'string') {
      const text = htmlToPlainText(changes.html);
      next.wordCount = countWords(text);
      next.charCount = countCharacters(text);
    }
    next.updatedAt = changes.updatedAt || Date.now();
    await this._put(next);
    return payload ? { ...next, html: payload.html, comments: payload.comments, unlocked: true } : next;
  }

  async renameDocument(id, title) {
    return this.saveDocument(id, { title });
  }

  async duplicateDocument(id) {
    const src = await this._get(id);
    if (!src) throw new StorageError('The document to copy was not found.', 'missing');
    if (src.locked) {
      // The copy keeps the same password; the ciphertext is copied as is.
      const copy = await this.createDocument({ title: `Copy of ${src.title}`, pageSize: src.pageSize, layout: src.layout, folderId: src.folderId });
      const next = { ...copy, locked: true, crypto: src.crypto, wordCount: src.wordCount, charCount: src.charCount };
      await this._put(next);
      return next;
    }
    return this.createDocument({ title: `Copy of ${src.title}`, html: stripComments(src.html), pageSize: src.pageSize, layout: src.layout, folderId: src.folderId });
  }

  async deleteDocument(id) {
    await this._delete(id);
    await this._deleteVersionsOf(id);
  }

  // ------------------------------------------------------------ folders

  async listFolders() {
    await this.init();
    try {
      const all = this._db ? await this._db.getAll(FOLDERS) : [...this.memoryFolders.values()];
      return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } catch (err) {
      throw classify(err);
    }
  }

  async _putFolder(f) {
    await this.init();
    try {
      if (this._db) await this._db.put(FOLDERS, f);
      else this.memoryFolders.set(f.id, f);
    } catch (err) {
      throw classify(err);
    }
  }

  async createFolder(name) {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) throw new StorageError('Give the folder a name.', 'invalid');
    const existing = await this.listFolders();
    if (existing.some((f) => f.name.toLowerCase() === clean.toLowerCase())) throw new StorageError(`A folder named "${clean}" already exists.`, 'invalid');
    const folder = { id: newId(), name: clean, createdAt: Date.now() };
    await this._putFolder(folder);
    return folder;
  }

  async renameFolder(id, name) {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) throw new StorageError('Give the folder a name.', 'invalid');
    const all = await this.listFolders();
    const folder = all.find((f) => f.id === id);
    if (!folder) throw new StorageError('That folder no longer exists.', 'missing');
    if (all.some((f) => f.id !== id && f.name.toLowerCase() === clean.toLowerCase())) throw new StorageError(`A folder named "${clean}" already exists.`, 'invalid');
    const next = { ...folder, name: clean };
    await this._putFolder(next);
    return next;
  }

  /** Delete a folder. Its documents are kept and become unfiled. */
  async deleteFolder(id) {
    const docs = (await this._getAll()).filter((d) => d.folderId === id);
    for (const d of docs) await this.setFolder(d.id, null); // eslint-disable-line no-await-in-loop
    await this.init();
    try {
      if (this._db) await this._db.delete(FOLDERS, id);
      else this.memoryFolders.delete(id);
    } catch (err) {
      throw classify(err);
    }
  }

  /** Move a document into a folder (or out of all folders with null) without touching its modified date. */
  async setFolder(docId, folderId) {
    if (folderId) {
      const exists = (await this.listFolders()).some((f) => f.id === folderId);
      if (!exists) throw new StorageError('That folder no longer exists.', 'missing');
    }
    return this.saveDocument(docId, { folderId: folderId || null, updatedAt: (await this._get(docId))?.updatedAt });
  }

  // ------------------------------------------------------------ version history

  async _versionsOf(docId) {
    await this.init();
    try {
      if (!this._db) return [...this.memoryVersions.values()].filter((v) => v.docId === docId);
      return await this._db.getAllFromIndex(VERSIONS, 'docId', docId);
    } catch (err) {
      throw classify(err);
    }
  }

  async _deleteVersionsOf(docId) {
    const all = await this._versionsOf(docId);
    for (const v of all) await this.deleteVersion(v.vid); // eslint-disable-line no-await-in-loop
  }

  /**
   * Store a snapshot of a document. Automatic snapshots (no label) are skipped when identical to
   * the newest snapshot and are pruned to MAX_AUTO_VERSIONS; named snapshots are kept until deleted.
   * @returns {Promise<object|null>} the snapshot, or null when skipped as a duplicate
   */
  addVersion(docId, { html, title, label = '' }) {
    return this._serial(async () => {
      const owner = await this._get(docId);
      if (owner && owner.locked) return null; // snapshots would hold plaintext
      const all = (await this._versionsOf(docId)).sort((a, b) => b.createdAt - a.createdAt);
      if (all[0] && all[0].html === html && !label) return null;
      const text = htmlToPlainText(html);
      const version = {
        vid: newId(),
        docId,
        title: title || 'Untitled document',
        html,
        wordCount: countWords(text),
        label: String(label || '').trim().slice(0, 80),
        createdAt: Date.now(),
      };
      await this._putVersion(version);
      const autos = all.filter((v) => !v.label);
      if (!version.label) autos.unshift(version);
      for (const old of autos.slice(MAX_AUTO_VERSIONS)) await this._removeVersion(old.vid); // eslint-disable-line no-await-in-loop
      return version;
    });
  }

  async _putVersion(v) {
    await this.init();
    try {
      if (!this._db) this.memoryVersions.set(v.vid, v);
      else await this._db.put(VERSIONS, v);
    } catch (err) {
      throw classify(err);
    }
  }

  async _removeVersion(vid) {
    await this.init();
    try {
      if (!this._db) this.memoryVersions.delete(vid);
      else await this._db.delete(VERSIONS, vid);
    } catch (err) {
      throw classify(err);
    }
  }

  deleteVersion(vid) {
    return this._removeVersion(vid);
  }

  /** Snapshots of a document, newest first, without their HTML. */
  async listVersions(docId) {
    const all = await this._versionsOf(docId);
    return all.sort((a, b) => b.createdAt - a.createdAt).map(({ html, ...meta }) => meta); // eslint-disable-line no-unused-vars
  }

  async getVersion(vid) {
    await this.init();
    try {
      return (this._db ? await this._db.get(VERSIONS, vid) : this.memoryVersions.get(vid)) || null;
    } catch (err) {
      throw classify(err);
    }
  }

  /**
   * Put a snapshot's content back into the document. The current content is snapshotted first
   * so a restore can itself be undone.
   */
  async restoreVersion(docId, vid) {
    const v = await this.getVersion(vid);
    if (!v || v.docId !== docId) throw new StorageError('That version no longer exists.', 'missing');
    const current = await this._get(docId);
    if (current) await this.addVersion(docId, { html: current.html, title: current.title, label: 'Before restore' });
    return this.saveDocument(docId, { html: v.html });
  }

  /**
   * List document summaries. `query` matches title and content (case-insensitive).
   * @param {{query?: string, sort?: keyof typeof SORTS}} opts
   */
  async listDocuments({ query = '', sort = 'modified-desc', folder = 'all' } = {}) {
    const all = await this._getAll();
    const q = query.trim().toLowerCase();
    const cmp = (SORTS[sort] || SORTS['modified-desc']).cmp;
    return all
      .filter((d) => folder === 'all' || (folder === 'none' ? !d.folderId : d.folderId === folder))
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
  async importAll(docs, folders = []) {
    let added = 0;
    let copied = 0;
    // Folders are matched by name so a restore never creates duplicates of an existing folder.
    const have = await this.listFolders();
    const idMap = new Map();
    for (const f of folders) {
      const same = have.find((h) => h.name.toLowerCase() === f.name.toLowerCase());
      if (same) idMap.set(f.id, same.id);
      else {
        const made = await this.createFolder(f.name); // eslint-disable-line no-await-in-loop
        have.push(made);
        idMap.set(f.id, made.id);
      }
    }
    for (const d of docs) {
      const exists = await this._get(d.id);
      const doc = { ...d, folderId: d.folderId && idMap.has(d.folderId) ? idMap.get(d.folderId) : null };
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
