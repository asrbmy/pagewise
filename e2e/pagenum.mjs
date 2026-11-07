import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await menu(page, 'File', 'Page setup…'); await page.waitForSelector('#pw-header');
await page.type('#pw-header', 'ACME'); await page.type('#pw-footer', 'Report'); await page.select('#pw-numbers', 'center');
await clickText(page, 'button', 'OK'); await sleep(500);
await page.click('.pw-prose');
for (let i = 0; i < 70; i++) { await page.keyboard.type('Line number ' + i); await page.keyboard.press('Enter'); }
await sleep(1500);
const info = await page.evaluate(() => ({
  pages: document.querySelectorAll('.page-furniture').length,
  labels: [...document.querySelectorAll('.pf-center')].map((e) => e.textContent),
  headers: [...document.querySelectorAll('.pf-header')].map((e) => e.textContent),
  sheetH: document.querySelector('.sheet').offsetHeight,
}));
console.log(JSON.stringify(info));
assert(info.pages >= 2 && info.sheetH >= info.pages * 1000, 'several pages: ' + info.pages);
assert(info.labels[0] === 'Report · Page 1' && info.labels[1] === 'Report · Page 2', 'footer carries page numbers');
assert(info.headers.every((h) => h === 'ACME') && info.headers.length === info.pages, 'header repeats on every page');
// hidden when page gaps are off -> back to single furniture
await menu(page, 'View', 'Show page gaps');
await sleep(500);
assert((await page.$$('.page-furniture')).length === 0 && !!(await page.$('.sheet-header')), 'page gaps off restores single header');
console.log('LOG', log);
await browser.close();
