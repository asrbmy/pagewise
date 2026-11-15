import { launch, watch, BASE, sleep, assert, HERE } from './lib.mjs';
const browser = await launch(); const page = await browser.newPage();
const log = []; watch(page, log); page.on('dialog', (d) => d.accept());
await page.goto(BASE, { waitUntil: 'networkidle0' });
await (await page.$('input[type=file]')).uploadFile(HERE + '/fixtures/gdoc.zip');
await page.waitForSelector('.pw-prose h1', { timeout: 15000 }); await sleep(800);
const r = await page.evaluate(() => {
  const p = document.querySelector('.pw-prose');
  return {
    heads: [...p.querySelectorAll('h1')].map((e) => e.textContent),
    strong: [...p.querySelectorAll('strong')].map((e) => e.textContent),
    em: [...p.querySelectorAll('em')].map((e) => e.textContent),
    href: p.querySelector('a')?.getAttribute('href'),
    img: p.querySelector('img[alt="dot"]')?.getAttribute('src')?.slice(0, 22),
    title: document.title,
  };
});
const tail = (await page.$eval('.pw-prose', (e) => e.innerHTML)).slice(-300);
assert(r.heads.includes('Imported Plan') && r.heads.includes('Goals'), 'title and heading: ' + r.heads);
assert(r.strong.includes('Bold start') && r.em.join().includes('red italic'), 'bold and italic restored');
assert(r.href === 'https://example.com/page', 'google redirect unwrapped: ' + r.href);
assert(r.img === 'data:image/png;base64,', 'image embedded from zip: ' + r.img + ' :: ' + tail);
console.log('LOG', log.slice(0, 5));
await browser.close();
