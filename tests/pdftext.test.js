import { describe, it, expect } from 'vitest';
import { buildTextPdf } from '../src/io/pdfText.js';

const bytesOf = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(Buffer.from(r.result)); r.readAsArrayBuffer(blob); });

describe('text PDF', () => {
  it('produces a small multi-page PDF from rich content', async () => {
    const para = '<p>' + 'Lorem ipsum dolor sit amet, <strong>consectetur</strong> <em>adipiscing</em> elit. '.repeat(30) + '</p>';
    const html = `<h1>Title</h1>${para.repeat(6)}<ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol><table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table><hr><blockquote><p>quoted</p></blockquote><p><a href="https://example.com/">link</a></p>`;
    const { blob, pages, warnings } = await buildTextPdf({ title: 'T', html, pageSize: 'a4', layout: { header: 'HDR', footer: 'FTR', pageNumbers: 'center' } });
    const buf = await bytesOf(blob);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(blob.size).toBeLessThan(80_000);
    expect(warnings).toEqual([]);
  });
  it('warns about CJK and survives hostile input', async () => {
    const { warnings, blob } = await buildTextPdf({ title: 'T', html: '<p>日本語</p><script>alert(1)</script><img src="javascript:x">' });
    expect(warnings.join(' ')).toMatch(/Chinese, Japanese and Korean/);
    expect(blob.size).toBeGreaterThan(500);
  });
  it('handles an empty document and a very long word', async () => {
    const empty = await buildTextPdf({ title: 'T', html: '' });
    expect(empty.pages).toBe(1);
    const long = await buildTextPdf({ title: 'T', html: `<p>${'x'.repeat(400)}</p>` });
    expect(long.pages).toBe(1);
  });
});
