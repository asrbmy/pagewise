import { launch, watch, BASE, sleep, clickText, menu, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Columns and landscape test. '.repeat(40)); await sleep(500);
const wBefore = await page.$eval('.sheet', (e) => e.getBoundingClientRect().width / (e.getBoundingClientRect().width / e.offsetWidth));
await menu(page, 'File', 'Page setup…'); await page.waitForSelector('#pw-columns');
await page.click('input[name="page-orientation"][value="landscape"]');
await page.select('#pw-columns', '2');
await clickText(page, '.dialog button', 'OK'); await sleep(700);
const info = await page.evaluate(() => ({
  w: document.querySelector('.sheet').offsetWidth,
  cols: getComputedStyle(document.querySelector('.pw-prose')).columnCount,
  attr: document.querySelector('.sheet').getAttribute('data-columns'),
  pageRule: document.getElementById('pw-page-style').textContent,
  status: document.body.textContent.includes('landscape') && document.body.textContent.includes('2 columns'),
}));
assert(wBefore === 816 && info.w === 1056, 'landscape widens sheet: ' + wBefore + ' -> ' + info.w);
assert(info.cols === '2' && info.attr === '2', 'two columns applied: ' + JSON.stringify(info));
assert(/landscape/.test(info.pageRule), 'print @page landscape: ' + info.pageRule);
assert(info.status, 'status bar shows landscape and columns');
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.pw-prose');
const kept = await page.evaluate(() => ({ w: document.querySelector('.sheet').offsetWidth, cols: getComputedStyle(document.querySelector('.pw-prose')).columnCount }));
assert(kept.w === 1056 && kept.cols === '2', 'layout persists after reload: ' + JSON.stringify(kept));
console.log('LOG', log);
await browser.close();
