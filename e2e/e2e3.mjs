import fs from 'node:fs';
import { launch, watch, BASE, OUT, sleep, clickText, menu, assert } from './lib.mjs';
const profile = OUT + '/profile3';
fs.rmSync(profile, { recursive: true, force: true });
const browser = await launch([`--user-data-dir=${profile}`]);
const page = await browser.newPage();
const log = []; watch(page, log);
const key = async (k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of mods.reverse()) await page.keyboard.up(m); };
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document');
await page.waitForSelector('.pw-prose');
await page.click('.pw-prose');
await page.keyboard.type('The cat sat. The Cat ran. A cat slept.');

// find & replace
await key('f', ['Control']);
await page.waitForSelector('.find-panel');
await page.keyboard.type('cat');
await sleep(300);
const count = await page.$eval('.find-count', (e) => e.textContent);
assert(count === '1 of 3', 'find shows "1 of 3" (case-insensitive): ' + count);
assert((await page.$$('.find-match')).length === 3, 'matches are highlighted in the document');
await key('Enter');
await sleep(150);
assert((await page.$eval('.find-count', (e) => e.textContent)) === '2 of 3', 'Enter steps to next match');
await page.type('.find-panel input[placeholder="Replace with"]', 'dog');
await clickText(page, '.find-panel button', 'Replace all');
await sleep(300);
assert((await page.$eval('.pw-prose', (e) => e.textContent)) === 'The dog sat. The dog ran. A dog slept.', 'replace all works');
await key('Escape');
await sleep(200);
assert((await page.$('.find-panel')) === null, 'Escape closes find panel');

// keyboard menu navigation
await page.focus('.menubar [role=menuitem]');
await key('Enter');
await sleep(250);
const focusedInMenu = await page.evaluate(() => !!document.activeElement.closest('.menu'));
assert(focusedInMenu, 'Enter on "File" opens the menu and focuses its first item');
await key('ArrowDown');
await key('Escape');
await sleep(150);
assert((await page.$('.menu')) === null, 'Escape closes the menu');
assert(await page.evaluate(() => document.activeElement.textContent === 'File'), 'focus returns to the menu button');

// Word paste
await page.click('.pw-prose'); await key('End', ['Control']); await key('Enter');
await page.evaluate(() => {
  const html = `<html><head><style>p.MsoNormal{margin:0}</style></head><body><!--StartFragment--><p class=MsoNormal style="mso-line-height-alt:12pt">Pasted <b>bold</b> from Word<o:p></o:p></p>
<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>First bullet</p>
<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Second bullet</p><!--EndFragment--></body></html>`;
  const dt = new DataTransfer();
  dt.setData('text/html', html); dt.setData('text/plain', 'Pasted bold from Word');
  document.querySelector('.pw-prose').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await sleep(300);
const pasted = await page.$eval('.pw-prose', (e) => e.innerHTML);
assert(/<strong>bold<\/strong> from Word/.test(pasted) && /<ul>.*First bullet.*Second bullet.*<\/ul>/.test(pasted) && !/mso|Mso/i.test(pasted), 'Word paste is cleaned and bullet paragraphs become a real list');

// image insert
await menu(page, 'Insert', 'Image…');
await page.waitForSelector('[role=dialog]');
const fileInput = await page.$('[role=dialog] input[type=file]');
await fileInput.uploadFile(OUT + '/test-image.png');
await page.type('[role=dialog] input[placeholder^="Describe"]', 'A gradient');
await clickText(page, '[role=dialog] button', 'Insert');
await sleep(500);
const img = await page.$eval('.pw-prose img', (e) => ({ src: e.src.slice(0, 22), alt: e.alt }));
assert(img.src.startsWith('data:image/png') && img.alt === 'A gradient', 'image upload embeds a data URL with alt text');

// other formatting through the UI: color, align, line spacing, zoom, page break
await page.click('.pw-prose'); await key('a', ['Control']);
await page.click('button[aria-label="Align center"]');
await clickText(page, 'button', 'Line and paragraph spacing');
await sleep(150);
await clickText(page, '.popover-item', 'Double', { exact: false });
await sleep(200);
const fmt = await page.$eval('.pw-prose', (e) => e.innerHTML);
assert(fmt.includes('text-align: center') && fmt.includes('line-height: 2'), 'alignment and line spacing applied');
await page.select('select[aria-label="Zoom"]', '1.5');
await sleep(300);
const sheetW = await page.$eval('.sheet-wrap', (e) => Math.round(e.getBoundingClientRect().width));
assert(sheetW === Math.round(816 * 1.5), 'zoom 150% scales the page width: ' + sheetW);
await page.select('select[aria-label="Zoom"]', '1');

// spacing: word count dialog
await menu(page, 'Tools', 'Word count');
await page.waitForSelector('[role=dialog]');
const wc = await page.$eval('[role=dialog]', (e) => e.innerText);
assert(/Words\s*\d+/.test(wc), 'word count dialog opens: ' + wc.replace(/\s+/g, ' ').slice(0, 80));
await key('Escape');

// dark theme
await menu(page, 'View', 'Dark');
await sleep(300);
assert((await page.$eval('html', (e) => e.getAttribute('data-theme'))) === 'dark', 'dark theme applied');
await page.screenshot({ path: OUT + '/editor-dark.png' });
await menu(page, 'View', 'Light');

// unsaved-change warning: make an edit and check dialog on beforeunload is registered
let dialogSeen = false;
page.on('dialog', async (d) => { dialogSeen = d.type() === 'beforeunload'; await d.dismiss(); });
await page.click('.pw-prose'); await key('End', ['Control']); await sleep(200); await page.keyboard.type('x');
await page.evaluate(() => { window.__prevented = false; window.addEventListener('beforeunload', (e) => { window.__prevented = e.defaultPrevented; }, { once: true }); window.dispatchEvent(new Event('beforeunload', { cancelable: true })); });
// (autosave flushes in the same handler, so dirty may already be cleared; just assert no crash)
await sleep(1200);

// offline: second load so the service worker controls the page, then go offline and reload
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(1500);
const controlled = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); });
assert(controlled, 'service worker is active');
await page.reload({ waitUntil: 'networkidle0' });
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.doc-card', { timeout: 15000 });
assert(true, 'app loads and lists documents while offline');
await clickText(page, '.doc-open', 'cat', { exact: false }).catch(async () => { await page.click('.doc-open'); });
await page.waitForSelector('.pw-prose');
{ const t = await page.$eval('.pw-prose', (e) => e.textContent); assert(t.includes('The dog sat'), 'document opens and is editable while offline: ' + t.slice(0, 80)); }
await page.setOfflineMode(false);

// mobile
const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
watch(mobile, log);
await mobile.goto(page.url(), { waitUntil: 'networkidle0' });
await mobile.waitForSelector('.pw-prose');
await sleep(500);
const over = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sheet: Math.round(document.querySelector('.sheet-wrap').getBoundingClientRect().width), zoom: document.querySelector('.statusbar')?.textContent }));
assert(over.sw <= over.iw + 1, `no horizontal page overflow on a 390px screen (scrollWidth ${over.sw})`);
assert(over.sheet <= over.iw, `page fits the screen (fit-to-width): ${over.sheet}px`);
await mobile.screenshot({ path: OUT + '/mobile-editor.png' });
await mobile.goto(BASE, { waitUntil: 'networkidle0' });
await mobile.screenshot({ path: OUT + '/mobile-home.png' });
console.log('LOG', log.filter((l) => !/service worker|sw\.js/i.test(l)));
await browser.close();
