import { launch, watch, BASE, sleep, clickText, assert } from './lib.mjs';
import { HERE } from './lib.mjs';
const LO = HERE + '/fixtures/';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
for (const f of ['in.odt', 'in.rtf']) {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const input = await page.$('input[type=file]');
  await input.uploadFile(LO + f);
  await page.waitForSelector('.pw-prose', { timeout: 15000 }); await sleep(600);
  const html = await page.$eval('.pw-prose', (e) => e.innerHTML);
  console.log(f, html.replace(/\s+/g, ' ').slice(0, 700));
  assert(/Quarterly Plan/.test(html) && /First/.test(html), f + ' imported');
  if (f === 'in.odt') assert(/<h1[^>]*>Quarterly Plan/.test(html) && /<strong>bold/.test(html) && /<ol/.test(html) && /<table/.test(html), 'odt structure');
  if (f === 'in.rtf') assert(/<strong>bold/.test(html), 'rtf bold');
}
console.log('LOG', log);
await browser.close();
