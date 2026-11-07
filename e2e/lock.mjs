import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', async (d) => { await d.accept(); });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Top secret plan'); await sleep(900);
const url = page.url();
await menu(page, 'File', 'Lock with password');
await page.waitForSelector('.dialog input[type=password]');
const [a, b] = await page.$$('.dialog input[type=password]');
await a.type('correct-horse'); await b.type('correct-horse');
await page.click('.dialog input[type=checkbox]');
await clickText(page, '.dialog button', 'Lock document'); await sleep(1500);
assert(!(await page.$('.dialog')), 'lock dialog closed');
await page.click('.pw-prose'); await page.keyboard.type(' more'); await sleep(1200);
// raw storage has no plaintext
const raw = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pagewise'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = await new Promise((res) => { const r = db.transaction('documents').objectStore('documents').getAll(); r.onsuccess = () => res(r.result); });
  return JSON.stringify(all);
});
assert(!raw.includes('Top secret') && !raw.includes('more'), 'no plaintext in IndexedDB');
assert(raw.includes('"locked":true'), 'locked flag stored');
// reload -> unlock screen
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.unlock-card');
assert(!(await page.evaluate(() => document.body.innerText.includes('Top secret'))), 'content hidden');
await page.type('.unlock-card input', 'wrong-pass'); await clickText(page, 'button', 'Unlock'); await sleep(1500);
assert(await page.$eval('.unlock-card .field-error', (e) => e.textContent.includes('not correct')), 'wrong password message');
await page.$eval('.unlock-card input', (e) => (e.value = ''));
await page.click('.unlock-card input', { clickCount: 3 }); await page.keyboard.press('Backspace');
await page.type('.unlock-card input', 'correct-horse'); await clickText(page, 'button', 'Unlock'); await page.waitForSelector('.pw-prose', { timeout: 10000 });
const txt = await page.$eval('.pw-prose', (e) => e.textContent);
assert(txt.includes('Top secret plan more'), 'content restored: ' + txt);
// home shows locked
await menu(page, 'File', 'Lock now'); await page.waitForSelector('.home-main'); await sleep(500);
assert(await page.evaluate(() => document.body.innerText.includes('Password-protected')), 'home card shows protected');
assert(!(await page.evaluate(() => document.body.innerText.includes('Top secret'))), 'no plaintext on home');
// lock now forgot key: reopen needs password
await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.unlock-card');
await page.type('.unlock-card input', 'correct-horse'); await clickText(page, 'button', 'Unlock'); await page.waitForSelector('.pw-prose', { timeout: 10000 });
// remove password
await menu(page, 'File', 'Remove password');
await page.waitForSelector('.dialog input[type=password]'); await page.type('.dialog input[type=password]', 'correct-horse');
await clickText(page, '.dialog button', 'Remove password'); await sleep(1500);
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose');
assert((await page.$eval('.pw-prose', (e) => e.textContent)).includes('Top secret plan more'), 'unlocked doc opens directly');
console.log('LOG', log.filter((l) => !l.includes('manifest')));
await browser.close();
