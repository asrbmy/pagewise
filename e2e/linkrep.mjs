import { launch, BASE, sleep, clickText } from './lib.mjs';
const browser = await launch();
for (let n = 0; n < 6; n++) {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await clickText(page, 'button', 'New document');
  await page.waitForSelector('.pw-prose');
  await page.click('.pw-prose');
  await page.keyboard.type('This is a link target');
  await page.keyboard.down('Shift'); for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
  const sel = await page.evaluate(() => getSelection().toString());
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForSelector('[role=dialog]');
  const hasTextField = await page.evaluate(() => !!document.querySelector('[role=dialog] input:not([inputmode])'));
  await page.type('[role=dialog] input[inputmode=url]', 'example.com');
  await clickText(page, '[role=dialog] button', 'Apply');
  await sleep(200);
  console.log(n, JSON.stringify(sel), 'textFieldShown=', hasTextField, await page.$eval('.pw-prose', (e) => e.innerHTML));
  await page.close();
}
await browser.close();
