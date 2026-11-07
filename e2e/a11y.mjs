import fs from 'node:fs';
import { launch, BASE, sleep, clickText, menu } from './lib.mjs';
const axeSrc = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await launch(); const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
let total = 0;
async function audit(name) {
  await page.evaluate(axeSrc);
  const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  for (const v of res.violations) {
    total += v.nodes.length;
    console.log(`[${name}] ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`);
    v.nodes.slice(0, 2).forEach((n) => console.log('    ', n.target.join(' '), '|', (n.failureSummary || '').split('\n')[1] || ''));
  }
}
await page.goto(BASE, { waitUntil: 'networkidle0' });
await clickText(page, 'button', 'New document'); await page.waitForSelector('.pw-prose'); await page.click('.pw-prose');
await page.keyboard.type('Heading text'); await page.select('select[aria-label="Paragraph style"]', 'h1'); await page.keyboard.press('Enter');
await page.keyboard.type('Body text with a link'); await sleep(1000);
await audit('editor');
await menu(page, 'Insert', 'Table…'); await page.waitForSelector('.dialog'); await audit('table dialog'); await page.keyboard.press('Escape');
await menu(page, 'File', 'Page setup…'); await page.waitForSelector('.dialog'); await audit('page setup'); await page.keyboard.press('Escape');
await menu(page, 'File', 'Version history…'); await page.waitForSelector('.dialog'); await audit('versions'); await page.keyboard.press('Escape');
await page.click('[aria-label="Dark theme"], [title*="theme" i]').catch(() => {});
await page.goto(BASE, { waitUntil: 'networkidle0' }); await page.waitForSelector('.home-main'); await sleep(500);
await audit('home');
await clickText(page, 'button', 'Templates'); await page.waitForSelector('.dialog'); await audit('templates'); await page.keyboard.press('Escape');
await page.click('[aria-label="Privacy and storage"]'); await page.waitForSelector('.dialog'); await audit('privacy'); await page.keyboard.press('Escape');
// dark mode
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
await audit('home (dark)');
console.log('TOTAL violating nodes:', total);
await browser.close();
