import fs from 'node:fs';
import { launch, watch, BASE, OUT, sleep, clickText, menu, status, assert } from './lib.mjs';
const profile = OUT + '/profile';
fs.rmSync(profile, { recursive: true, force: true });
let browser = await launch([`--user-data-dir=${profile}`]);
let page = await browser.newPage();
const log = [];
watch(page, log);
await page.goto(BASE, { waitUntil: 'networkidle0' });

// 2. create document
await clickText(page, 'button', 'New document');
await page.waitForSelector('.pw-prose');
assert(page.url().includes('#/d/'), 'create document navigates to #/d/<id>');
assert((await page.title()).startsWith('Untitled document'), 'tab title shows document name');

// 3. type + format
await page.click('.pw-prose');
await page.keyboard.type('Quarterly plan');
await page.select('select[aria-label="Paragraph style"]', 'h1');
await page.keyboard.press('Enter');
await page.keyboard.type('This is some ');
await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
await page.keyboard.type('bold');
await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
await page.keyboard.type(' text and a link target');
// font size via stepper + color
await page.keyboard.down('Shift'); for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
await page.waitForSelector('[role=dialog]');
await page.type('[role=dialog] input[inputmode=url]', 'example.com/docs');
await clickText(page, '[role=dialog] button', 'Apply');
await sleep(200);
await page.keyboard.press('End');
await page.keyboard.press('Enter');

// 4. table
await page.click('button[aria-label="Insert table"]');
await page.waitForSelector('[role=dialog]');
await clickText(page, '[role=dialog] button', 'Insert table');
await sleep(200);
await page.keyboard.type('Cell A1');
await page.keyboard.press('Tab');
await page.keyboard.type('Cell B1');
await sleep(300);
const html1 = await page.$eval('.pw-prose', (e) => e.innerHTML);
assert(/<h1[^>]*>Quarterly plan<\/h1>/.test(html1), 'heading typed');
assert(html1.includes('<strong>bold</strong>'), 'bold applied via shortcut');
assert(/<a [^>]*href="https:\/\/example.com\/docs"/.test(html1), 'link inserted with https:// normalisation');
assert(html1.includes('<table') && html1.includes('Cell A1') && html1.includes('Cell B1'), 'table inserted and cells editable');

// 5. rename
await page.focus('.title-input');
await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
await page.keyboard.type('Plan Q4');
await page.keyboard.press('Enter');
await sleep(1500);
console.log('status:', await status(page));
assert((await status(page)).includes('Saved'), 'autosave status shows Saved');
await page.screenshot({ path: OUT + '/editor-1.png' });

// 6. reload persistence
const url = page.url();
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.pw-prose');
const html2 = await page.$eval('.pw-prose', (e) => e.innerHTML);
assert(html2.includes('Cell B1') && html2.includes('Quarterly plan'), 'content persists after refresh');
assert((await page.$eval('.title-input', (e) => e.value)) === 'Plan Q4', 'title persists after refresh');

// 7. close & reopen browser (same profile)
await browser.close();
browser = await launch([`--user-data-dir=${profile}`]);
page = await browser.newPage();
watch(page, log);
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForSelector('.pw-prose');
const html3 = await page.$eval('.pw-prose', (e) => e.innerHTML);
assert(html3.includes('Cell A1') && html3.includes('<strong>bold</strong>'), 'content persists after closing and reopening the browser');
console.log('LOG', log);
await browser.close();
