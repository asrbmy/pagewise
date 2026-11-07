import { launch, watch, BASE, sleep, clickText, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const log = []; watch(page, log); page.on('dialog', async (d) => { log.push('dialog:' + d.type()); await d.accept(); });
await page.goto(BASE, { waitUntil: 'networkidle0' });
// two documents
for (const t of ['Alpha', 'Beta']) {
  await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
  await page.keyboard.type(t + ' body'); await sleep(900);
  await page.goto(BASE, { waitUntil: 'networkidle0' }); await page.waitForSelector('.home-main');
}
await clickText(page, 'button', '+ New folder'); await page.waitForSelector('.dialog input');
await page.type('.dialog input', 'Projects'); await clickText(page, 'button', 'Create'); await sleep(600);
assert(await page.$eval('.chip.is-active', (e) => e.textContent.includes('Projects')), 'new folder selected');
assert((await page.$$('.doc-grid > li')).length === 0, 'new folder is empty');
await clickText(page, 'button', 'All documents'); await sleep(400);
assert((await page.$$('.doc-grid > li')).length === 2, 'both documents under All');
// move the first doc
await page.click('button[aria-label^="Actions for"]'); await clickText(page, '[role^=menuitem]', 'Move to folder…', { exact: false });
await page.waitForSelector('.dialog'); await clickText(page, 'label', 'Projects', { exact: false }); await clickText(page, 'button', 'Move'); await sleep(600);
await clickText(page, 'button', 'Projects', { exact: false }); await sleep(500);
assert((await page.$$('.doc-grid > li')).length === 1, 'folder shows the moved document');
await clickText(page, 'button', 'No folder'); await sleep(400);
assert((await page.$$('.doc-grid > li')).length === 1, '"No folder" shows the other one');
// persists after reload
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.home-main'); await sleep(500);
assert(await page.$$eval('.chip', (els) => els.some((e) => e.textContent.includes('Projects'))), 'folder persisted');
// delete folder keeps docs
await clickText(page, 'button', 'Projects', { exact: false }); await sleep(300);
await clickText(page, 'button', 'Delete folder'); await page.waitForSelector('.dialog'); await clickText(page, '.dialog button', 'Delete folder', { exact: false }); await sleep(900);
assert(!(await page.$$eval('.chip', (els) => els.some((e) => e.textContent.includes('Projects')))), 'folder removed');
assert((await page.$$('.doc-grid > li')).length === 2, 'both documents still exist after folder delete');
console.log('LOG', log);
await browser.close();
