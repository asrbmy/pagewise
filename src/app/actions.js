/** Document-level actions shared by the document list and the editor. */
import { store } from '../storage/documents.js';
import { importFile } from '../io/import.js';
import { getPrefs } from '../settings/prefs.js';

export function openDocument(id) {
  window.location.hash = `#/d/${id}`;
}

export function goHome() {
  window.location.hash = '#/';
}

export async function createNewDocument() {
  return store.createDocument({ pageSize: getPrefs().pageSize });
}

/** Import a file as a brand-new document. Resolves to `{ doc, warnings }`. */
export async function importIntoNewDocument(file) {
  const { title, html, warnings } = await importFile(file);
  const doc = await store.createDocument({ title, html, pageSize: getPrefs().pageSize });
  return { doc, warnings };
}
