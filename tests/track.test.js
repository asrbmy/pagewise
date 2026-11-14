import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor/extensions/index.js';
import { collectChanges } from '../src/editor/extensions/trackChanges.js';

let editor;
const make = (c) => (editor = new Editor({ extensions: buildExtensions(), content: c }));
afterEach(() => editor && editor.destroy());
const key = (k) => editor.view.someProp('handleKeyDown', (f) => f(editor.view, { key: k, ctrlKey: false, altKey: false, metaKey: false }));
const type = (t) => { const { from, to } = editor.state.selection; return editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, t)); };

describe('track changes', () => {
  it('records typing as an insertion and merges runs', () => {
    make('<p>Hello</p>');
    editor.commands.setSuggesting(true);
    editor.commands.setTextSelection(6);
    type('!'); type('?');
    expect(editor.getHTML()).toMatch(/<p>Hello<ins data-change-id="[^"]+" data-change-time="\d+" class="tc-ins">!\?<\/ins><\/p>/);
    expect(collectChanges(editor.state.doc)).toHaveLength(1);
  });

  it('marks deletions instead of removing text, and steps over struck text', () => {
    make('<p>abcd</p>');
    editor.commands.setSuggesting(true);
    editor.commands.setTextSelection(5);
    key('Backspace'); key('Backspace');
    expect(editor.getText()).toBe('abcd');
    const ch = collectChanges(editor.state.doc);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ kind: 'deletion', text: 'cd' });
    expect(editor.state.selection.from).toBe(3);
  });

  it('deleting your own suggestion removes it for real', () => {
    make('<p>ab</p>');
    editor.commands.setSuggesting(true);
    editor.commands.setTextSelection(3);
    type('X');
    key('Backspace');
    expect(editor.getHTML()).toBe('<p>ab</p>');
  });

  it('replacing a selection strikes the old text and inserts the new', () => {
    make('<p>one two</p>');
    editor.commands.setSuggesting(true);
    editor.commands.setTextSelection({ from: 5, to: 8 });
    type('2');
    const kinds = collectChanges(editor.state.doc).map((c) => `${c.kind}:${c.text}`);
    expect(kinds).toEqual(['deletion:two', 'insertion:2']);
  });

  it('accept and reject', () => {
    make('<p>abcd</p>');
    editor.commands.setSuggesting(true);
    editor.commands.setTextSelection(5);
    key('Backspace');
    type('Z'); // typed inside the struck gap's edge
    editor.commands.setSuggesting(false);
    const html = editor.getHTML();
    editor.commands.resolveAllChanges(false); // reject all
    expect(editor.getText()).toBe('abcd');
    editor.commands.setContent(html);
    editor.commands.resolveAllChanges(true); // accept all
    expect(editor.getText()).toBe('abcZ');
    expect(collectChanges(editor.state.doc)).toHaveLength(0);
  });

  it('plain <del> stays strikethrough; tracked <del> needs a valid id', () => {
    make('<p><del>old</del> <del data-change-id="x1" data-change-time="1700000000000">gone</del> <del data-change-id="bad id">odd</del></p>');
    const ch = collectChanges(editor.state.doc);
    expect(ch.map((c) => c.id)).toEqual(['x1']);
    expect(editor.getHTML()).toContain('<s>old</s>');
  });

  it('is off by default and typing is untouched', () => {
    make('<p>a</p>');
    expect(type('b')).toBeFalsy();
  });

  it('exports tracked changes to Word, and accepts them for other formats', async () => {
    const html = '<p>keep <ins data-change-id="a1" data-change-time="1700000000000">new</ins> <del data-change-id="b1" data-change-time="1700000000000">old</del></p>';
    const { htmlToDocxBlob } = await import('../src/io/docx.js');
    const JSZip = (await import('jszip')).default;
    const { blob } = await htmlToDocxBlob(html, {});
    const x = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml').async('string');
    expect(x).toMatch(/<w:ins [^>]*w:author="Pagewise"/);
    expect(x).toMatch(/<w:del [^>]*w:author="Pagewise"/);
    expect(x).toContain('<w:delText');
    const { prepareForExport } = await import('../src/io/prepare.js');
    expect(prepareForExport(html)).toBe('<p>keep new </p>');
    expect(prepareForExport(html, { keepTracked: true })).toBe(html);
  });
});
