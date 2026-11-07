import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, watch, BASE, OUT, sleep, clickText, menu, setDownloads, waitForFile, assert } from './lib.mjs';
const dl = OUT + '/downloads4'; fs.rmSync(dl, { recursive: true, force: true });
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); await setDownloads(page, dl);
await page.goto(BASE, { waitUntil: 'networkidle0' });

// template
await clickText(page, 'button', 'Templates'); await page.waitForSelector('.template-card');
await clickText(page, 'button', 'Meeting notes', { exact: false }); await page.waitForSelector('.pw-prose');
await sleep(500);
assert((await page.$eval('.pw-prose', (e) => e.textContent)).includes('Action items'), 'meeting-notes template content loaded');
assert((await page.$eval('input[aria-label="Document title"], .title-input', (e) => e.value)) === 'Meeting notes', 'template title applied');

// table of contents
await page.click('.pw-prose'); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
await menu(page, 'Insert', 'Table of contents'); await sleep(400);
let toc = await page.$eval('.pw-prose .toc', (e) => e.textContent);
assert(toc.includes('Table of contents') && toc.includes('Agenda') && toc.includes('Decisions'), 'TOC lists headings: ' + toc.slice(0, 80));
await page.click('.pw-prose h2'); await page.keyboard.press('End'); await page.keyboard.type(' NEW'); await sleep(200);
await menu(page, 'Insert', 'Update table of contents'); await sleep(400);
toc = await page.$eval('.pw-prose .toc', (e) => e.textContent);
assert(toc.includes('Agenda NEW'), 'TOC updates after heading edit');

// header / footer / numbers
await menu(page, 'File', 'Page setup…'); await page.waitForSelector('#pw-header');
await page.type('#pw-header', 'ACME CONFIDENTIAL'); await page.type('#pw-footer', 'Quarterly meeting');
await page.select('#pw-numbers', 'right');
await clickText(page, 'button', 'OK'); await sleep(500);
assert((await page.$eval('.sheet-header, .pf-header', (e) => e.textContent)) === 'ACME CONFIDENTIAL', 'header shown on the sheet');
await sleep(800);
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose');
assert((await page.$eval('.sheet-footer, .pf-footer .pf-center', (e) => e.textContent)) === 'Quarterly meeting', 'footer persisted after reload');

// PDF + DOCX
await menu(page, 'File', 'PDF document (.pdf)');
const pdf = await waitForFile(dl, '.pdf', 90000);
const txt = execSync(`pdftotext "${pdf}" -`).toString();
assert(txt.includes('ACME CONFIDENTIAL'), 'PDF has header text');
assert(txt.includes('Quarterly meeting'), 'PDF has footer text');
assert(/Page 1 of \d+/.test(txt), 'PDF has "Page 1 of N"');
assert(txt.includes('Action items'), 'PDF body text still selectable');
await menu(page, 'File', 'Microsoft Word (.docx)');
const docx = await waitForFile(dl, '.docx', 60000);
const names = execSync(`unzip -l "${docx}"`).toString();
assert(/word\/header\d*\.xml/.test(names) && /word\/footer\d*\.xml/.test(names), 'DOCX has header and footer parts');
console.log('LOG', log);
await browser.close();
