import { launch, watch, BASE, sleep, clickText, menu, assert, HERE } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await menu(page, 'Insert', 'Image…'); await page.waitForSelector('[role=dialog]');
await (await page.$('[role=dialog] input[type=file]')).uploadFile(HERE + '/fixtures/photo.png');
await page.type('[role=dialog] input[placeholder^="Describe"]', 'Photo');
await clickText(page, '[role=dialog] button', 'Insert'); await sleep(800);
const size = () => page.$eval('.pw-prose img:not(.ProseMirror-separator)', (i) => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 30) })).then((r) => { return [r.w, r.h]; });
const [w0, h0] = await size(); 
assert(w0 === 200 && h0 === 100, `original size ${w0}x${h0}`);
await page.click('.pw-prose img:not(.ProseMirror-separator)'); await sleep(300);
await menu(page, 'Format', 'Image: crop…'); await page.waitForSelector('.crop-sliders');
// trim the left half: slider is capped at 60%; set 50
await page.$eval('.crop-sliders label:nth-child(3) input', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '50'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await clickText(page, '.dialog button', 'Crop'); await sleep(800);
const [w1, h1] = await size();
assert(w1 === 100 && h1 === 100, `cropped to ${w1}x${h1}`);
// the remaining pixels are the right (blue) half
const px = await page.$eval('.pw-prose img:not(.ProseMirror-separator)', (n) => { const c = document.createElement('canvas'); c.width = n.naturalWidth; c.height = n.naturalHeight; const x = c.getContext('2d'); x.drawImage(n, 0, 0); return [...x.getImageData(5, 5, 1, 1).data]; });
assert(px[2] > 150 && px[0] < 80, 'kept the blue half: ' + px);
console.log('LOG', log);
await browser.close();
