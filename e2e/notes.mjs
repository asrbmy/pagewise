import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, watch, BASE, OUT, sleep, clickText, menu, setDownloads, waitForFile, assert } from './lib.mjs';
const dl = OUT + '/downloads8'; fs.rmSync(dl, { recursive: true, force: true });
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const log = []; watch(page, log); await setDownloads(page, dl);
page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('The sky is blue and grass is green');
// footnote at end
await menu(page, 'Insert', 'Footnote…'); await page.waitForSelector('textarea');
await page.type('textarea', 'Rayleigh scattering'); await clickText(page, '.dialog button', 'Insert'); await sleep(500);
assert((await page.$$('.pw-prose .footnote-ref')).length === 1, 'footnote marker inserted');
assert((await page.$eval('.footnote-list', (e) => e.textContent)).includes('Rayleigh scattering'), 'note listed under the document');
// comment on "sky is blue": select via keyboard from start
await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight'); // after "The "
await page.keyboard.down('Shift'); for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
await sleep(200);
await menu(page, 'Insert', 'Comment…'); await page.waitForSelector('textarea');
await page.type('textarea', 'Is this accurate at sunset?'); await clickText(page, '.dialog button', 'Comment'); await sleep(600);
assert((await page.$eval('.comment-mark', (e) => e.textContent)) === 'sky is blue', 'comment anchors to the selected words');
assert(await page.$('.comments-panel') !== null, 'comments panel opened');
assert((await page.$eval('.comments-panel', (e) => e.textContent)).includes('Is this accurate'), 'comment shown in the panel');
// resolve hides highlight
await clickText(page, '.comments-panel button', 'Resolve'); await sleep(300);
const bg = await page.$eval('.comment-mark', (e) => getComputedStyle(e).backgroundColor);
assert(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent', 'resolved comment is no longer highlighted: ' + bg);
await clickText(page, '.comments-panel button', 'Reopen'); await sleep(300);
await sleep(1200);
// survives reload
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose'); await sleep(800);
await menu(page, 'View', 'Comments panel'); await sleep(400);
assert((await page.$eval('.comments-panel', (e) => e.textContent)).includes('Is this accurate'), 'comment persisted after reload');
assert((await page.$$('.pw-prose .footnote-ref')).length === 1, 'footnote persisted');
// exports omit comments and number footnotes
await menu(page, 'File', 'Markdown (.md)');
const md = fs.readFileSync(await waitForFile(dl, '.md', 20000), 'utf8');
console.log(JSON.stringify(md));
assert(!/accurate|comment/i.test(md), 'Markdown has no comment text');
assert(/Rayleigh scattering/.test(md) && /Notes/.test(md), 'Markdown lists the footnote');
await menu(page, 'File', 'OpenDocument Text (.odt)');
const odt = await waitForFile(dl, '.odt', 20000);
assert(execSync(`unzip -p "${odt}" content.xml`).toString().includes('Rayleigh scattering'), 'ODT export contains the note');
await menu(page, 'File', 'Rich Text Format (.rtf)');
const rtf = fs.readFileSync(await waitForFile(dl, '.rtf', 20000), 'utf8');
assert(rtf.includes('Rayleigh scattering') && rtf.startsWith('{\\rtf1'), 'RTF export contains the note');
// delete comment removes highlight
await clickText(page, '.comments-panel button', 'Delete'); await sleep(400);
assert((await page.$$('.comment-mark')).length === 0, 'deleting a comment removes its highlight');
console.log('LOG', log);
await browser.close();
