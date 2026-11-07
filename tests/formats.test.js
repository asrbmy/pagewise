import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseDocument, hexColor, toPoints } from '../src/io/model.js';
import { buildRtf, rtfEscape } from '../src/io/rtf.js';
import { buildOdt, xmlEscape } from '../src/io/odt.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SAMPLE = `<h1 style="text-align: center">Title</h1>
<p style="text-align: right; margin-top: 6pt; margin-bottom: 12pt">Hello <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s> <span style="color: #b91c1c; font-size: 14pt; font-family: Georgia, serif">red</span> <mark data-color="#ffff00" style="background-color: #ffff00">hi</mark> <a href="https://example.com/a?b=1&c=2">link</a> x<sup>2</sup> H<sub>2</sub>O</p>
<p>Unicode: café — “quotes” 中文 😀</p>
<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li><li><p>two</p></li></ul>
<ol><li><p>first</p></li><li><p>second</p></li></ol>
<blockquote><p>quoted</p></blockquote>
<table><tbody><tr><th><p>H1</p></th><th colspan="2"><p>H2</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></tbody></table>
<hr><p><img src="${PNG}" alt="dot"></p>
<div data-type="page-break"></div><p>After &amp; &lt;done&gt; {braces} \\backslash</p>`;

describe('document model', () => {
  it('parses blocks, lists, tables and marks', () => {
    const { blocks } = parseDocument(SAMPLE);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual(expect.arrayContaining(['para', 'table', 'hr', 'pagebreak']));
    expect(blocks[0]).toMatchObject({ heading: 1, align: 'center' });
    const p = blocks[1];
    expect(p.align).toBe('right');
    expect(p.before).toBe(6);
    expect(p.runs.find((r) => r.text === 'bold').bold).toBe(true);
    expect(p.runs.find((r) => r.text === 'red')).toMatchObject({ color: 'b91c1c', size: 14, font: 'Georgia' });
    expect(p.runs.find((r) => r.text === 'hi').bg).toBe('ffff00');
    expect(p.runs.find((r) => r.text === 'link').href).toBe('https://example.com/a?b=1&c=2');
    const lists = blocks.filter((b) => b.list);
    expect(lists.map((b) => [b.list.depth, b.list.ordered])).toEqual([[0, false], [1, false], [0, false], [0, true], [0, true]]);
    expect(blocks.find((b) => b.kind === 'table').rows[0].cells[1].colspan).toBe(2);
    expect(blocks.some((b) => b.quote)).toBe(true);
  });
  it('converts colours and lengths', () => {
    expect(hexColor('rgb(185, 28, 28)')).toBe('b91c1c');
    expect(hexColor('#abc')).toBe('aabbcc');
    expect(hexColor('nonsense')).toBe('');
    expect(toPoints('12pt')).toBe(12);
    expect(toPoints('16px')).toBe(12);
  });
  it('reports images it cannot embed', () => {
    const { blocks, warnings } = parseDocument('<p><img src="https://example.com/x.png" alt="remote"></p>');
    expect(blocks[0].runs[0].text).toBe('[remote]');
    expect(warnings.join(' ')).toMatch(/linked from the web/);
  });
});

describe('RTF export', () => {
  const { rtf, warnings } = buildRtf(SAMPLE, { title: 'T', pageSize: 'a4', layout: { header: 'HDR', footer: 'FTR', pageNumbers: 'right' } });

  it('is a balanced RTF document', () => {
    expect(rtf.startsWith('{\\rtf1')).toBe(true);
    let depth = 0;
    for (let i = 0; i < rtf.length; i += 1) {
      if (rtf[i] === '\\') { i += 1; continue; }
      if (rtf[i] === '{') depth += 1;
      if (rtf[i] === '}') depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
  it('carries text, formatting, tables, images, page breaks, header and footer', () => {
    for (const needle of ['\\qc', '\\qr', '\\b ', '\\i ', '\\ul', '\\strike', '\\super', '\\sub', '\\highlight', '\\trowd', '\\cellx', '\\pngblip', '\\page', '{\\header', '{\\footer', 'PAGE', 'HYPERLINK "https://example.com/a?b=1&c=2"', '\\paperw11906', 'HDR', 'FTR', '\\u8226?']) {
      expect(rtf).toContain(needle);
    }
    expect(rtf).toContain('\\red185\\green28\\blue28');
    expect(rtf).toMatch(/\\fonttbl.*Georgia/s);
  });
  it('escapes special and non-ASCII characters', () => {
    expect(rtfEscape('a{b}c\\d')).toBe('a\\{b\\}c\\\\d');
    expect(rtfEscape('é')).toBe('\\u233?');
    expect(rtfEscape('😀')).toBe('\\u-10179?\\u-8704?');
    expect(rtf).toContain('\\{braces\\}');
    expect(warnings).toEqual([]);
  });
});

describe('ODT export', () => {
  it('is a valid OpenDocument package with well-formed XML', async () => {
    const { blob, warnings } = await buildOdt(SAMPLE, { title: 'T & <T>', pageSize: 'a4', layout: { header: 'HDR', footer: 'FTR', pageNumbers: 'center' } });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype').async('string')).toBe('application/vnd.oasis.opendocument.text');
    expect(names).toEqual(expect.arrayContaining(['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml', 'Pictures/image1.png']));
    for (const part of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) {
      const xml = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
      expect(xml.getElementsByTagName('parsererror').length, part).toBe(0);
    }
    const content = await zip.file('content.xml').async('string');
    for (const needle of ['text:h', 'text:outline-level="1"', 'text:list', 'table:table-cell', 'table:number-columns-spanned="2"', 'text:a', 'draw:image', 'fo:break-after="page"', 'fo:font-weight="bold"', 'fo:color="#b91c1c"', 'fo:background-color="#ffff00"', 'style:text-position="super', 'café', '中文']) {
      expect(content).toContain(needle);
    }
    expect(content).toContain('https://example.com/a?b=1&amp;c=2');
    expect(content).toContain('After &amp; &lt;done&gt;');
    const styles = await zip.file('styles.xml').async('string');
    expect(styles).toContain('HDR');
    expect(styles).toContain('text:page-number');
    expect(styles).toContain('fo:page-width="21cm"');
    expect(warnings).toEqual([]);
  });
  it('escapes XML and drops control characters', () => {
    expect(xmlEscape('a<b>&"c\u0001')).toBe('a&lt;b&gt;&amp;&quot;c');
  });
  it('handles an empty document', async () => {
    const { blob } = await buildOdt('', {});
    expect(blob.size).toBeGreaterThan(500);
  });
});

import { buildExtensions as _bx } from '../src/editor/extensions/index.js';
import { Editor as _Editor } from '@tiptap/core';
import { prepareForExport as _prep } from '../src/io/prepare.js';

describe('linked table of contents', () => {
  const make = (html) => new _Editor({ extensions: _bx(), content: html });
  it('links entries to heading ids and survives an HTML round trip', () => {
    const ed = make('<h1>Intro</h1><p>a</p><h2>Details</h2><p>b</p>');
    ed.commands.focus('end');
    ed.commands.insertTableOfContents();
    const html = ed.getHTML();
    expect(html).toContain('<h1 id="h-1">Intro</h1>');
    expect(html).toContain('<h2 id="h-2">Details</h2>');
    expect(html).toContain('href="#h-1"');
    const again = make(html);
    expect(again.getHTML()).toContain('href="#h-2"');
    ed.destroy();
    again.destroy();
  });
  it('update refreshes links after headings change', () => {
    const ed = make('<h1>One</h1><p>x</p>');
    ed.commands.insertTableOfContents();
    ed.commands.insertContentAt(ed.state.doc.content.size, '<h1>Two</h1>');
    ed.commands.updateTableOfContents();
    expect(ed.getHTML()).toContain('href="#h-2"');
    ed.destroy();
  });
  it('unwraps internal links for non-HTML exports only', () => {
    const html = '<p><a href="#h-1">Intro</a> <a href="https://x.test/">web</a></p>';
    expect(_prep(html)).not.toContain('#h-1');
    expect(_prep(html)).toContain('https://x.test/');
    expect(_prep(html, { keepAnchors: true })).toContain('#h-1');
  });
});

describe('table cell colour', () => {
  it('stores a hex background and rejects anything else', () => {
    const ed = new _Editor({ extensions: _bx(), content: '<table><tr><td style="background-color: #fff2cc">a</td><td style="background:url(x)">b</td></tr></table>' });
    const html = ed.getHTML();
    expect(html).toMatch(/background-color: (#fff2cc|rgb\(255, 242, 204\))/);
    const again = new _Editor({ extensions: _bx(), content: html });
    expect(again.getHTML()).toMatch(/rgb\(255, 242, 204\)|#fff2cc/);
    again.destroy();
    expect(html).not.toContain('url(');
    ed.destroy();
  });
});

import { buildOdt as _buildOdt } from '../src/io/odt.js';
import { buildRtf as _buildRtf } from '../src/io/rtf.js';
import { importOdt as _importOdt } from '../src/io/odtImport.js';
import { rtfToHtml as _rtfToHtml, importRtf as _importRtf } from '../src/io/rtfImport.js';

describe('ODT and RTF import', () => {
  const sample = '<h1>Title</h1><p>Plain <strong>bold</strong> and <em>italic</em> <a href="https://example.com/">link</a></p><ul><li><p>one</p></li><li><p>two</p></li></ul><table><tr><td>a</td><td>b</td></tr></table>';
  const blobOf = async (promise, type) => {
    const out = await promise;
    return new Blob([out], { type });
  };
  it('reads back a document written by our own ODT exporter', async () => {
    const { blob } = await _buildOdt(sample, { title: 'T', pageSize: 'a4' });
    const buf = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(blob); });
    const { html } = await _importOdt({ arrayBuffer: async () => buf });
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toMatch(/<ul>.*one.*two/s);
    expect(html).toMatch(/<td>.*a.*<\/td>/s);
  });
  it('rejects non-ODT zips and garbage', async () => {
    await expect(_importOdt({ arrayBuffer: async () => new TextEncoder().encode('nope').buffer })).rejects.toThrow();
  });
  it('parses RTF text, formatting, unicode and alignment', () => {
    const html = _rtfToHtml('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard\\qc Hello \\b bold\\b0  caf\\u233? \\\'e9\\par\\pard Second line\\par}');
    expect(html).toContain('<p style="text-align: center">Hello <strong>bold</strong>');
    expect(html).toContain('café é');
    expect(html).toContain('<p>Second line</p>');
    expect(html).not.toContain('Arial');
  });
  it('rejects non-RTF', async () => {
    await expect(_importRtf({ size: 4, text: async () => 'abcd' })).rejects.toThrow(/not a valid RTF/);
  });
  it('round-trips our RTF export and strips scripts', async () => {
    const { rtf: text } = _buildRtf('<p>Hi <b>there</b></p>', { title: 'T', pageSize: 'a4' });
    const { html } = await _importRtf({ size: text.length, text: async () => text });
    expect(html).toContain('Hi');
    expect(html).toContain('<strong>there</strong>');
    expect(_rtfToHtml('{\\rtf1 <script>alert(1)</script>\\par}')).not.toMatch(/<script/);
  });
});

import { buildEpub as _buildEpub } from '../src/io/epub.js';
import JSZip from 'jszip';

describe('EPUB export', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const read = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(blob); });
  it('builds a valid package: stored mimetype first, chapters per H1, images as files, well-formed XML', async () => {
    const html = `<h1>One</h1><p>a &amp; b<br>c</p><img src="${png}" alt="dot"><h1>Two</h1><p>x</p><img src="https://evil.test/a.png" alt="remote"><script>alert(1)</script>`;
    const { blob } = await _buildEpub(html, { title: 'My <Book>' });
    const zip = await JSZip.loadAsync(await read(blob));
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype').async('string')).toBe('application/epub+zip');
    expect(names).toEqual(expect.arrayContaining(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/images/img1.png', 'OEBPS/nav.xhtml', 'OEBPS/content.opf']));
    for (const n of names.filter((x) => /\.(xhtml|opf|xml)$/.test(x))) {
      const doc = new DOMParser().parseFromString(await zip.file(n).async('string'), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, n).toBe(0);
    }
    const ch1 = await zip.file('OEBPS/ch1.xhtml').async('string');
    expect(ch1).toContain('src="images/img1.png"');
    expect(ch1).toMatch(/<br ?\/>/);
    const ch2 = await zip.file('OEBPS/ch2.xhtml').async('string');
    expect(ch2).toContain('[remote]');
    expect(ch2).not.toContain('evil.test');
    expect(ch2).not.toContain('script');
    expect(await zip.file('OEBPS/content.opf').async('string')).toContain('My &lt;Book&gt;');
  });
});

describe('captions', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  it('numbers captions per kind and places them after the image or table', () => {
    const ed = new _Editor({ extensions: _bx(), content: `<p><img src="${png}"></p><p>mid</p><table><tr><td>a</td></tr></table><p>end</p>` });
    // cursor inside the table cell
    let tablePos = 0;
    ed.state.doc.descendants((n, pos) => { if (n.type.name === 'tableCell') tablePos = pos + 2; });
    ed.commands.setTextSelection(tablePos);
    ed.commands.insertCaption();
    ed.commands.setTextSelection(1); // inside the image paragraph
    ed.commands.insertCaption();
    ed.commands.insertCaption();
    const html = ed.getHTML();
    expect(html).toMatch(/<table[^>]*>.*<\/table><p[^>]*data-caption="table"[^>]*>(<em>)?Table 1: /s);
    expect(html).toContain('Figure 1: ');
    expect(html).toContain('Figure 2: ');
    expect(html.indexOf('Figure 1')).toBeGreaterThan(html.indexOf('<img'));
    ed.destroy();
  });
});

import { slugifyBookmark as _slug, collectBookmarks as _collect } from '../src/editor/extensions/bookmark.js';

describe('bookmarks', () => {
  it('slugifies names', () => {
    expect(_slug('My Section 2!')).toBe('my-section-2');
    expect(_slug('Café Über')).toBe('cafe-uber');
    expect(_slug('---')).toBe('');
  });
  it('sets a bookmark, moves it when reused, keeps links, and survives a round trip', () => {
    const ed = new _Editor({ extensions: _bx(), content: '<p>first</p><h2>second</h2>' });
    ed.commands.setTextSelection(2);
    ed.commands.setBookmark('start');
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 2);
    ed.commands.setBookmark('start'); // moves to the heading
    expect(_collect(ed.state.doc).map((b) => b.text)).toEqual(['second']);
    ed.commands.setBookmark('Bad Name'); // invalid -> rejected
    expect(_collect(ed.state.doc)).toHaveLength(1);
    ed.commands.setTextSelection(2);
    ed.commands.insertContent({ type: 'text', text: 'jump', marks: [{ type: 'link', attrs: { href: '#bm-start' } }] });
    const html = ed.getHTML();
    expect(html).toContain('data-bookmark="start"');
    expect(html).toContain('href="#bm-start"');
    const again = new _Editor({ extensions: _bx(), content: html });
    expect(_collect(again.state.doc)).toHaveLength(1);
    ed.commands.removeBookmark('start');
    expect(_collect(ed.state.doc)).toHaveLength(0);
    ed.destroy(); again.destroy();
  });
  it('exports: HTML gets real anchors, other formats drop the links', () => {
    const html = '<h2 data-bookmark="intro">Intro</h2><p><a href="#bm-intro">see</a></p>';
    expect(_prep(html, { keepAnchors: true })).toContain('id="bm-intro"');
    expect(_prep(html)).not.toContain('#bm-intro');
    expect(_prep(html)).toContain('see');
  });
  it('rejects hostile bookmark names on parse', () => {
    const ed = new _Editor({ extensions: _bx(), content: '<p data-bookmark="x&quot; onclick=&quot;alert(1)">a</p>' });
    expect(ed.getHTML()).not.toContain('onclick');
    expect(_collect(ed.state.doc)).toHaveLength(0);
    ed.destroy();
  });
});

import { normalizeStyles as _ns, stylesCss as _css, applyStylesToHtml as _apply } from '../src/editor/styles.js';
import { htmlToDocxBlob as _docx } from '../src/io/docx.js';

describe('document styles', () => {
  it('keeps only valid settings', () => {
    const n = _ns({ h1: { font: 'Comic Sans', size: 500, color: 'red', bold: 'yes' }, h2: { size: 18.2, color: '#C00000', bold: true }, evil: { size: 12 }, normal: { font: 'Arial, Helvetica, sans-serif' } });
    expect(n).toEqual({ h2: { size: 18, color: '#c00000', bold: true }, normal: { font: 'Arial, Helvetica, sans-serif' } });
    expect(_ns(null)).toEqual({});
  });
  it('produces CSS only from validated values', () => {
    const css = _css({ h1: { color: '#123456; } body { display:none', size: 20 } });
    expect(css).toContain('font-size: 20pt');
    expect(css).not.toContain('display');
  });
  it('bakes styles into HTML so every exporter sees them, without disturbing local formatting', () => {
    const html = _apply('<h1>Title</h1><p>Body <strong style="color:#00aa00">green</strong></p><ul><li><p>item</p></li></ul>', { h1: { size: 24, color: '#c00000' }, normal: { font: 'Georgia, "Times New Roman", serif' } });
    expect(html).toMatch(/<h1><span style="font-size: 24pt; color: #c00000">Title<\/span><\/h1>/);
    expect(html).toContain('<strong style="color:#00aa00">green</strong>');
    expect(html.match(/font-family: Georgia/g).length).toBe(2); // body paragraph + list paragraph
    expect(_apply('<p>x</p>', {})).toBe('<p>x</p>');
  });
  it('reaches Word output', async () => {
    const html = _apply('<h1>Title</h1><p>Body</p>', { h1: { size: 24, color: '#c00000' } });
    const { blob } = await _docx(html, { title: 'T', pageSize: 'a4' });
    const buf = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(blob); });
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
    expect(xml).toMatch(/w:color w:val="C00000"/i);
    expect(xml).toMatch(/w:sz w:val="48"/);
  });
});
