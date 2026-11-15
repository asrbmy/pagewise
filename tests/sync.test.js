import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentStore } from '../src/storage/documents.js';
import { runSync, SYNC_SUFFIX, TOMBSTONES } from '../src/storage/folderSync.js';

let n = 0;
const mk = () => new DocumentStore({ dbName: `pagewise-sync-${++n}` });
const fakeDir = (files = new Map()) => ({
  files,
  list: async () => [...files.keys()],
  read: async (k) => files.get(k),
  write: async (k, v) => void files.set(k, v),
  remove: async (k) => void files.delete(k),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blank = () => ({ enabled: true, name: 'x', synced: {}, deleted: {}, lastRun: 0 });
const edit = async (s, id, html) => {
  const d = await s._get(id);
  await s._put({ ...d, html, text: html.replace(/<[^>]+>/g, ''), updatedAt: Date.now() });
};

describe('folder sync', () => {
  let A, B, dir, sa, sb;
  beforeEach(() => {
    A = mk();
    B = mk();
    dir = fakeDir();
    sa = blank();
    sb = blank();
  });
  const syncA = () => runSync(dir, { store: A, state: sa });
  const syncB = () => runSync(dir, { store: B, state: sb });

  it('copies a new document to the folder and to a second device', async () => {
    const d = await A.createDocument({ title: 'Hello', html: '<p>one</p>' });
    expect((await syncA()).pushed).toBe(1);
    expect([...dir.files.keys()]).toContain(d.id + SYNC_SUFFIX);
    const r = await syncB();
    expect(r.pulled).toBe(1);
    expect((await B.getDocument(d.id)).html).toContain('one');
  });

  it('passes edits both ways', async () => {
    const d = await A.createDocument({ html: '<p>one</p>' });
    await syncA();
    await syncB();
    await sleep(5);
    await edit(B, d.id, '<p>two</p>');
    await syncB();
    expect((await syncA()).pulled).toBe(1);
    expect((await A.getDocument(d.id)).html).toContain('two');
  });

  it('is quiet when nothing changed', async () => {
    await A.createDocument({});
    await syncA();
    const r = await syncA();
    expect(r).toMatchObject({ pushed: 0, pulled: 0, removed: 0, conflicts: 0 });
  });

  it('passes deletions on', async () => {
    const d = await A.createDocument({ html: '<p>x</p>' });
    await syncA();
    await syncB();
    sb.deleted[d.id] = Date.now();
    await B.removeForSync(d.id);
    await syncB();
    expect(dir.files.has(d.id + SYNC_SUFFIX)).toBe(false);
    expect(dir.files.has(TOMBSTONES)).toBe(true);
    expect((await syncA()).removed).toBe(1);
    expect(await A.getDocument(d.id)).toBeNull();
  });

  it('keeps a document edited here when the folder copy was deleted elsewhere', async () => {
    const d = await A.createDocument({ html: '<p>x</p>' });
    await syncA();
    await sleep(5);
    await edit(A, d.id, '<p>edited</p>');
    dir.files.delete(d.id + SYNC_SUFFIX);
    await syncA();
    expect(dir.files.has(d.id + SYNC_SUFFIX)).toBe(true);
  });

  it('resolves a conflict with the newer edit and keeps the other in history', async () => {
    const d = await A.createDocument({ html: '<p>base</p>' });
    await syncA();
    await syncB();
    await sleep(5);
    await edit(A, d.id, '<p>from A</p>');
    await sleep(5);
    await edit(B, d.id, '<p>from B</p>');
    await syncB(); // B pushes
    const r = await syncA();
    expect(r.conflicts).toBe(1);
    expect((await A.getDocument(d.id)).html).toContain('from B');
    const versions = await A.listVersions(d.id);
    expect(versions.some((v) => v.label === 'Before sync')).toBe(true);
  });

  it('skips damaged or unsafe files without failing', async () => {
    dir.files.set('bad' + SYNC_SUFFIX, '{nope');
    dir.files.set('../evil' + SYNC_SUFFIX, '{}');
    await A.createDocument({});
    const r = await syncA();
    expect(r.skipped).toEqual(['bad' + SYNC_SUFFIX]);
    expect(r.pushed).toBe(1);
  });

  it('sanitises content that arrives from the folder', async () => {
    const d = await A.createDocument({ html: '<p>ok</p>' });
    await syncA();
    const f = d.id + SYNC_SUFFIX;
    const j = JSON.parse(dir.files.get(f));
    j.documents[0].html = '<p>ok</p><img src=x onerror=alert(1)><script>alert(2)</script>';
    j.documents[0].updatedAt += 1000;
    dir.files.set(f, JSON.stringify(j));
    await syncA();
    const html = (await A.getDocument(d.id)).html;
    expect(html).not.toMatch(/onerror|<script/i);
  });

  it('recreates folders by name', async () => {
    const f = await A.createFolder('Work');
    const d = await A.createDocument({ folderId: f.id });
    await syncA();
    await syncB();
    const got = await B.getDocument(d.id);
    const folders = await B.listFolders();
    expect(folders.find((x) => x.id === got.folderId)?.name).toBe('Work');
  });
});

describe('folder sync hardening', () => {
  it('does not let a far-future timestamp win every conflict', async () => {
    const A = mk();
    const dir = fakeDir();
    const st = blank();
    const d = await A.createDocument({ html: '<p>x</p>' });
    await runSync(dir, { store: A, state: st });
    const f = d.id + SYNC_SUFFIX;
    const j = JSON.parse(dir.files.get(f));
    j.documents[0].updatedAt = 32503680000000; // year 3000
    j.documents[0].html = '<p>future</p>';
    dir.files.set(f, JSON.stringify(j));
    await runSync(dir, { store: A, state: st });
    const after = await A._get(d.id);
    expect(after.updatedAt).toBeLessThan(Date.now() + 2 * 24 * 3600 * 1000);
  });
});
