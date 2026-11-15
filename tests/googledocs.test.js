import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor/extensions/index.js';
import { importFile } from '../src/io/import.js';
import { parseClassRules, unwrapGoogleLink, isGoogleDocsHtml } from '../src/io/googleDocs.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const page = (body, extra = '') => `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type"><style type="text/css">
ol{margin:0;padding:0}
.c1{color:#000000;font-weight:700;text-decoration:none;vertical-align:baseline;font-size:11pt;font-family:"Arial";font-style:normal}
.c2{color:#ff0000;font-weight:400;text-decoration:underline;font-size:11pt;font-family:"Arial";font-style:italic}
.c3{color:#000000;font-weight:400;font-size:11pt;font-family:"Arial"}
.c4{padding-top:0pt;padding-bottom:0pt;line-height:1.15;text-align:center}
.c5{color:#000000;font-weight:400;vertical-align:super;font-size:11pt}
.c6{font-size:20pt;font-weight:700;color:#434343}
.c7{background-color:#ffff00;color:#000000;font-size:11pt}
.title{font-size:26pt}
${extra}</style></head><body class="c9 doc-content">${body}</body></html>`;

describe('Google Docs HTML', () => {
  it('turns the style sheet back into formatting', async () => {
    const html = page(`<p class="c4"><span class="c1">Bold</span><span class="c3"> plain </span><span class="c2">red italic underline</span><span class="c7"> hi</span><span class="c5">2</span></p><h1 class="c8"><span class="c6">Heading</span></h1>`);
    expect(isGoogleDocsHtml(html)).toBe(true);
    const r = await importFile(new File([html], 'g.html', { type: 'text/html' }));
    const ed = new Editor({ extensions: buildExtensions(), content: r.html });
    const out = ed.getHTML();
    ed.destroy();
    expect(out).toMatch(/<strong>Bold<\/strong>/);
    expect(out).toMatch(/<em>[^]*red italic underline/);
    expect(out).toMatch(/<u>[^]*red italic underline/);
    expect(out).toMatch(/text-align: ?center/);
    expect(out).toMatch(/<sup>2<\/sup>/);
    expect(out).toMatch(/<h1[^>]*>(<span[^>]*>)?Heading/);
    expect(out).toMatch(/rgb\(255, 0, 0\)|#ff0000/i);
    expect(out).toMatch(/<mark[^>]*(ffff00|255, 255, 0)/i);
    expect(r.html).not.toMatch(/class="c\d/);
    expect(r.html).not.toMatch(/font-size: ?20pt/); // heading size comes from the heading level
    expect(r.html).not.toMatch(/color: ?#000000/i);
    expect(r.warnings.join(' ')).toMatch(/Google Docs page/);
  });

  it('unwraps Google redirect links and drops unsafe targets', () => {
    expect(unwrapGoogleLink('https://www.google.com/url?q=https://example.com/a?b%3D1&sa=D&ust=1')).toBe('https://example.com/a?b=1');
    expect(unwrapGoogleLink('https://www.google.com/url?q=javascript:alert(1)&sa=D')).toContain('google.com/url');
    expect(unwrapGoogleLink('https://example.org/x')).toBe('https://example.org/x');
  });

  it('parses only plain single-class rules', () => {
    const rules = parseClassRules('.a{font-weight:700;margin:0} ol.b{color:red} .c,.d{color:#111111} @media print{.e{color:red}}');
    expect(rules.get('a')).toEqual({ 'font-weight': '700' });
    expect(rules.has('b')).toBe(false);
    expect(rules.get('c')).toEqual({ color: '#111111' });
    expect(rules.get('d')).toEqual({ color: '#111111' });
  });

  it('turns p.title into a heading and removes comment references', async () => {
    const html = page(`<p class="c3 title"><span class="c3">My title</span></p><p class="c3"><span class="c3">Text</span><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup></p><div><p class="c3"><a href="#cmnt_ref1" id="cmnt1">[a]</a><span class="c3">Someone</span><span class="c3">a comment</span></p></div>`);
    const r = await importFile(new File([html], 'g.html', { type: 'text/html' }));
    expect(r.html).toMatch(/<h1[^>]*>(<span[^>]*>)?My title/);
    expect(r.html).not.toMatch(/\[a\]|a comment|cmnt/);
    expect(r.warnings.join(' ')).toMatch(/1 Google Docs comment was not imported/);
  });

  it('imports the zipped export with its images, and refuses scripts', async () => {
    const zip = new JSZip();
    zip.file('My Doc/My Doc.html', page(`<p class="c3"><span class="c1">Pic</span></p><p class="c3"><img src="images/image1.png" alt="x" style="width: 10px; height: 10px"><img src="images/missing.png"></p><script>alert(1)</script>`));
    zip.file('My Doc/images/image1.png', PNG, { base64: true });
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const r = await importFile(new File([buf], 'My Doc.zip', { type: 'application/zip' }));
    expect(r.html).toMatch(/<img[^>]*src="data:image\/png;base64,/);
    expect(r.html).not.toMatch(/missing\.png|<script/);
    expect(r.warnings.join(' ')).toMatch(/1 image was not imported/);
    expect(r.title).toBe('My Doc');
  });

  it('explains a zip that has no page, and plain html is untouched', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'nothing');
    const buf = await zip.generateAsync({ type: 'uint8array' });
    await expect(importFile(new File([buf], 'x.zip'))).rejects.toThrow(/Web Page \(\.html, zipped\)/);
    const r = await importFile(new File(['<p class="c1">plain</p><style>.c1{font-weight:700}</style>'], 'p.html', { type: 'text/html' }));
    expect(r.html).toContain('plain');
    expect(r.warnings.join(' ')).toMatch(/stylesheets and scripts/);
  });
});
