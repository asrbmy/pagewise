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
