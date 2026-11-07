import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 700 });
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Go to the answer'); await page.keyboard.press('Enter');
for (let i = 0; i < 50; i++) { await page.keyboard.type('filler ' + i); await page.keyboard.press('Enter'); }
await page.keyboard.type('The answer is here'); await sleep(300);
await menu(page, 'Insert', 'Bookmark…'); await page.waitForSelector('#pw-bookmark');
await page.type('#pw-bookmark', 'The Answer!'); await clickText(page, '.dialog button', 'Set bookmark'); await sleep(400);
assert(await page.$('.pw-prose [data-bookmark="the-answer"]') !== null, 'bookmark stored on the block');
// link the first line to it
await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift'); await sleep(200);
await menu(page, 'Insert', 'Link…'); await page.waitForSelector('.dialog select');
await page.select('.dialog select', '#bm-the-answer'); await clickText(page, '.dialog button', 'Apply'); await sleep(500);
assert(await page.$eval('.pw-prose a', (a) => a.getAttribute('href')) === '#bm-the-answer', 'internal link created');
await page.evaluate(() => window.scrollTo(0, 0));
const before = await page.evaluate(() => document.querySelector('.canvas').scrollTop);
await page.click('.pw-prose a'); await sleep(1500);
const after = await page.evaluate(() => document.querySelector('.canvas').scrollTop);
assert(after > before + 300, `link scrolls to the bookmark (${before} -> ${after})`);
console.log('LOG', log);
await browser.close();
