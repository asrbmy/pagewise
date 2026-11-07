import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { launch, watch, BASE, OUT, sleep, clickText, menu, setDownloads, waitForFile, assert } from './lib.mjs';
const dl = OUT + '/downloads7'; fs.rmSync(dl, { recursive: true, force: true });
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const log = []; watch(page, log); await setDownloads(page, dl);
page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Energy is '); 
await menu(page, 'Insert', 'Equation…'); await page.waitForSelector('textarea');
await page.type('textarea', 'E = mc^2'); await sleep(900);
assert((await page.$$('.equation-preview .katex')).length === 1, 'live preview typeset');
await clickText(page, '.dialog button', 'Insert'); await sleep(900);
assert((await page.$$('.pw-prose .math .katex')).length === 1, 'equation typeset in the document');
// edit via menu: click it, then Edit selected equation
await page.click('.pw-prose .math'); await sleep(200);
await menu(page, 'Insert', 'Edit selected equation…'); await page.waitForSelector('textarea');
assert((await page.$eval('textarea', (e) => e.value)) === 'E = mc^2', 'edit dialog shows the existing LaTeX');
await page.click('textarea'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
await page.type('textarea', '\\frac{a}{b}'); await clickText(page, '.dialog button', 'Update'); await sleep(900);
assert((await page.$eval('.pw-prose .math', (e) => e.getAttribute('title'))) === '\\frac{a}{b}' || (await page.$$('.pw-prose .math .mfrac')).length === 1, 'equation updated');
// drawing
const pb = await (await page.$('.pw-prose p')).boundingBox(); await page.mouse.click(pb.x + pb.width - 6, pb.y + pb.height / 2); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control'); await page.keyboard.type(' and a sketch: ');
await menu(page, 'Insert', 'Drawing…'); await page.waitForSelector('canvas.drawing-canvas');
const box = await (await page.$('canvas.drawing-canvas')).boundingBox();
await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 200, { steps: 12 }); await page.mouse.up();
await clickText(page, '.dialog button', 'Insert drawing'); await sleep(900);
const img = await page.$eval('.pw-prose img[src^="data:"]', (e) => ({ src: e.src.slice(0, 22), alt: e.alt }));
console.log('img', JSON.stringify(img), await page.$$eval('.pw-prose img[src^="data:"]', (e) => e.length));
assert(img.src === 'data:image/png;base64,' && img.alt === 'Drawing', 'drawing inserted as a PNG image');
await sleep(1000);
// reload persists
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose'); await sleep(1200);
console.log('after reload', (await page.$$('.pw-prose .math')).length, (await page.$$('.pw-prose .math .katex')).length, (await page.$$('.pw-prose img[src^="data:"]')).length);
assert((await page.$$('.pw-prose .math .katex')).length === 1 && (await page.$$('.pw-prose img[src^="data:"]')).length === 1, 'equation and drawing survive a reload');
// exports
await menu(page, 'File', 'PDF document (.pdf)');
const pdf = await waitForFile(dl, '.pdf', 90000); const txt = execSync(`pdftotext "${pdf}" -`).toString();
console.log('PDF text:', JSON.stringify(txt.slice(0, 80)));
assert(txt.includes('Energy is'), 'PDF text still selectable');
execSync(`pdftoppm -png -r 70 "${pdf}" "${dl}/pg"`);
await menu(page, 'File', 'Markdown (.md)');
const md = fs.readFileSync(await waitForFile(dl, '.md', 20000), 'utf8');
assert(md.includes('$\\frac{a}{b}$'), 'Markdown keeps the LaTeX: ' + md.slice(0, 60).replace(/\n/g, ' '));
console.log('LOG', log);
await browser.close();
