import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { importFile } from '../src/io/import.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

async function docxWith(body, comments, ext = '') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8"?><w:comments ${NS}>${comments}</w:comments>`);
  if (ext) zip.file('word/commentsExtended.xml', `<?xml version="1.0" encoding="UTF-8"?><w15:commentsEx ${NS}>${ext}</w15:commentsEx>`);
  const buf = await zip.generateAsync({ type: 'uint8array' });
  return new File([buf], 'c.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const cm = (id, author, text, para = '00000001') => `<w:comment w:id="${id}" w:author="${author}" w:date="2024-03-05T10:00:00Z"><w:p w14:paraId="${para}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;

describe('Word comment import', () => {
  it('anchors a comment to its range and carries author, date and resolved state', async () => {
    const body = `<w:p>${run('Start ')}<w:commentRangeStart w:id="0"/>${run('the anchored words')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${run(' end')}</w:p>`;
    const file = await docxWith(body, cm(0, 'Ann', 'Please check', 'AAAA0001'), '<w15:commentEx w15:paraId="AAAA0001" w15:done="1"/>');
    const r = await importFile(file);
    expect(r.html).toMatch(/<span data-comment-id="[A-Za-z0-9_-]+">the anchored words<\/span>/);
    expect(r.html).not.toMatch(/pwc/);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ text: 'Ann: Please check', resolved: true, createdAt: Date.parse('2024-03-05T10:00:00Z') });
    expect(r.html).toContain(`data-comment-id="${r.comments[0].id}"`);
    expect(r.warnings.join(' ')).toMatch(/1 Word comment imported/);
  });

  it('handles overlapping ranges and ranges that cross paragraphs', async () => {
    const body = `<w:p>${run('a ')}<w:commentRangeStart w:id="0"/>${run('one ')}<w:commentRangeStart w:id="1"/>${run('two')}<w:commentRangeEnd w:id="1"/></w:p><w:p>${run('three')}<w:commentRangeEnd w:id="0"/>${run(' z')}</w:p>`;
    const r = await importFile(await docxWith(body, cm(0, 'A', 'outer') + cm(1, 'B', 'inner')));
    expect(r.comments.map((c) => c.text).sort()).toEqual(['A: outer', 'B: inner']);
    const outer = r.comments.find((c) => c.text.endsWith('outer')).id;
    const inner = r.comments.find((c) => c.text.endsWith('inner')).id;
    const dom = new DOMParser().parseFromString(r.html, 'text/html');
    const covered = (id) => [...dom.querySelectorAll(`[data-comment-id="${id}"]`)].map((e) => e.textContent).join('|');
    expect(covered(outer)).toBe('one |two|three');
    expect(covered(inner)).toBe('two');
  });

  it('anchors a point comment (empty range) to the word before it', async () => {
    const body = `<w:p>${run('first second ')}<w:commentRangeStart w:id="0"/><w:commentRangeEnd w:id="0"/>${run('third')}</w:p>`;
    const r = await importFile(await docxWith(body, cm(0, 'A', 'note')));
    expect(r.comments).toHaveLength(1);
    expect(r.html).toMatch(/<span data-comment-id="[^"]+">second <\/span>/);
  });

  it('ignores comments with unknown ids and never leaves markers behind', async () => {
    const body = `<w:p>${run('hello ')}<w:commentRangeStart w:id="9"/>${run('x')}<w:commentRangeEnd w:id="9"/></w:p>`;
    const r = await importFile(await docxWith(body, cm(0, 'A', 'unused')));
    expect(r.comments).toHaveLength(0);
    expect(r.html).not.toMatch(/[]/);
    expect(r.warnings.join(' ')).toMatch(/could not be tied to text/);
  });

  it('a document without comments imports as before', async () => {
    const r = await importFile(await docxWith(`<w:p>${run('plain')}</w:p>`, ''));
    expect(r.html).toContain('plain');
    expect(r.comments).toEqual([]);
  });
});

describe('Word comment import: point comments from LibreOffice-style files', () => {
  it('uses the comment reference when there is no range', async () => {
    const body = `<w:p>${run('alpha beta ')}<w:r><w:commentReference w:id="0"/></w:r>${run('gamma')}</w:p>`;
    const r = await importFile(await docxWith(body, cm(0, 'A', 'point')));
    expect(r.comments).toHaveLength(1);
    expect(r.html).toMatch(/<span data-comment-id="[^"]+">beta <\/span>/);
  });
});
