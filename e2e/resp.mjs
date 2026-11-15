import { launch, watch, BASE, sleep, clickText, assert } from './lib.mjs';
const browser = await launch();
const log = [];

// 1. phone, tablet, desktop: nothing is clipped or scrolls sideways, every tool is reachable
for (const [name, vp] of Object.entries({ small: { width: 320, height: 640, isMobile: true, hasTouch: true }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true }, tablet: { width: 820, height: 1000 }, desktop: { width: 1366, height: 800 } })) {
  const page = await browser.newPage(); watch(page, log); await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('pw-toolbar-folded'); } catch {} }); await page.setViewport(vp);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const home = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(home <= 0, `${name}: home has no sideways scroll (${home})`);
  await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await sleep(500);
  if (name === 'small' || name === 'phone') {
    // starts folded on phones; unfold to reach the tools
    assert(await page.$('.toolbar[data-folded="true"]'), `${name}: toolbar starts folded`);
    await page.click('.tb-toggle'); await sleep(200);
    assert(!(await page.$('.toolbar[data-folded="true"]')), `${name}: toolbar unfolds`);
  }
  const r = await page.evaluate(() => {
    const out = { over: document.documentElement.scrollWidth - innerWidth, hidden: [], menus: [] };
    const tb = document.querySelector('.toolbar');
    const tr = tb.getBoundingClientRect();
    out.toolbarOverflowX = tb.scrollWidth - tb.clientWidth;
    tb.querySelectorAll('button, select, input').forEach((el) => {
      if (getComputedStyle(el).display === 'none') return;
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > innerWidth + 1 || b.left < -1)) out.hidden.push(el.getAttribute('aria-label') || el.className);
    });
    document.querySelectorAll('.menu-button').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.right > innerWidth + 1 || b.left < -1) out.menus.push(el.textContent);
    });
    return out;
  });
  assert(r.over <= 0, `${name}: editor has no sideways scroll (${r.over})`);
  assert(r.toolbarOverflowX <= 0, `${name}: toolbar does not hide tools (${r.toolbarOverflowX})`);
  assert(r.hidden.length === 0, `${name}: every toolbar control is on screen: ${r.hidden}`);
  assert(r.menus.length === 0, `${name}: every menu is on screen: ${r.menus}`);
  // a popover opened from the far end of the toolbar stays inside the screen
  await page.click('.popover-wrap .tb-btn'); await sleep(200);
  const pop = await page.$eval('.popover', (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; });
  assert(pop.l >= 0 && pop.r <= vp.width + 1, `${name}: popover on screen (${pop.l}..${pop.r})`);
  await page.close();
}

// 2. Arabic: the interface mirrors, the document does not
{
  const page = await browser.newPage(); watch(page, log); await page.setViewport({ width: 1100, height: 760 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.select('.lang-select', 'ar'); await sleep(400);
  const dir = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang }));
  assert(dir.dir === 'rtl' && dir.lang === 'ar', 'Arabic sets dir=rtl: ' + JSON.stringify(dir));
  const home = await page.evaluate(() => document.body.innerText);
  assert(home.includes('مستنداتك') && home.includes('القوالب') && !/Last modified \(/.test(home), 'home page is translated');
  await clickText(page, 'button', 'مستند جديد'); await page.waitForSelector('.pw-prose'); await sleep(500);
  const e = await page.evaluate(() => {
    const logo = document.querySelector('.home-link').getBoundingClientRect();
    const save = document.querySelector('.save-status').getBoundingClientRect();
    return { logoRight: innerWidth - logo.right, saveLeft: save.left, docDir: getComputedStyle(document.querySelector('.pw-prose')).direction, status: document.querySelector('.statusbar').innerText };
  });
  assert(e.logoRight < 60, 'logo sits on the right in RTL: ' + e.logoRight);
  assert(e.docDir === 'ltr', 'document area keeps left-to-right by default');
  assert(/كلمات|كلمة/.test(e.status) && /صفحة/.test(e.status), 'status bar is translated: ' + e.status);
  // a right-to-left paragraph still works inside an Arabic interface
  await page.click('.pw-prose'); await page.keyboard.type('مرحبا'); 
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('x'); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(300);
  assert(await page.$('.pw-prose p[dir="rtl"]'), 'Ctrl+Shift+X sets the paragraph right-to-left');
  // switching back restores the layout
  await sleep(1200); await page.evaluate(() => { location.hash = '#/'; }); await page.waitForSelector('.lang-select');
  await page.select('.lang-select', 'en'); await sleep(300);
  assert((await page.evaluate(() => document.documentElement.dir)) === 'ltr', 'English restores dir=ltr');
  await page.close();
}
console.log('LOG', log.slice(0, 5));
await browser.close();
