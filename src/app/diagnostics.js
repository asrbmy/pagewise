import { getPrefs } from '../settings/prefs.js';
import { store } from '../storage/documents.js';

/** A plain-text report for bug reports. It contains no document titles or content. */
export async function buildDiagnostics() {
  const lines = [];
  const add = (k, v) => lines.push(`${k}: ${v}`);
  add('App', 'Pagewise');
  add('When', new Date().toISOString());
  add('Browser', navigator.userAgent);
  add('Language', navigator.language);
  add('Online', navigator.onLine);
  add('IndexedDB', typeof indexedDB !== 'undefined');
  add('Web Crypto', typeof crypto !== 'undefined' && !!crypto.subtle);
  add('Service worker', 'serviceWorker' in navigator);
  try {
    add('Persistent storage', navigator.storage?.persisted ? await navigator.storage.persisted() : 'unknown');
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    if (est) add('Storage used / quota (MB)', `${((est.usage || 0) / 1048576).toFixed(1)} / ${((est.quota || 0) / 1048576).toFixed(0)}`);
  } catch {
    add('Storage', 'unavailable');
  }
  try {
    const docs = await store.listDocuments({});
    add('Documents', docs.length);
    add('Locked documents', docs.filter((d) => d.locked).length);
    add('Storage mode', store.persistent ? 'IndexedDB' : 'memory only');
  } catch (err) {
    add('Document list error', err && err.code ? err.code : 'unknown');
  }
  const p = getPrefs();
  add('Preferences', JSON.stringify({ theme: p.theme, language: p.language, pagination: p.pagination, autoLockMinutes: p.autoLockMinutes }));
  return lines.join('\n');
}
