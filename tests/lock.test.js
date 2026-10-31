import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentStore, cryptoSettings } from '../src/storage/documents.js';
import { buildBackup, parseBackupFull } from '../src/io/backup.js';
import { encryptJson, decryptJson, deriveKey, newSalt, isValidBlob } from '../src/storage/crypto.js';

cryptoSettings.iterations = 1000; // fast for tests

let store;
let n = 0;
const make = () => new DocumentStore({ dbName: `pagewise-lock-${++n}` });
beforeEach(() => {
  store = make();
});

describe('crypto', () => {
  it('round-trips and rejects a wrong key', async () => {
    const salt = newSalt();
    const k1 = await deriveKey('correct horse', salt, 1000);
    const k2 = await deriveKey('wrong horse', salt, 1000);
    const blob = await encryptJson(k1, { a: 'héllo' }, salt, 1000);
    expect(isValidBlob(blob)).toBe(true);
    expect(await decryptJson(k1, blob)).toEqual({ a: 'héllo' });
    await expect(decryptJson(k2, blob)).rejects.toBeTruthy();
  });
  it('uses a fresh IV each time and rejects bad blobs', async () => {
    const salt = newSalt();
    const k = await deriveKey('pw-pw-pw-pw', salt, 1000);
    const a = await encryptJson(k, 1, salt, 1000);
    const b = await encryptJson(k, 1, salt, 1000);
    expect(a.iv).not.toBe(b.iv);
    expect(isValidBlob({ ...a, iterations: 1e9 })).toBe(false);
    expect(isValidBlob({ ...a, iv: 'AAAA' })).toBe(false);
    expect(isValidBlob(null)).toBe(false);
  });
});

describe('locked documents', () => {
  it('stores no plaintext, unlocks, edits and unlocks again', async () => {
    const d = await store.createDocument({ title: 'Secret', html: '<p>top secret words</p>' });
    await store.lockDocument(d.id, 'password123');
    const raw = JSON.stringify(await store._get(d.id));
    expect(raw).not.toContain('top secret');
    expect((await store.listDocuments({ query: 'secret words' })).length).toBe(0);

    await store.saveDocument(d.id, { html: '<p>edited secret</p>' });
    expect(JSON.stringify(await store._get(d.id))).not.toContain('edited secret');

    store.forgetKey(d.id);
    const locked = await store.getDocument(d.id);
    expect(locked.locked).toBe(true);
    expect(locked.unlocked).toBeUndefined();
    await expect(store.saveDocument(d.id, { html: '<p>x</p>' })).rejects.toMatchObject({ code: 'locked' });
    await expect(store.unlockDocument(d.id, 'nope-nope')).rejects.toMatchObject({ code: 'wrong-password' });
    const open = await store.unlockDocument(d.id, 'password123');
    expect(open.html).toContain('edited secret');
  });
  it('allows renaming while locked and rejects weak passwords', async () => {
    const d = await store.createDocument({ html: '<p>a</p>' });
    await expect(store.lockDocument(d.id, 'short')).rejects.toMatchObject({ code: 'weak-password' });
    await store.lockDocument(d.id, 'password123');
    store.forgetKey(d.id);
    const r = await store.renameDocument(d.id, 'New name');
    expect(r.title).toBe('New name');
    const open = await store.unlockDocument(d.id, 'password123');
    expect(open.html).toContain('<p>a</p>');
  });
  it('removes the lock and drops history on lock', async () => {
    const d = await store.createDocument({ html: '<p>hello world</p>' });
    await store.addVersion(d.id, { html: '<p>hello world</p>', title: 't' });
    await store.lockDocument(d.id, 'password123');
    expect((await store.listVersions(d.id)).length).toBe(0);
    expect(await store.addVersion(d.id, { html: '<p>zzz</p>', title: 't' })).toBeNull();
    const plain = await store.removeLock(d.id);
    expect(plain.locked).toBeUndefined();
    expect(plain.html).toContain('hello world');
    expect(plain.wordCount).toBe(2);
  });
  it('duplicates ciphertext and survives backup round-trip', async () => {
    const d = await store.createDocument({ html: '<p>backup me</p>' });
    await store.lockDocument(d.id, 'password123');
    const copy = await store.duplicateDocument(d.id);
    store.forgetKey(d.id);
    expect(JSON.stringify(copy)).not.toContain('backup me');
    const text = JSON.stringify(buildBackup(await store.exportAll(), []));
    expect(text).not.toContain('backup me');
    const { docs } = parseBackupFull(text);
    expect(docs.every((x) => x.locked)).toBe(true);
    const fresh = make();
    await fresh.importAll(docs, []);
    const first = (await fresh.exportAll())[0];
    const open = await fresh.unlockDocument(first.id, 'password123');
    expect(open.html).toContain('backup me');
  });
  it('rejects a backup entry with a malformed lock', () => {
    const bad = JSON.stringify({ format: 'pagewise-backup', version: 1, documents: [{ id: 'a', title: 'x', html: '<p></p>', locked: true, crypto: { v: 1, salt: 'x', iv: 'y', iterations: 5, data: 'z' } }] });
    expect(parseBackupFull(bad).docs).toHaveLength(0);
  });
});
