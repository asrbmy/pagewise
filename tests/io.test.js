import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { htmlToDocxBuffer } from '../src/io/docx.js';
import { importFile, textToHtml, markdownToHtml, ImportError } from '../src/io/import.js';
import { exportTxt, exportHtml, exportMarkdown, htmlToMarkdown, safeFilename, detectRichFeatures, buildStandaloneHtml } from '../src/io/export.js';
import { buildBackup, parseBackup } from '../src/io/backup.js';
import { sanitizeHtml } from '../src/io/sanitize.js';
import { cleanPastedHtml } from '../src/editor/pasteClean.js';
import { parseDataUrl, imageSize } from '../src/io/imageBytes.js';
import { groupBlocks, findCutRow, splitAtPageBreaks, toLatin1 } from '../src/io/pdf.js';

// 2x3 pixel PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAmEwIB4mS2vQAAAABJRU5ErkJggg==';

const SAMPLE = `
<h1>Quarterly report</h1>
<p style="text-align: center">Centered <strong>bold</strong> <em>italic</em> <u>underlined</u> <s>struck</s></p>
<p><span style="color: #b91c1c; font-size: 18pt; font-family: Georgia, serif">Styled run</span> and <a href="https://example.com/x">a link</a></p>
<ul><li><p>First bullet</p><ul><li><p>Nested bullet</p></li></ul></li><li><p>Second bullet</p></li></ul>
<ol><li><p>Step one</p></li><li><p>Step two</p></li></ol>
<blockquote><p>Quoted wisdom</p></blockquote>
<table><tbody><tr><th><p>Name</p></th><th><p>Score</p></th></tr><tr><td><p>Ada</p></td><td><p>42</p></td></tr></tbody></table>
<p><img src="${PNG}" alt="tiny"></p>
<hr>
<div data-type="page-break" class="page-break"></div>
<p>After the break</p>`;

async function docxFile(html, opts) {
  const { buffer, warnings } = await htmlToDocxBuffer(html, opts);
  return { file: new File([buffer], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), buffer, warnings };
}

describe('DOCX export', () => {
  it('produces a valid package with the expected content', async () => {
    const { buffer, warnings } = await htmlToDocxBuffer(SAMPLE, { title: 'Report', pageSize: 'a4' });
    expect(warnings).toEqual([]);
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/numbering.xml']));
    const xml = await zip.file('word/document.xml').async('string');
    for (const needle of ['Quarterly report', 'Heading1', 'Nested bullet', 'Step two', 'Quoted wisdom', '<w:tbl>', '<w:drawing>', 'w:br w:type="page"', 'After the break', 'w:jc w:val="center"', '<w:hyperlink', 'B91C1C', 'w:pgSz w:w="11906"']) {
      expect(xml).toContain(needle);
    }
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });

  it('reports external and SVG images instead of failing silently', async () => {
    const { warnings } = await htmlToDocxBuffer('<p><img src="https://example.com/a.png" alt="remote"></p>');
    expect(warnings.join(' ')).toMatch(/linked from the web/);
    const svg = await htmlToDocxBuffer('<p><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="vec"></p>');
    expect(svg.warnings.join(' ')).toMatch(/SVG/);
  });

  it('handles an empty document', async () => {
    const { buffer } = await htmlToDocxBuffer('<p></p>');
    expect((await JSZip.loadAsync(buffer)).file('word/document.xml')).toBeTruthy();
  });
});

describe('DOCX import (round trip through our own exporter)', () => {
  it('imports headings, lists, table, link, image and formatting', async () => {
    const { file } = await docxFile(SAMPLE);
    const result = await importFile(file);
    expect(result.title).toBe('report');
    const h = result.html;
    expect(h).toMatch(/<h1[^>]*>Quarterly report<\/h1>/);
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>italic</em>');
    expect(h).toContain('<u>underlined</u>');
    expect(h).toContain('href="https://example.com/x"');
    expect(h).toContain('Nested bullet');
    expect((h.match(/<ul>/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(h).toContain('<ol>');
    expect(h).toContain('<table>');
    expect(h).toContain('Ada');
    expect(h).toContain('<img');
    expect(h).toContain('After the break');
    // honest about what is not carried over
    expect(result.warnings.join(' ')).toMatch(/not carried over/);
  });

  it('rejects files that are not .docx packages with a helpful error', async () => {
    const bad = new File(['this is not a zip'], 'fake.docx');
    await expect(importFile(bad)).rejects.toBeInstanceOf(ImportError);
    await expect(importFile(new File(['x'], 'old.doc'))).rejects.toThrow(/\.docx/);
    await expect(importFile(new File(['x'], 'sheet.xlsx'))).rejects.toThrow(/not supported/);
  });
});

describe('text and Markdown import', () => {
  it('turns plain text into escaped paragraphs', async () => {
    expect(textToHtml('Line one\nline two\n\nSecond <b>para</b>')).toBe('<p>Line one<br>line two</p><p>Second &lt;b&gt;para&lt;/b&gt;</p>');
    const r = await importFile(new File(['Hello\n\nWorld'], 'notes.txt', { type: 'text/plain' }));
    expect(r.html).toBe('<p>Hello</p><p>World</p>');
    expect(r.title).toBe('notes');
  });

  it('converts Markdown, including tables and task lists, and strips scripts', async () => {
    const html = await markdownToHtml('# Title\n\n**bold** and *it*\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('☑');
    expect(html).toContain('☐');
    expect(html).not.toContain('<script');
  });
});

describe('other exports', () => {
  it('exports plain text and warns about lost formatting', async () => {
    const r = await exportTxt({ title: 'My: doc?', html: '<h1>Hi</h1><p><span style="color:#f00">red</span> text</p>' });
    expect(r.filename).toBe('My doc.txt');
    expect(await r.blob.text()).toBe('Hi\nred text\n');
    expect(r.warnings[0]).toMatch(/colours/);
  });

  it('exports a standalone, sanitised HTML file', async () => {
    const r = await exportHtml({ title: 'A <b>title</b>', html: '<p onclick="x()">hi</p><script>bad()</script>', pageSize: 'letter' });
    const text = await r.blob.text();
    expect(text).toContain('<!doctype html>');
    expect(text).toContain('<title>A &lt;b&gt;title&lt;/b&gt;</title>');
    expect(text).toContain('<p>hi</p>');
    expect(text).not.toContain('onclick');
    expect(text).not.toContain('bad()');
    expect(text).not.toMatch(/https?:\/\//); // no external requests
  });

  it('exports Markdown with headings, emphasis, lists, links and tables', async () => {
    const md = await htmlToMarkdown(SAMPLE);
    expect(md).toContain('# Quarterly report');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('~~struck~~');
    expect(md).toContain('[a link](https://example.com/x)');
    expect(md).toMatch(/-\s+First bullet/);
    expect(md).toMatch(/1\.\s+Step one/);
    expect(md).toContain('| Name | Score |');
    expect(md).toContain('page-break-after');
    const r = await exportMarkdown({ title: 'x', html: SAMPLE });
    expect(r.warnings.join(' ')).toMatch(/colours|font/);
  });

  it('converts editor tables (with colgroup and empty cells) to Markdown tables', async () => {
    const html = '<table style="min-width: 75px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>A</p></th><th colspan="1" rowspan="1"><p></p></th></tr><tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p></p></td></tr></tbody></table>';
    const md = await htmlToMarkdown(html);
    expect(md).toContain('| A |');
    expect(md).toContain('| --- | --- |');
    expect(md).not.toContain('<table');
  });

  it('builds safe file names', () => {
    expect(safeFilename('a/b\\c:d', 'pdf')).toBe('abcd.pdf');
    expect(safeFilename('', 'md')).toBe('Untitled document.md');
  });

  it('detects rich features', () => {
    expect(detectRichFeatures('<p style="font-size: 12pt">x</p>')).toContain('font sizes');
  });
});

describe('backup files', () => {
  it('round trips and sanitises', () => {
    const backup = buildBackup([{ id: 'a', title: 'T', html: '<p>ok<img src=x onerror=alert(1)></p><div data-type="page-break"></div>', pageSize: 'a4', createdAt: 1, updatedAt: 2, text: 'ignored' }]);
    const docs = parseBackup(JSON.stringify(backup));
    expect(docs).toHaveLength(1);
    expect(docs[0].html).not.toContain('onerror');
    expect(docs[0].html).toContain('data-type="page-break"');
    expect(docs[0].pageSize).toBe('a4');
    expect(docs[0].wordCount).toBe(1);
  });
  it('rejects non-backups', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"a":1}')).toThrow(/not a Pagewise backup/);
  });
});

describe('sanitising and paste cleaning', () => {
  it('keeps editor formatting but removes scripts and handlers', () => {
    const out = sanitizeHtml('<p style="text-align: center" data-indent="1">x<script>1</script><a href="javascript:alert(1)">l</a></p>');
    expect(out).toContain('text-align: center');
    expect(out).toContain('data-indent="1"');
    expect(out).not.toContain('script');
    expect(out).not.toContain('javascript:');
  });

  it('cleans Microsoft Word HTML and rebuilds lists', () => {
    const word = `<html><head><style>p.MsoNormal{margin:0}</style></head><body>
<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->
<p class=MsoNormal style="margin-bottom:0cm;mso-line-height-alt:12pt">Hello <b>Word</b><o:p></o:p></p>
<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Bullet one</p>
<p class=MsoListParagraph style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">o<span>&nbsp;</span></span>Nested</p>
<p class=MsoListParagraph style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>Number one</p>
</body></html>`;
    const out = cleanPastedHtml(word);
    expect(out).not.toMatch(/mso|Mso|o:p|\[if|<style/i);
    expect(out).toContain('Hello <b>Word</b>');
    expect(out).toMatch(/<ul><li>Bullet one<ul><li>Nested<\/li><\/ul><\/li><\/ul>/);
    expect(out).toMatch(/<ol><li>Number one<\/li><\/ol>/);
  });

  it('unwraps the Google Docs bold wrapper and drops tracking pixels', () => {
    const out = cleanPastedHtml('<b style="font-weight:normal" id="docs-internal-guid-1"><p>plain</p><img src="https://t.example/p.gif" width="1" height="1"></b>');
    expect(out).toBe('<p>plain</p>');
  });
});

describe('image helpers', () => {
  it('reads data URLs and PNG dimensions', () => {
    const parsed = parseDataUrl(PNG);
    expect(parsed.mime).toBe('image/png');
    expect(imageSize(parsed.bytes, parsed.mime)).toEqual({ width: 2, height: 3 });
  });
});

describe('PDF layout helpers', () => {
  it('splits content at page breaks', () => {
    const sections = splitAtPageBreaks('<p>a</p><div data-type="page-break"></div><p>b</p><p>c</p>');
    expect(sections.map((s) => s.length)).toEqual([1, 2]);
  });

  it('groups blocks into batches below the height limit', () => {
    const rects = [[0, 1000], [1000, 2000], [2000, 3000], [3000, 4000], [4000, 9000], [9000, 9100]];
    expect(groupBlocks(rects, 3200)).toEqual([[0, 1, 2], [3], [4], [5]]);
    expect(groupBlocks([], 3200)).toEqual([]);
  });

  it('cuts on a blank row instead of through text', () => {
    const w = 4;
    const rows = 10;
    const data = new Uint8ClampedArray(w * rows * 4).fill(255); // all white, opaque
    // dark "text" pixels on rows 7, 8 and 9 (the bottom edge would slice through them)
    for (const y of [7, 8, 9]) for (let x = 0; x < w; x += 1) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
    expect(findCutRow(data, w, rows, 10)).toBe(7); // keep rows 0-6, push the text to the next page
    const allText = new Uint8ClampedArray(w * rows * 4).fill(0);
    for (let i = 3; i < allText.length; i += 4) allText[i] = 255;
    expect(findCutRow(allText, w, rows, 5)).toBe(rows); // no blank row: cut at the edge
  });
});

describe('PDF text layer helpers', () => {
  it('maps typographic characters and drops glyphs a standard PDF font cannot draw', () => {
    expect(toLatin1('\u201cHello\u201d \u2013 it\u2019s\u2026')).toBe('"Hello" - it\'s...');
    expect(toLatin1('caf\u00e9')).toBe('caf\u00e9');
    expect(toLatin1('\u4e2d\u6587')).toBe('');
  });
});

describe('table of contents in exports', () => {
  it('exports as ordinary paragraphs in every text format', async () => {
    const html = '<div data-type="toc" class="toc"><p><strong>Table of contents</strong></p><p data-indent="1" style="margin-left: 48px">Details</p></div><h1>Details</h1>';
    const { htmlToMarkdown } = await import('../src/io/export.js');
    const md = await htmlToMarkdown(html);
    expect(md).toContain('Table of contents');
    expect(md).toContain('Details');
    const { buffer } = await htmlToDocxBuffer(html);
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});

describe('header, footer and page numbers', () => {
  it('normalises untrusted layout values', async () => {
    const { normalizeLayout, pageMarginRules, cssString } = await import('../src/editor/layout.js');
    expect(normalizeLayout(null)).toEqual({ header: '', footer: '', pageNumbers: 'none' });
    expect(normalizeLayout({ header: 'a\nb', footer: 'x'.repeat(500), pageNumbers: 'bogus' })).toEqual({ header: 'a b', footer: 'x'.repeat(150), pageNumbers: 'none' });
    expect(cssString('a"b\\c</style>')).not.toContain('</style>');
    const rules = pageMarginRules({ header: 'H', footer: 'F', pageNumbers: 'right' });
    expect(rules).toContain('@top-center');
    expect(rules).toContain('@bottom-right');
    expect(rules).toContain('counter(page)');
  });

  it('writes a Word header, footer and PAGE field', async () => {
    const { buffer } = await htmlToDocxBuffer('<p>x</p>', { layout: { header: 'My header', footer: 'My footer', pageNumbers: 'right' } });
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    const header = await zip.file(names.find((n) => /word\/header\d*\.xml/.test(n))).async('string');
    const footer = await zip.file(names.find((n) => /word\/footer\d*\.xml/.test(n))).async('string');
    expect(header).toContain('My header');
    expect(footer).toContain('My footer');
    expect(footer).toMatch(/PAGE/);
  });

  it('adds nothing to Word files when the layout is empty', async () => {
    const { buffer } = await htmlToDocxBuffer('<p>x</p>', {});
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).some((n) => /word\/(header|footer)/.test(n))).toBe(false);
  });

  it('puts header and footer into the exported web page, escaped', () => {
    const out = buildStandaloneHtml({ title: 't', html: '<p>x</p>', pageSize: 'letter', layout: { header: '<b>H</b>', footer: 'F', pageNumbers: 'center' } });
    expect(out).toContain('&lt;b&gt;H&lt;/b&gt;');
    expect(out).toContain('@bottom-center');
    expect(out).not.toContain('<b>H</b>');
  });
});
