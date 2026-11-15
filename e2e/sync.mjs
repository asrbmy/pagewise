import { launch, watch, BASE, sleep, clickText, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const log = []; watch(page, log);
// Stand in for the native folder picker with the browser's private file system (same handle API).
await page.evaluateOnNewDocument(() => {
  const P = FileSystemDirectoryHandle.prototype;
  P.queryPermission = async () => 'granted'; P.requestPermission = async () => 'granted';
  window.showDirectoryPicker = async () => { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('syncdir', { create: true }); };
});
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Synced body text'); await sleep(1200);
await page.goto(BASE, { waitUntil: 'networkidle0' }); await page.waitForSelector('.home-main');
await page.click('[data-testid=sync-open]'); await page.waitForSelector('.dialog');
await clickText(page, '.dialog button', 'Choose folder'); await sleep(1500);
assert(await page.$eval('.dialog', (e) => /Syncing with the folder "syncdir"/.test(e.textContent)), 'dialog shows folder');
assert(await page.$eval('.dialog', (e) => /1 saved to the folder/.test(e.textContent)), 'first sync saved one document');
const files = () => page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('syncdir'); const out = {}; for await (const [n, h] of d.entries()) out[n] = await (await h.getFile()).text(); return out; });
let f = await files(); const name = Object.keys(f).find((n) => n.endsWith('.pagewise.json'));
assert(name && f[name].includes('Synced body text'), 'file written into the folder');
// Change the file as another device would, then reopen the app: it should pick the change up by itself.
await page.evaluate(async (name) => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('syncdir');
  const fh = await d.getFileHandle(name); const j = JSON.parse(await (await fh.getFile()).text());
  j.documents[0].title = 'Edited elsewhere'; j.documents[0].html = '<p>Remote text</p>'; j.documents[0].updatedAt += 60000;
  const w = await fh.createWritable(); await w.write(JSON.stringify(j)); await w.close();
}, name);
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.home-main'); await sleep(1500);
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.home-main'); await sleep(800);
assert(await page.$eval('.doc-grid', (e) => e.textContent.includes('Edited elsewhere')), 'remote change arrived on its own');
// Deleting here removes it from the folder.
await page.click('button[aria-label^="Actions for"]'); await clickText(page, '[role^=menuitem]', 'Delete', { exact: false });
await page.waitForSelector('.dialog'); await clickText(page, '.dialog button', 'Delete', { exact: false }); await sleep(800);
await page.click('[data-testid=sync-open]'); await page.waitForSelector('.dialog'); await clickText(page, '.dialog button', 'Sync now'); await sleep(1200);
f = await files();
assert(!Object.keys(f).some((n) => n.endsWith('.pagewise.json')), 'deletion passed to the folder');
// Turning it off.
await clickText(page, '.dialog button', 'Stop syncing'); await sleep(500);
assert(await page.$eval('.dialog', (e) => /Choose folder/.test(e.textContent)), 'sync can be turned off');
console.log('LOG', log);
await browser.close();
