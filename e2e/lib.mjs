import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.APP_BASE || 'http://localhost:4173/my-repo/';
export const OUT = path.join(os.tmpdir(), 'pagewise-e2e');
fs.mkdirSync(OUT, { recursive: true });
// A 1x1 PNG some suites upload as a test image.
fs.writeFileSync(path.join(OUT, 'test-image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
export async function launch(extraArgs = []) {
  const exe = await chromium.executablePath();
  return puppeteer.launch({ executablePath: exe, args: [...chromium.args, ...extraArgs], headless: 'shell', defaultViewport: { width: 1280, height: 800 } });
}
export function watch(page, log) {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.url()}`); });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function clickText(page, selector, text, { exact = true } = {}) {
  const ok = await page.evaluate((selector, text, exact) => {
    const els = [...document.querySelectorAll(selector)];
    const el = els.find((e) => { const t = (e.getAttribute('aria-label') || e.textContent || '').trim(); return exact ? t === text : t.includes(text); });
    if (!el) return false;
    el.click();
    return true;
  }, selector, text, exact);
  if (!ok) throw new Error(`clickText: no ${selector} with text "${text}"`);
}
export async function menu(page, top, item) {
  await clickText(page, '.menubar [role=menuitem][aria-haspopup]', top);
  await sleep(120);
  await clickText(page, '.menu [role^=menuitem]', item, { exact: false });
  await sleep(250);
}
export async function setDownloads(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
}
export async function waitForFile(dir, ext, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = fs.readdirSync(dir).find((n) => n.endsWith(ext) && !n.endsWith('.crdownload'));
    if (f) return dir + '/' + f;
    await sleep(200);
  }
  throw new Error('timeout waiting for *' + ext);
}
export async function status(page) {
  return page.$eval('.save-status', (e) => e.textContent.trim());
}
export function assert(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok  :', msg);
}
