import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentStore, StorageError, MAX_AUTO_VERSIONS } from '../src/storage/documents.js';
import { htmlToPlainText, countWords, makeSnippet } from '../src/storage/text.js';

let store;
let n = 0;
beforeEach(() => {
  n += 1;
  store = new DocumentStore({ dbName: `pagewise-test-${n}` });
});
afterEach(() => store.close());

describe('DocumentStore (IndexedDB)', () => {
  it('opens a persistent database', async () => {
    expect(await store.init()).toBe(true);
    expect(store.persistent).toBe(true);
  });

  it('creates, reads, renames and deletes documents', async () => {
    const doc = await store.createDocument({ title: 'First', html: '<p>Hello <strong>there</strong></p>' });
    expect(doc.wordCount).toBe(2);
    const loaded = await store.getDocument(doc.id);
    expect(loaded.html).toBe('<p>Hello <strong>there</strong></p>');

    await new Promise((r) => setTimeout(r, 5));
    const renamed = await store.renameDocument(doc.id, '  Renamed  ');
    expect(renamed.title).toBe('Renamed');
    expect(renamed.updatedAt).toBeGreaterThan(doc.updatedAt);

    await store.deleteDocument(doc.id);
    expect(await store.getDocument(doc.id)).toBeNull();
    expect(await store.count()).toBe(0);
  });

  it('falls back to "Untitled document" for blank titles', async () => {
    const doc = await store.createDocument({ title: '   ' });
    expect(doc.title).toBe('Untitled document');
  });

  it('persists content across a fresh connection (simulated reload)', async () => {
    const doc = await store.createDocument({ title: 'Persist me', html: '<h1>Saved</h1><p>body text</p>' });
    await store.saveDocument(doc.id, { html: '<h1>Saved</h1><p>edited body</p>' });
    store.close();
    const reopened = new DocumentStore({ dbName: store.dbName });
    const loaded = await reopened.getDocument(doc.id);
    expect(loaded.html).toContain('edited body');
    expect(loaded.text).toContain('edited body');
    reopened.close();
  });

  it('duplicates a document with new id and title', async () => {
    const doc = await store.createDocument({ title: 'Original', html: '<p>content</p>' });
    const copy = await store.duplicateDocument(doc.id);
    expect(copy.id).not.toBe(doc.id);
    expect(copy.title).toBe('Copy of Original');
    expect(copy.html).toBe(doc.html);
    expect(await store.count()).toBe(2);
  });

  it('searches title and content case-insensitively and returns snippets', async () => {
    await store.createDocument({ title: 'Meeting notes', html: '<p>Budget review on Friday</p>' });
    await store.createDocument({ title: 'Recipes', html: '<p>Banana bread with walnuts</p>' });
    expect((await store.listDocuments({ query: 'meeting' })).map((d) => d.title)).toEqual(['Meeting notes']);
    const byContent = await store.listDocuments({ query: 'WALNUTS' });
    expect(byContent).toHaveLength(1);
    expect(byContent[0].snippet).toContain('walnuts');
    expect(byContent[0].html).toBeUndefined();
    expect(await store.listDocuments({ query: 'nothing-here' })).toHaveLength(0);
  });

  it('sorts by name and modification date', async () => {
    const a = await store.createDocument({ title: 'banana' });
    await new Promise((r) => setTimeout(r, 5));
    await store.createDocument({ title: 'Apple' });
    await new Promise((r) => setTimeout(r, 5));
    await store.createDocument({ title: 'cherry' });
    await new Promise((r) => setTimeout(r, 5));
    await store.saveDocument(a.id, { html: '<p>touched</p>' });

    const names = async (sort) => (await store.listDocuments({ sort })).map((d) => d.title);
    expect(await names('name-asc')).toEqual(['Apple', 'banana', 'cherry']);
    expect(await names('name-desc')).toEqual(['cherry', 'banana', 'Apple']);
    expect((await names('modified-desc'))[0]).toBe('banana');
    expect((await names('modified-asc'))[2]).toBe('banana');
  });

  it('refuses to save a document that was deleted elsewhere', async () => {
    const doc = await store.createDocument({ title: 'gone' });
    await store.deleteDocument(doc.id);
    await expect(store.saveDocument(doc.id, { html: '<p>x</p>' })).rejects.toBeInstanceOf(StorageError);
  });

  it('round-trips a backup without overwriting existing documents', async () => {
    const a = await store.createDocument({ title: 'A', html: '<p>alpha</p>' });
    await store.createDocument({ title: 'B', html: '<p>beta</p>' });
    const backup = await store.exportAll();
    expect(backup).toHaveLength(2);

    const result = await store.importAll(backup);
    expect(result.copied).toBe(2);
    expect(await store.count()).toBe(4);
    const titles = (await store.listDocuments()).map((d) => d.title).sort();
    expect(titles).toContain('A (restored)');
    expect((await store.getDocument(a.id)).title).toBe('A');

    const fresh = new DocumentStore({ dbName: `${store.dbName}-fresh` });
    const r2 = await fresh.importAll(backup);
    expect(r2).toEqual({ added: 2, copied: 0 });
    fresh.close();
  });

  it('does not lose a rename when an autosave races with it', async () => {
    const doc = await store.createDocument({ title: 'Old', html: '<p>one</p>' });
    await Promise.all([
      store.saveDocument(doc.id, { html: '<p>two</p>' }),
      store.renameDocument(doc.id, 'New title'),
      store.saveDocument(doc.id, { html: '<p>three</p>' }),
    ]);
    const loaded = await store.getDocument(doc.id);
    expect(loaded.title).toBe('New title');
    expect(loaded.html).toBe('<p>three</p>');
  });

  it('falls back to memory mode when IndexedDB cannot be opened', async () => {
    const original = globalThis.indexedDB;
    // eslint-disable-next-line no-undef
    globalThis.indexedDB = undefined;
    try {
      const mem = new DocumentStore({ dbName: 'unavailable' });
      expect(await mem.init()).toBe(false);
      expect(mem.persistent).toBe(false);
      expect(mem.initError).toBeInstanceOf(StorageError);
      const doc = await mem.createDocument({ title: 'in memory' });
      expect((await mem.getDocument(doc.id)).title).toBe('in memory');
    } finally {
      globalThis.indexedDB = original;
    }
  });
});

describe('text helpers', () => {
  it('converts HTML to plain text with paragraph breaks', () => {
    expect(htmlToPlainText('<h1>Title</h1><p>one<br>two</p><ul><li>a</li><li>b</li></ul>')).toBe('Title\none\ntwo\na\nb');
  });
  it('counts words', () => {
    expect(countWords('  one   two\nthree ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
  it('makes snippets around matches', () => {
    expect(makeSnippet('a '.repeat(100) + 'needle ' + 'b '.repeat(100), 'needle')).toContain('needle');
  });
});

describe('version history', () => {
  let s;
  beforeEach(async () => {
    s = new DocumentStore({ dbName: 'v-' + Math.random() });
    await s.init();
  });

  it('records snapshots newest-first and skips identical automatic ones', async () => {
    const d = await s.createDocument({ html: '<p>one</p>' });
    await s.addVersion(d.id, { html: '<p>one</p>', title: d.title });
    expect(await s.addVersion(d.id, { html: '<p>one</p>', title: d.title })).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await s.addVersion(d.id, { html: '<p>two</p>', title: d.title });
    const list = await s.listVersions(d.id);
    expect(list).toHaveLength(2);
    expect(list[0].wordCount).toBe(1);
    expect(list[0].html).toBeUndefined();
  });

  it('keeps named versions even when identical, and prunes only automatic ones', async () => {
    const d = await s.createDocument({ html: '<p>x</p>' });
    await s.addVersion(d.id, { html: '<p>x</p>', title: 't', label: 'Draft 1' });
    for (let i = 0; i < MAX_AUTO_VERSIONS + 5; i += 1) {
      await s.addVersion(d.id, { html: `<p>v${i}</p>`, title: 't' }); // eslint-disable-line no-await-in-loop
    }
    const list = await s.listVersions(d.id);
    expect(list.filter((v) => v.label === 'Draft 1')).toHaveLength(1);
    expect(list.filter((v) => !v.label)).toHaveLength(MAX_AUTO_VERSIONS);
  });

  it('restores a version and snapshots the content it replaced', async () => {
    const d = await s.createDocument({ html: '<p>original</p>' });
    const v = await s.addVersion(d.id, { html: '<p>original</p>', title: d.title });
    await s.saveDocument(d.id, { html: '<p>edited</p>' });
    const restored = await s.restoreVersion(d.id, v.vid);
    expect(restored.html).toBe('<p>original</p>');
    const list = await s.listVersions(d.id);
    expect(list.some((x) => x.label === 'Before restore')).toBe(true);
    const before = await s.getVersion(list.find((x) => x.label === 'Before restore').vid);
    expect(before.html).toBe('<p>edited</p>');
  });

  it('refuses a version that belongs to another document, and deletes versions with the document', async () => {
    const a = await s.createDocument({});
    const b = await s.createDocument({});
    const v = await s.addVersion(a.id, { html: '<p>a</p>', title: 'a' });
    await expect(s.restoreVersion(b.id, v.vid)).rejects.toThrow(/no longer exists/);
    await s.deleteDocument(a.id);
    expect(await s.listVersions(a.id)).toHaveLength(0);
  });
});

describe('folders', () => {
  let s;
  beforeEach(async () => {
    s = new DocumentStore({ dbName: 'f-' + Math.random() });
    await s.init();
  });

  it('creates, renames and rejects empty or duplicate folder names', async () => {
    const a = await s.createFolder('  Work ');
    expect(a.name).toBe('Work');
    await expect(s.createFolder('work')).rejects.toThrow(/already exists/);
    await expect(s.createFolder('   ')).rejects.toThrow(/name/);
    const r = await s.renameFolder(a.id, 'Office');
    expect(r.name).toBe('Office');
    await s.createFolder('Home');
    await expect(s.renameFolder(a.id, 'home')).rejects.toThrow(/already exists/);
    expect((await s.listFolders()).map((f) => f.name)).toEqual(['Home', 'Office']);
  });

  it('files documents, filters by folder, and keeps the modified date when moving', async () => {
    const f = await s.createFolder('Work');
    const d1 = await s.createDocument({ title: 'in work' });
    const d2 = await s.createDocument({ title: 'loose' });
    const before = (await s.getDocument(d1.id)).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await s.setFolder(d1.id, f.id);
    expect((await s.getDocument(d1.id)).updatedAt).toBe(before);
    expect((await s.listDocuments({ folder: f.id })).map((d) => d.title)).toEqual(['in work']);
    expect((await s.listDocuments({ folder: 'none' })).map((d) => d.title)).toEqual(['loose']);
    expect(await s.listDocuments({ folder: 'all' })).toHaveLength(2);
    await expect(s.setFolder(d2.id, 'nope')).rejects.toThrow(/no longer exists/);
  });

  it('deleting a folder keeps its documents, which become unfiled', async () => {
    const f = await s.createFolder('Temp');
    const d = await s.createDocument({ title: 'keep me', folderId: f.id });
    await s.deleteFolder(f.id);
    expect(await s.listFolders()).toHaveLength(0);
    const got = await s.getDocument(d.id);
    expect(got.title).toBe('keep me');
    expect(got.folderId).toBeNull();
  });

  it('backs up and restores folders without duplicating existing ones', async () => {
    const { buildBackup, parseBackupFull } = await import('../src/io/backup.js');
    const f = await s.createFolder('Work');
    await s.createDocument({ title: 'a', folderId: f.id });
    const backup = buildBackup(await s.exportAll(), await s.listFolders());
    const parsed = parseBackupFull(JSON.stringify(backup));
    expect(parsed.folders).toEqual([{ id: f.id, name: 'Work' }]);
    expect(parsed.docs[0].folderId).toBe(f.id);

    const fresh = new DocumentStore({ dbName: 'f2-' + Math.random() });
    await fresh.init();
    await fresh.importAll(parsed.docs, parsed.folders);
    const folders = await fresh.listFolders();
    expect(folders.map((x) => x.name)).toEqual(['Work']);
    expect((await fresh.listDocuments({ folder: folders[0].id })).map((d) => d.title)).toEqual(['a']);
    await fresh.importAll(parsed.docs, parsed.folders); // again: no second "Work"
    expect(await fresh.listFolders()).toHaveLength(1);
  });

  it('drops folder ids that the backup does not define', async () => {
    const { parseBackupFull } = await import('../src/io/backup.js');
    const text = JSON.stringify({ format: 'pagewise-backup', version: 1, folders: [], documents: [{ html: '<p>x</p>', folderId: 'ghost' }] });
    expect(parseBackupFull(text).docs[0].folderId).toBeNull();
  });
});
