import { launch, watch, BASE, sleep, clickText, assert } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const log = []; watch(page, log);
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(220);
const rows = Array.from({ length: 70 }, (_, i) => `<tr><td>Row ${i}</td><td>value ${i}</td><td>more</td></tr>`).join('');
const html = `<p>Intro paragraph.</p><p>${words}</p><p>Between.</p><table><tbody>${rows}</tbody></table><p>End.</p>`;
await page.evaluate((h) => {
  const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', 'x');
  document.querySelector('.pw-prose').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
await sleep(3500);
const H = 1056, M = 96;
const measure = () => page.evaluate((H, M) => {
  const prose = document.querySelector('.pw-prose');
  const origin = prose.getBoundingClientRect().top - prose.clientTop;
  const bad = [];
  // 1. every text line of the long paragraph
  const para = [...prose.children].find((e) => e.tagName === 'P' && e.textContent.length > 5000);
  const lines = [];
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest('.page-spacer')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    lines.push(...[...range.getClientRects()].filter((r) => r.height > 4 && r.width > 2));
  }
  for (const r of lines) {
    const top = r.top - origin, bottom = r.bottom - origin;
    const page = Math.floor(top / H);
    if (bottom > (page + 1) * H - M + 2 || top < page * H + M - 2) bad.push(['line', Math.round(top), Math.round(bottom)]);
  }
  // 2. every table row
  const rowEls = [...prose.querySelectorAll('tr:not(.page-spacer-row)')];
  for (const tr of rowEls) {
    const r = tr.getBoundingClientRect(); const top = r.top - origin, bottom = r.bottom - origin;
    const page = Math.floor(top / H);
    if (bottom > (page + 1) * H - M + 2 || top < page * H + M - 2) bad.push(['row', tr.textContent.slice(0, 8), Math.round(top), Math.round(bottom)]);
  }
  return { bad, lines: lines.length, rows: rowEls.length, inner: para.querySelectorAll('.page-spacer').length, rowSp: prose.querySelectorAll('tr.page-spacer-row').length, height: prose.offsetHeight };
}, H, M);
let r = await measure();
console.log(JSON.stringify({ ...r, bad: r.bad.slice(0, 4) }));
assert(r.inner >= 2, 'long paragraph was split by in-paragraph gaps: ' + r.inner);
assert(r.rowSp >= 1, 'table was split between rows: ' + r.rowSp);
assert(r.bad.length === 0, 'no line or row crosses a page edge or margin: ' + JSON.stringify(r.bad.slice(0, 4)));
// editing keeps it consistent: type in the middle of the long paragraph
await page.evaluate(() => { const p = [...document.querySelectorAll('.pw-prose > p')].find((e) => e.textContent.length > 5000); p.scrollIntoView(); });
const box = await page.evaluate(() => { const p = [...document.querySelectorAll('.pw-prose > p')].find((e) => e.textContent.length > 5000); const r = p.getBoundingClientRect(); return { x: r.left + 40, y: Math.min(r.top + 60, 500) }; });
await page.mouse.click(box.x, box.y);
await page.keyboard.type(' EDIT '.repeat(30)); await sleep(2500);
r = await measure();
assert(r.bad.length === 0, 'still clean after editing: ' + JSON.stringify(r.bad.slice(0, 4)));
// text content is untouched by the gaps
const text = await page.$eval('.pw-prose', (e) => e.textContent);
assert(!/undefined/.test(text) && text.includes('EDIT'), 'content intact');
// shrinking the paragraph removes the gaps
await page.evaluate(() => { const p = [...document.querySelectorAll('.pw-prose > p')].find((e) => e.textContent.length > 5000); const s = window.getSelection(); s.selectAllChildren(p); });
await page.keyboard.type('Short now.'); await sleep(2500);
const after = await page.evaluate(() => document.querySelectorAll('.pw-prose p .page-spacer').length);
assert(after === 0, 'in-paragraph gaps removed when paragraph shrinks: ' + after);
console.log('LOG', log.slice(0, 5));
await browser.close();
