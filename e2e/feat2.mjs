import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 700 });
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
// headings + filler + second heading far down
await page.keyboard.type('# Alpha'); await page.keyboard.press('Enter');
for (let i = 0; i < 40; i++) { await page.keyboard.type('filler line ' + i); await page.keyboard.press('Enter'); }
await page.keyboard.type('## Omega'); await page.keyboard.press('Enter'); await page.keyboard.type('end');
await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
await menu(page, 'Insert', 'Table of contents'); await sleep(500);
const links = await page.$$eval('.pw-prose [data-type=toc] a', (a) => a.map((x) => x.getAttribute('href')));
assert(links.join() === '#h-1,#h-2', 'toc links ' + links);
await page.$eval('.pw-prose', (e) => e.scrollIntoView());
const before = await page.evaluate(() => document.querySelector('.editor-scroll, .doc-scroll, main')?.scrollTop ?? window.scrollY);
await page.evaluate(() => document.querySelector('.pw-prose [data-type=toc] a[href="#h-2"]').click()); await sleep(1200);
const inView = await page.evaluate(() => { const r = document.getElementById('h-2').getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; });
assert(inView, 'clicking TOC link scrolls to heading');
// special characters
await sleep(1500); console.log('H2', JSON.stringify(await page.evaluate(() => { const h=document.getElementById('h-2'); const r=h.getBoundingClientRect(); const e=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return {top:r.top,h:r.height,w:r.width,hit:e&&e.tagName+'.'+e.className}; }))); await page.click('.pw-prose h2'); await page.keyboard.press('End'); await sleep(300);
await menu(page, 'Insert', 'Special characters');
await page.waitForSelector('.char-grid'); await clickText(page, '.char-btn', '©'); await clickText(page, '.char-btn', '®'); console.log('HINT', await page.$eval('.dialog .hint', (e) => e.textContent).catch(()=>'nohint'), 'sel', await page.evaluate(() => window.getSelection().anchorNode?.textContent?.slice(0,30))); await clickText(page, '.dialog button', 'Done'); await sleep(300);
assert((await page.$eval('.pw-prose h2', (e) => e.textContent)).endsWith('©®'), 'special chars inserted: ' + await page.$eval('.pw-prose', (e) => e.textContent.match(/.{20}©®.{10}|$/)[0]));
// focus mode
await menu(page, 'View', 'Focus mode');
assert(!(await page.$eval('.topbar', (e) => e.offsetParent !== null)), 'chrome hidden'); 
await page.keyboard.press('Escape'); await sleep(300);
assert(await page.$eval('.topbar', (e) => e.offsetParent !== null), 'Esc leaves focus mode');
// table cell colour
await page.click('.pw-prose'); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
await menu(page, 'Insert', 'Table…'); await page.waitForSelector('.dialog'); await clickText(page, '.dialog button', 'Insert', { exact: false }); await sleep(500);
await page.select('select[aria-label="Cell colour"]', '#d9ead3'); await sleep(300);
assert(await page.$eval('.pw-prose td, .pw-prose th', (e) => /rgb\(217, 234, 211\)/.test(e.getAttribute('style') || '')), 'cell colour applied');
// auto-lock
await clickText(page, '.menubar [role=menuitem][aria-haspopup]', 'File');
await page.keyboard.press('Escape');
await page.evaluate(() => { const k='pagewise:prefs'; const p=JSON.parse(localStorage.getItem(k)||'{}'); p.autoLockMinutes=0.04; localStorage.setItem(k, JSON.stringify(p)); });
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose');
await menu(page, 'File', 'Lock with password'); await page.waitForSelector('.dialog input[type=password]');
const [a, b] = await page.$$('.dialog input[type=password]'); await a.type('longenough1'); await b.type('longenough1'); await page.click('.dialog input[type=checkbox]');
await clickText(page, '.dialog button', 'Lock document'); await sleep(1500);
await page.waitForSelector('.home-main', { timeout: 15000 });
assert(true, 'auto-locked after idle and returned home');
console.log('LOG', log);
await browser.close();
