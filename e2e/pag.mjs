import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const log = []; watch(page, log);
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
for (let i = 0; i < 40; i++) { await page.keyboard.type(`Paragraph ${i} ` + 'lorem ipsum dolor sit amet consectetur '.repeat(8)); await page.keyboard.press('Enter'); }
await sleep(1500);
const H = 1056, M = 96;
const check = () => page.evaluate((H, M) => {
  const prose = document.querySelector('.pw-prose');
  const bad = []; let blocks = 0;
  for (const el of prose.children) {
    if (el.classList.contains('page-spacer')) continue;
    blocks++;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    const p = Math.floor(top / H);
    const limit = (p + 1) * H - M;
    if (bottom > limit + 1 && el.offsetHeight <= H - 2 * M) bad.push({ text: el.textContent.slice(0, 20), top, bottom, limit });
    if (top >= limit - 1 && top < (p + 1) * H + M - 1) bad.push({ text: 'IN-MARGIN ' + el.textContent.slice(0, 20), top, bottom, limit });
  }
  return { bad, blocks, spacers: prose.querySelectorAll('.page-spacer').length, text: prose.textContent.length };
}, H, M);
let r = await check();
console.log('blocks', r.blocks, 'spacers', r.spacers, 'bad', JSON.stringify(r.bad.slice(0, 3)));
assert(r.spacers >= 1, 'page gaps were inserted');
assert(r.bad.length === 0, 'no block straddles a page edge or sits in a margin');
const pagesText = await page.$eval('.statusbar', (e) => e.textContent);
console.log('status:', pagesText.replace(/\s+/g, ' ').slice(0, 100));

// editing near a boundary keeps it consistent, and undo/typing still work
await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
for (let i = 0; i < 6; i++) { await page.keyboard.type('Inserted heading line text ' + 'xx '.repeat(30)); await page.keyboard.press('Enter'); }
await sleep(1200);
r = await check(); assert(r.bad.length === 0, 'still consistent after inserting at the top: ' + JSON.stringify(r.bad.slice(0, 2)));
const before = r.text;
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(800);
r = await check(); assert(r.text < before && r.bad.length === 0, 'undo works with spacers present');

// content text has no stray characters from spacers
const txt = await page.$eval('.pw-prose', (e) => e.innerText);
assert(!/​/.test(txt), 'no stray characters');

// hard page break pushes following text to a new page
await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await page.keyboard.type('AFTER BREAK'); await sleep(1200);
const pos = await page.evaluate((H, M) => {
  const prose = document.querySelector('.pw-prose');
  const el = [...prose.children].find((c) => c.textContent.startsWith('AFTER BREAK'));
  return { top: el.offsetTop, mod: el.offsetTop % H };
}, H, M);
console.log('after break top', pos);
assert(pos.top >= H + M - 2 && Math.abs(pos.mod - M) < 40, 'text after a hard page break starts on a new page');

// toggle off removes gaps
await menu(page, 'View', 'Show page gaps (text never crosses a page edge)'); await sleep(800);
assert((await page.$$('.pw-prose .page-spacer')).length === 0, 'turning page gaps off removes spacers');
await menu(page, 'View', 'Show page gaps (text never crosses a page edge)'); await sleep(1200);
assert((await page.$$('.pw-prose .page-spacer')).length > 0, 'turning them on restores spacers');
console.log('LOG', log);
await browser.close();
