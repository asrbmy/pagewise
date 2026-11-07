import fs from 'node:fs';
import { launch, BASE, OUT, sleep, assert } from './lib.mjs';
const evil = '<h1>Evil</h1><img src=x onerror="window.__pwn=1;alert(1)"><a href="javascript:window.__pwn=1">click</a><script>window.__pwn=1</script><div style="position:fixed;inset:0;background:url(https://evil.test/x)">overlay</div><svg onload="window.__pwn=1"></svg><iframe srcdoc="<script>parent.__pwn=1</script>"></iframe>';
fs.writeFileSync(OUT + '/evil.html', evil);
fs.writeFileSync(OUT + '/evil.md', '# T\n\n<img src=x onerror="window.__pwn=1">\n\n[a](javascript:window.__pwn=1)');
fs.writeFileSync(OUT + '/evil.json', JSON.stringify({ format: 'pagewise-backup', version: 1, documents: [{ id: 'e1', title: '<img src=x onerror=window.__pwn=1>', html: evil }] }));
const browser = await launch(); const page = await browser.newPage();
let dialogs = 0; page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
const requests = []; page.on('request', (r) => requests.push(r.url()));
await page.goto(BASE, { waitUntil: 'networkidle0' });
for (const f of ['evil.html', 'evil.md']) {
  const input = await page.$('input[type=file][accept*=".docx"]');
  await input.uploadFile(OUT + '/' + f); await sleep(1500);
  await page.waitForSelector('.pw-prose', { timeout: 8000 });
  const html = await page.$eval('.pw-prose', (e) => e.innerHTML);
  assert(!/onerror|javascript:|<script|<iframe|<svg|position/i.test(html), f + ' editor HTML is clean');
  assert(await page.evaluate(() => !window.__pwn), f + ' no script ran');
  await page.goBack(); await page.waitForSelector('input[type=file]'); await sleep(500);
}
const bin = await page.$('input[type=file][accept*=".json"]');
if (bin) { await bin.uploadFile(OUT + '/evil.json'); await sleep(1500); }
await page.goto(BASE + '#/d/e1', { waitUntil: 'networkidle0' }).catch(() => {}); await sleep(1000);
assert(await page.evaluate(() => !window.__pwn), 'backup restore: no script ran');
assert(dialogs === 0, 'no alert() dialogs: ' + dialogs);
assert(!requests.some((u) => u.includes('evil.test')), 'no requests to evil.test');
console.log('json input present:', !!bin);
await browser.close();
