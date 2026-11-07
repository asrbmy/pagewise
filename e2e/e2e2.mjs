import fs from 'node:fs';
import { launch, watch, BASE, OUT, sleep, clickText, menu, setDownloads, waitForFile, assert } from './lib.mjs';
import JSZip from 'jszip';
async function clearInput(page, sel) {
  await page.focus(sel);
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}
const profile = OUT + '/profile';
const dl = OUT + '/downloads';
fs.rmSync(dl, { recursive: true, force: true });
const browser = await launch([`--user-data-dir=${profile}`]);
const page = await browser.newPage();
const log = []; watch(page, log);
await setDownloads(page, dl);
await page.goto(BASE, { waitUntil: 'networkidle0' });

// 10. search & reopen
assert((await page.$$('.doc-card')).length === 1, 'document list shows the saved document');
await page.type('.search-input', 'plan q4');
await sleep(500);
assert((await page.$$('.doc-card')).length === 1, 'search by title finds the document');
await clearInput(page, '.search-input');
await page.type('.search-input', 'cell b1');
await sleep(500);
assert((await page.$$('.doc-card')).length === 1, 'search by content finds the document');
await clearInput(page, '.search-input');
await page.type('.search-input', 'zzzz-nothing');
await sleep(500);
assert((await page.$$('.doc-card')).length === 0 && (await page.$eval('.empty-state', (e) => e.textContent)).includes('No documents match'), 'search with no hits shows empty state');
await clearInput(page, '.search-input');
await sleep(400);
await clickText(page, '.doc-open', 'Plan Q4', { exact: false });
await page.waitForSelector('.pw-prose');
assert(true, 'reopened document from list');

// 8. export docx + pdf
await menu(page, 'File', 'Microsoft Word (.docx)');
const docxPath = await waitForFile(dl, '.docx');
const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
const xml = await zip.file('word/document.xml').async('string');
assert(xml.includes('Quarterly plan') && xml.includes('<w:tbl>') && xml.includes('Cell B1') && xml.includes('w:hyperlink'), 'DOCX export contains heading, table, link: ' + docxPath.split('/').pop());
await menu(page, 'File', 'PDF document (.pdf)');
const pdfPath = await waitForFile(dl, '.pdf', 60000);
const pdf = fs.readFileSync(pdfPath);
assert(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 2000, `PDF export is a valid-looking PDF (${pdf.length} bytes)`);
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('pdf pages:', pages);
for (const [label, ext] of [['Web page (.html)', '.html'], ['Markdown (.md)', '.md'], ['Plain text (.txt)', '.txt']]) {
  await menu(page, 'File', label);
  const f = await waitForFile(dl, ext);
  const t = fs.readFileSync(f, 'utf8');
  assert(t.includes('Quarterly plan') && t.includes('Cell A1'), `${ext} export has content`);
}
console.log('md:\n' + fs.readFileSync(dl + '/Plan Q4.md', 'utf8'));
await sleep(500);

// 9. import docx (the one we just exported)
await page.goto(BASE, { waitUntil: 'networkidle0' });
const input = await page.$('input[type=file][accept*=".docx"]');
await input.uploadFile(docxPath);
await page.waitForSelector('.pw-prose', { timeout: 20000 });
await sleep(500);
const imported = await page.$eval('.pw-prose', (e) => e.innerHTML);
assert(imported.includes('Quarterly plan') && imported.includes('<table') && imported.includes('Cell B1'), 'DOCX import brings back heading and table');
assert(/href="https:\/\/example.com\/docs"/.test(imported), 'DOCX import keeps the link');
const toastText = await page.$eval('.toasts', (e) => e.innerText).catch(() => '');
assert(/not carried over/.test(toastText), 'import warns about unsupported Word features');
await page.screenshot({ path: OUT + '/imported.png' });

// 11. delete
await page.goto(BASE, { waitUntil: 'networkidle0' });
assert((await page.$$('.doc-card')).length === 2, 'two documents listed');
await page.click('.doc-card:first-child .card-menu button');
await clickText(page, '.menu [role=menuitem]', 'Delete…');
await page.waitForSelector('[role=dialog]');
await clickText(page, '[role=dialog] button', 'Delete');
await sleep(600);
assert((await page.$$('.doc-card')).length === 1, 'delete (with confirmation) removes a document');
console.log('LOG', log);
await browser.close();
