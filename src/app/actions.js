/** Document-level actions shared by the document list and the editor. */
import { store } from '../storage/documents.js';
import { importFile } from '../io/import.js';
import { getTemplate } from '../editor/templates.js';
import { getPrefs } from '../settings/prefs.js';

export function openDocument(id) {
  window.location.hash = `#/d/${id}`;
}

export function goHome() {
  window.location.hash = '#/';
}

export async function createNewDocument(folderId = null) {
  return store.createDocument({ pageSize: getPrefs().pageSize, folderId });
}

export async function createFromTemplate(id, folderId = null) {
  const t = getTemplate(id);
  return store.createDocument({ title: t.title, html: t.html, pageSize: getPrefs().pageSize, folderId });
}

/** Import a file as a brand-new document. Resolves to `{ doc, warnings }`. */
export async function importIntoNewDocument(file) {
  const { title, html, warnings } = await importFile(file);
  const doc = await store.createDocument({ title, html, pageSize: getPrefs().pageSize });
  return { doc, warnings };
}
