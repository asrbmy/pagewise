import { launch, watch, BASE, sleep, clickText, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const log = []; watch(page, log);
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
const src = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 3000; const x = c.getContext('2d'); x.fillStyle = '#39c'; x.fillRect(0, 0, 400, 3000); return c.toDataURL('image/png'); });
const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(150);
const html = `<p>${words}</p><p><img src="${src}" alt="tall"></p><p>${words}</p>`;
await page.evaluate((h) => {
  const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', 'x');
  document.querySelector('.pw-prose').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
await sleep(3500);
const H = 1056, M = 96;
const r = await page.evaluate(() => {
  const prose = document.querySelector('.pw-prose'); const origin = prose.getBoundingClientRect().top - prose.clientTop;
  const img = prose.querySelector('img[alt="tall"]'); const b = img.getBoundingClientRect();
  return { top: b.top - origin, bottom: b.bottom - origin, h: b.height, w: b.width, nat: [img.naturalWidth, img.naturalHeight] };
});
assert(r.h <= H - 2 * M + 1, `image height ${Math.round(r.h)} fits a page's text area`);
const pg = Math.floor(r.top / H);
assert(r.bottom <= (pg + 1) * H - M + 2 && r.top >= pg * H + M - 2, `image sits inside one page (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)})`);
assert(Math.abs(r.w / r.h - r.nat[0] / r.nat[1]) < 0.02, 'image keeps its proportions');
console.log('LOG', log);
await browser.close();
