import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Hello world'); await sleep(300);
await menu(page, 'Edit', 'Suggesting mode'); await sleep(200);
assert(await page.$('.suggesting-badge'), 'suggesting badge shows');
await page.click('.pw-prose'); await page.keyboard.down('Control').then(() => page.keyboard.press('End')).then(() => page.keyboard.up('Control'));
for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
await page.keyboard.type('there'); await sleep(1800);
const st = await page.evaluate(() => ({
  text: document.querySelector('.pw-prose').textContent,
  ins: [...document.querySelectorAll('.pw-prose ins')].map((e) => e.textContent),
  del: [...document.querySelectorAll('.pw-prose del')].map((e) => e.textContent),
}));
assert(st.text === 'Hello thereworld', 'text kept: ' + st.text);
assert(st.ins.join('') === 'there' && st.del.join('') === 'world', 'marks: ' + JSON.stringify(st));
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose del');
await menu(page, 'Edit', 'Tracked changes panel'); await page.waitForSelector('.changes-panel .comment-card');
assert((await page.$$('.changes-panel .comment-card')).length === 2, 'two changes listed');
await clickText(page, '.changes-panel button', 'Accept all'); await sleep(400);
const after = await page.$eval('.pw-prose', (e) => ({ t: e.textContent, n: e.querySelectorAll('ins,del').length }));
assert(after.t === 'Hello there' && after.n === 0, 'accept all: ' + JSON.stringify(after));
console.log('LOG', log);
await browser.close();
