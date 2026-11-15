import { launch, watch, BASE, sleep, menu, assert, HERE } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await (await page.$('input[type=file]')).uploadFile(HERE + '/fixtures/comments.docx');
await page.waitForSelector('.pw-prose .comment-mark', { timeout: 15000 }); await sleep(800);
const marks = await page.$$eval('.pw-prose .comment-mark', (els) => els.map((e) => e.textContent.trim()));
assert(marks.length === 2 && marks.includes('a commented phrase'), 'comment marks in text: ' + JSON.stringify(marks));
await menu(page, 'View', 'Comments panel'); await sleep(500);
const panel = await page.$eval('.comments-panel', (e) => e.textContent);
assert(panel.includes('Reviewer One: Is this right?') && panel.includes('Reviewer Two: Point comment here'), 'comments listed: ' + panel.slice(0, 200));
// survives a reload (stored with the document)
await sleep(1200); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose .comment-mark');
await menu(page, 'View', 'Comments panel'); await sleep(500);
assert((await page.$eval('.comments-panel', (e) => e.textContent)).includes('Reviewer One'), 'comments persist after reload');
console.log('LOG', log.slice(0, 5));
await browser.close();
