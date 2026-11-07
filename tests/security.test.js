import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeStyle } from '../src/io/sanitize.js';
import { parseBackup, restoreBackup, MAX_BACKUP_DOCS } from '../src/io/backup.js';
import { buildStandaloneHtml } from '../src/io/export.js';
import { textToHtml, markdownToHtml } from '../src/io/import.js';

const bad = (html) => sanitizeHtml(html);

describe('sanitizer blocks script execution', () => {
  it.each([
    ['<script>alert(1)</script><p>x</p>', /<script/i],
    ['<img src=x onerror=alert(1)>', /onerror/i],
    ['<p onclick="alert(1)">x</p>', /onclick/i],
    ['<a href="javascript:alert(1)">x</a>', /javascript:/i],
    ['<a href="  JaVaScRiPt:alert(1)">x</a>', /javascript:/i],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /data:text\/html/i],
    ['<iframe src="https://evil.test"></iframe>', /<iframe/i],
    ['<object data="x"></object><embed src="x">', /<object|<embed/i],
    ['<svg onload=alert(1)><circle/></svg>', /<svg|onload/i],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', /<math|javascript/i],
    ['<form action="https://evil.test"><input name=a></form>', /<form|<input|action=/i],
    ['<base href="https://evil.test/">', /<base/i],
    ['<meta http-equiv="refresh" content="0;url=https://evil.test">', /<meta/i],
    ['<style>body{background:url(https://evil.test)}</style>', /<style|evil/i],
    ['<video src="x" poster="https://evil.test/p"></video>', /<video|poster/i],
    ['<img src="x" srcset="https://evil.test/a.png 2x">', /srcset|evil/i],
  ])('%s', (input, forbidden) => {
    expect(bad(input)).not.toMatch(forbidden);
  });

  it('keeps ordinary formatting', () => {
    const html = '<p style="text-align: center; color: #b91c1c">Hi <strong>there</strong> <a href="https://example.com" target="_blank">link</a></p>';
    const out = bad(html);
    expect(out).toContain('<strong>there</strong>');
    expect(out).toContain('text-align: center');
    expect(out).toContain('color: #b91c1c');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });
});

describe('style attributes are limited to safe typography/layout', () => {
  it('drops positioning, url() and expression()', () => {
    expect(sanitizeStyle('position: fixed; top: 0; left: 0; width: 100%; z-index: 9999')).toBe('width: 100%');
    expect(sanitizeStyle('background: url(https://evil.test/x.png)')).toBe('');
    expect(sanitizeStyle('color: red; width: expression(alert(1))')).toBe('color: red');
    expect(sanitizeStyle('font-family: "a\\22 ; b"')).toBe('');
    expect(sanitizeStyle('color: #fff; behavior: url(x.htc)')).toBe('color: #fff');
  });
  it('removes an overlay attack end to end', () => {
    const out = bad('<div style="position:fixed;inset:0;background:url(https://evil.test)">Click here</div>');
    expect(out).not.toMatch(/position|evil|inset/);
  });
});

describe('image URL policy', () => {
  it('allows https and raster data URIs, drops everything else', () => {
    expect(bad('<img src="https://example.com/a.png">')).toContain('https://example.com/a.png');
    expect(bad('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain('data:image/png');
    expect(bad('<img src="http://example.com/a.png">')).not.toContain('http://');
    expect(bad('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')).not.toContain('svg+xml');
    expect(bad('<img src="file:///etc/passwd">')).not.toContain('file:');
    expect(bad('<img src="javascript:alert(1)">')).not.toContain('javascript');
  });
  it('sends no referrer for images', () => {
    expect(bad('<img src="https://example.com/a.png">')).toContain('referrerpolicy="no-referrer"');
  });
});

describe('importers and exports sanitise', () => {
  it('markdown and text imports cannot smuggle script', async () => {
    const md = await markdownToHtml('# Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');
    expect(md).not.toMatch(/<script|javascript:|onerror/i);
    expect(textToHtml('<img src=x onerror=alert(1)>')).not.toMatch(/<img/);
  });
  it('standalone HTML export escapes the title, sanitises the body and carries a CSP', () => {
    const out = buildStandaloneHtml({ title: '</title><script>alert(1)</script>', html: '<p onclick=alert(1)>x</p><script>alert(2)</script>', pageSize: 'letter' });
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick/);
    expect(out).toContain('Content-Security-Policy');
  });
});

describe('backup restore validation', () => {
  const wrap = (docs) => JSON.stringify({ format: 'pagewise-backup', version: 1, documents: docs });

  it('sanitises html, bounds titles, and rejects unsafe ids', () => {
    const [d] = parseBackup(wrap([{ id: '__proto__', title: 'x'.repeat(500), html: '<p onclick="a()">ok</p><script>1</script>' }]));
    expect(d.id).toBeUndefined();
    expect(d.title.length).toBeLessThanOrEqual(200);
    expect(d.html).not.toMatch(/script|onclick/);
    expect(parseBackup(wrap([{ id: '../../etc', html: '<p>a</p>' }]))[0].id).toBeUndefined();
    expect(parseBackup(wrap([{ id: 'abc-123_X', html: '<p>a</p>' }]))[0].id).toBe('abc-123_X');
  });
  it('ignores junk entries and bad timestamps', () => {
    const docs = parseBackup(wrap([null, 5, { html: 3 }, { html: '<p>a</p>', createdAt: -5, updatedAt: 'x' }]));
    expect(docs).toHaveLength(1);
    expect(docs[0].createdAt).toBeGreaterThan(0);
    expect(docs[0].updatedAt).toBeGreaterThan(0);
  });
  it('rejects wrong formats, newer versions, and too many documents', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/not a Pagewise backup/);
    expect(() => parseBackup(JSON.stringify({ format: 'pagewise-backup', version: 99, documents: [] }))).toThrow(/newer version/);
    expect(() => parseBackup(wrap(new Array(MAX_BACKUP_DOCS + 1).fill({ html: '<p></p>' })))).toThrow(/more than/);
  });
  it('rejects oversized files before reading them', async () => {
    await expect(restoreBackup({ size: 10 * 1024 * 1024 * 1024, text: async () => '' }, {})).rejects.toThrow(/too large/);
  });
});

describe('backup reminder', () => {
  it('is due only when documents exist, the last backup is old, and it is not snoozed', async () => {
    const { backupReminderDue } = await import('../src/io/backup.js');
    const DAY = 86400000;
    const now = Date.now();
    const docs = [{ createdAt: now - 30 * DAY }];
    expect(backupReminderDue({}, [], now)).toBe(false);
    expect(backupReminderDue({ lastBackupAt: 0 }, docs, now)).toBe(true); // never backed up, old documents
    expect(backupReminderDue({ lastBackupAt: 0 }, [{ createdAt: now - DAY }], now)).toBe(false); // brand new
    expect(backupReminderDue({ lastBackupAt: now - 3 * DAY }, docs, now)).toBe(false);
    expect(backupReminderDue({ lastBackupAt: now - 20 * DAY }, docs, now)).toBe(true);
    expect(backupReminderDue({ lastBackupAt: now - 20 * DAY, backupSnoozedUntil: now + DAY }, docs, now)).toBe(false);
  });
});

import JSZip from 'jszip';
import { importOdt } from '../src/io/odtImport.js';
import { rtfToHtml } from '../src/io/rtfImport.js';
import { buildEpub } from '../src/io/epub.js';
import { applyStylesToHtml } from '../src/editor/styles.js';

describe('hostile files through the newer importers/exporters', () => {
  const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const odtWith = async (body, extraRoot = '') => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    zip.file(
      'content.xml',
      `<?xml version="1.0"?>${extraRoot}<office:document-content xmlns:office="${OFFICE}" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
    );
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return { arrayBuffer: async () => buf };
  };

  it('ODT: drops javascript links and script text becomes inert text', async () => {
    const { html } = await importOdt(await odtWith('<text:p><text:a xlink:href="javascript:alert(1)">click</text:a> &lt;script&gt;alert(2)&lt;/script&gt; <text:a xlink:href="https://ok.test/">fine</text:a></text:p>'));
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('https://ok.test/');
    expect(html).toContain('click');
  });
  it('ODT: an entity-expansion document does not hang or crash', async () => {
    const bomb = '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>';
    const started = Date.now();
    await importOdt(await odtWith('<text:p>&c;</text:p>', bomb)).catch(() => {});
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('RTF: markup in text is escaped and control words cannot inject HTML', () => {
    const html = rtfToHtml('{\\rtf1 <img src=x onerror=alert(1)> \\par <b>x</b>}');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img');
  });
  it('EPUB: no script, event handlers or remote resources survive', async () => {
    const { blob } = await buildEpub('<p onclick="x()">a</p><img src="https://evil.test/p.png"><iframe src="https://evil.test"></iframe><script>1</script>', { title: 'T' });
    const zip = await JSZip.loadAsync(await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(blob); }));
    const all = (await Promise.all(Object.keys(zip.files).filter((n) => /xhtml$/.test(n)).map((n) => zip.file(n).async('string')))).join('\n');
    expect(all).not.toMatch(/onclick|<script|<iframe|evil\.test/i);
  });
  it('document styles cannot smuggle CSS into exports', () => {
    const html = applyStylesToHtml('<p>x</p>', { normal: { color: '#ff0000; background:url(http://evil.test/x)', font: 'x; behavior:url(x)' } });
    expect(html).toBe('<p>x</p>');
  });
});
