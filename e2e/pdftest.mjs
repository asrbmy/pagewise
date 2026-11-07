import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, watch, BASE, OUT, sleep, clickText, menu, setDownloads, waitForFile } from './lib.mjs';
const dl = OUT + '/downloads2';
fs.rmSync(dl, { recursive: true, force: true });
const browser = await launch([`--user-data-dir=${OUT}/profile`]);
const page = await browser.newPage();
const log = []; watch(page, log);
await setDownloads(page, dl);
await page.goto(BASE, { waitUntil: 'networkidle0' });
// make sure we have a long, multi-page doc with a page break
await clickText(page, 'button', 'New document');
await page.waitForSelector('.pw-prose');
await page.click('.pw-prose');
await page.keyboard.type('Report title'); await page.select('select[aria-label="Paragraph style"]', 'h1'); await page.keyboard.press('Enter');
for (let i = 0; i < 6; i++) { await page.keyboard.type(('Paragraph ' + i + ' lorem ipsum dolor sit amet consectetur. ').repeat(14)); await page.keyboard.press('Enter'); }
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await page.keyboard.type('Text after the page break');
await sleep(400);
await menu(page, 'File', 'PDF document (.pdf)');
const f = await waitForFile(dl, '.pdf', 90000);
console.log('pdf:', f, fs.statSync(f).size);
console.log(execSync(`pdfinfo "${f}" | grep -E "Pages|Page size"`).toString());
execSync(`pdftoppm -png -r 50 "${f}" "${dl}/p"`);
for (const n of fs.readdirSync(dl).filter((x) => x.endsWith('.png'))) {
  const mean = execSync(`convert "${dl}/${n}" -colorspace Gray -format "%[fx:mean]" info:`).toString();
  console.log(n, 'mean brightness', mean);
}
console.log('LOG', log);
await browser.close();
