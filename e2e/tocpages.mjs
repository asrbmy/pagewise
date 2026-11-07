import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('# Start'); await page.keyboard.press('Enter');
for (let i = 0; i < 60; i++) { await page.keyboard.type('filler ' + i); await page.keyboard.press('Enter'); }
await page.keyboard.type('# Middle'); await page.keyboard.press('Enter');
for (let i = 0; i < 60; i++) { await page.keyboard.type('more ' + i); await page.keyboard.press('Enter'); }
await page.keyboard.type('# Finish'); await sleep(1200);
await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
await menu(page, 'Insert', 'Table of contents'); await sleep(2500);
const entries = await page.$$eval('.pw-prose [data-type=toc] p', (p) => p.map((x) => x.textContent));
console.log(JSON.stringify(entries));
assert(entries.length === 4 && /p\. 1$/.test(entries[1]), 'first heading on page 1');
const pg = (s) => Number(/p\. (\d+)$/.exec(s)?.[1]);
assert(pg(entries[2]) >= 2 && pg(entries[3]) > pg(entries[2]), 'later headings on later pages: ' + entries.join('|'));
// the numbers agree with where the headings really are
const actual = await page.evaluate(() => [...document.querySelectorAll('.pw-prose h1[id]')].map((h) => Math.floor((h.offsetTop + 1) / 1056) + 1));
assert(actual.join() === [pg(entries[1]), pg(entries[2]), pg(entries[3])].join(), 'page numbers match layout: ' + actual.join());
console.log('LOG', log);
await browser.close();
