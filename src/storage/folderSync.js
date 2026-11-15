/**
 * Folder sync: keeps your documents in a folder you choose on your own device, one small file per
 * document. If that folder is one your own Dropbox / Google Drive / OneDrive / Syncthing client already
 * syncs, your documents follow you between computers. Pagewise itself never talks to the network;
 * it only reads and writes that folder through the browser's File System Access API.
 */
import { store as defaultStore, syncHooks } from './documents.js';
import { buildBackup, parseBackupFull } from '../io/backup.js';

export const SYNC_SUFFIX = '.pagewise.json';
export const TOMBSTONES = 'pagewise-deleted.json';
const STATE_KEY = 'pw-sync';
const HANDLE_DB = 'pagewise-sync';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_FUTURE_MS = 24 * 3600 * 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export const isSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/* ---------- state (what was in sync last time) ---------- */
const blank = () => ({ enabled: false, name: '', synced: {}, deleted: {}, lastRun: 0 });

export function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (s && typeof s === 'object') return { ...blank(), ...s, synced: s.synced || {}, deleted: s.deleted || {} };
  } catch {
    /* fall through */
  }
  return blank();
}
export function saveState(s) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: sync still works for this session */
  }
}

/** Called when a document is deleted here, so the deletion can be passed on at the next sync. */
export function noteDeleted(id) {
  const s = loadState();
  if (!s.enabled) return;
  s.deleted[id] = Date.now();
  saveState(s);
}

/* ---------- remembering the chosen folder ---------- */
function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('h');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await openHandleDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('h', mode);
      const r = fn(tx.objectStore('h'));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const saveHandle = (h) => idbDo('readwrite', (s) => s.put(h, 'dir'));
export const loadHandle = () => idbDo('readonly', (s) => s.get('dir')).catch(() => undefined);
export const clearHandle = () => idbDo('readwrite', (s) => s.delete('dir')).catch(() => {});

/* ---------- directory adapter ---------- */
export function dirAdapter(handle) {
  return {
    async list() {
      const names = [];
      for await (const [name, h] of handle.entries()) if (h.kind === 'file') names.push(name);
      return names;
    },
    async read(name) {
      const fh = await handle.getFileHandle(name);
      const file = await fh.getFile();
      if (file.size > MAX_FILE_BYTES) throw new Error('too large');
      return file.text();
    },
    async write(name, text) {
      const fh = await handle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    },
    async remove(name) {
      try {
        await handle.removeEntry(name);
      } catch {
        /* already gone */
      }
    },
  };
}

export async function hasPermission(handle, write = true) {
  try {
    return (await handle.queryPermission({ mode: write ? 'readwrite' : 'read' })) === 'granted';
  } catch {
    return false;
  }
}
export async function askPermission(handle) {
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/* ---------- the sync itself ---------- */
const fileName = (id) => `${id}${SYNC_SUFFIX}`;

async function readRemote(dir, names, now = Date.now()) {
  const remote = new Map();
  const skipped = [];
  for (const name of names.filter((n) => n.endsWith(SYNC_SUFFIX)).slice(0, MAX_FILES)) {
    const id = name.slice(0, -SYNC_SUFFIX.length);
    if (!SAFE_ID.test(id)) continue;
    try {
      const parsed = parseBackupFull(await dir.read(name));
      const doc = parsed.docs.find((d) => d.id === id) || parsed.docs[0];
      if (!doc) throw new Error('empty');
      doc.id = id;
      // A file claiming to be edited in the far future would win every conflict for ever.
      doc.updatedAt = Math.min(doc.updatedAt, now + MAX_FUTURE_MS);
      const folder = parsed.folders.find((f) => f.id === doc.folderId);
      remote.set(id, { doc, folderName: folder?.name || '', name });
    } catch {
      skipped.push(name);
    }
  }
  return { remote, skipped };
}

async function readTombstones(dir, names) {
  if (!names.includes(TOMBSTONES)) return {};
  try {
    const data = JSON.parse(await dir.read(TOMBSTONES));
    const out = {};
    for (const [id, t] of Object.entries(data?.deleted || {})) if (SAFE_ID.test(id) && Number.isFinite(t)) out[id] = t;
    return out;
  } catch {
    return {};
  }
}

/**
 * Two-way sync between the local store and a folder.
 * Rules per document id, using the time each side was last changed and what was in sync last time:
 *  - only here → copy to the folder (unless the folder deleted it since the last sync and it was not edited here → delete here)
 *  - only in the folder → copy here (unless it was deleted here → delete it from the folder)
 *  - both, same → nothing
 *  - both, one side changed → the changed side wins
 *  - both changed → the newer wins and the older text is kept in version history
 * @returns {{pushed:number, pulled:number, removed:number, conflicts:number, skipped:string[]}}
 */
export async function runSync(dir, { store = defaultStore, state = loadState(), now = Date.now } = {}) {
  const result = { pushed: 0, pulled: 0, removed: 0, conflicts: 0, skipped: [] };
  const names = await dir.list();
  const { remote, skipped } = await readRemote(dir, names, now());
  result.skipped = skipped;
  const tomb = await readTombstones(dir, names);
  const local = new Map((await store.exportAll()).map((d) => [d.id, d]));
  const folders = await store.listFolders();
  const synced = { ...state.synced };
  const deleted = { ...state.deleted };
  const tombstones = { ...tomb };

  const push = async (d) => {
    const folder = d.folderId ? folders.find((f) => f.id === d.folderId) : null;
    await dir.write(fileName(d.id), JSON.stringify(buildBackup([d], folder ? [folder] : [])));
    synced[d.id] = d.updatedAt;
    result.pushed++;
  };
  const pull = async (r) => {
    await store.applySyncedDocument(r.doc, r.folderName);
    synced[r.doc.id] = r.doc.updatedAt;
    result.pulled++;
  };

  // Deletions made here since the last sync.
  for (const [id, t] of Object.entries(deleted)) {
    if (local.has(id)) {
      delete deleted[id]; // re-created or restored since
      continue;
    }
    tombstones[id] = t;
    if (remote.has(id)) {
      await dir.remove(remote.get(id).name);
      remote.delete(id);
      result.removed++;
    }
    delete synced[id];
  }

  const ids = new Set([...local.keys(), ...remote.keys()]);
  for (const id of ids) {
    const l = local.get(id);
    const r = remote.get(id);
    const was = synced[id];
    if (l && !r) {
      if (was !== undefined && l.updatedAt <= was) {
        // It was in the folder at the last sync and is gone now: deleted on another device.
        await store.removeForSync(id);
        delete synced[id];
        tombstones[id] = tombstones[id] || now();
        result.removed++;
      } else {
        await push(l);
      }
    } else if (!l && r) {
      if (tombstones[id] && r.doc.updatedAt <= tombstones[id]) {
        await dir.remove(r.name);
        result.removed++;
      } else {
        await pull(r);
      }
    } else if (l && r) {
      const lChanged = was === undefined || l.updatedAt > was;
      const rChanged = was === undefined || r.doc.updatedAt > was;
      if (l.updatedAt === r.doc.updatedAt && l.title === r.doc.title) {
        synced[id] = l.updatedAt;
      } else if (lChanged && rChanged) {
        result.conflicts++;
        if (r.doc.updatedAt > l.updatedAt) await pull(r); // pull keeps the local text as a version
        else {
          // Local wins: keep the folder's copy in this document's history, then overwrite it.
          if (!r.doc.locked) await store.addVersion(id, { html: r.doc.html, title: r.doc.title, label: 'Other device (sync)' });
          await push(l);
        }
      } else if (rChanged) await pull(r);
      else if (lChanged) await push(l);
    }
    // A document brought back after being deleted must not stay marked as deleted.
    if (local.has(id) || remote.has(id)) delete tombstones[id];
  }

  // Forget bookkeeping for documents that no longer exist anywhere.
  for (const id of Object.keys(synced)) if (!local.has(id) && !remote.has(id) && !(id in tombstones)) delete synced[id];
  // Keep the tombstone file tidy (90 days) and written only when it changed.
  const cutoff = now() - 90 * 24 * 3600 * 1000;
  for (const [id, t] of Object.entries(tombstones)) if (t < cutoff) delete tombstones[id];
  if (JSON.stringify(tombstones) !== JSON.stringify(tomb)) await dir.write(TOMBSTONES, JSON.stringify({ deleted: tombstones }));

  state.synced = synced;
  state.deleted = {};
  state.lastRun = now();
  saveState(state);
  return result;
}

/* ---------- user-facing operations ---------- */
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'pagewise-sync' });
  await saveHandle(handle);
  saveState({ ...blank(), enabled: true, name: handle.name });
  return handle;
}

/** Sync now. Returns null when sync is off or the folder needs permission again. */
let running = null;
export function syncNow(opts = {}) {
  // One run at a time: opening the home screen and pressing Sync now must not interleave.
  if (!running) running = doSync(opts).finally(() => (running = null));
  return running;
}

async function doSync({ interactive = false, store = defaultStore } = {}) {
  const state = loadState();
  if (!state.enabled) return null;
  const handle = await loadHandle();
  if (!handle) return null;
  if (!(await hasPermission(handle))) {
    if (!interactive || !(await askPermission(handle))) return { needsPermission: true };
  }
  return runSync(dirAdapter(handle), { store, state });
}

export async function disableSync() {
  await clearHandle();
  saveState(blank());
}

syncHooks.onDelete = noteDeleted;
