import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor/extensions/index.js';
import { getSearchState } from '../src/editor/extensions/findReplace.js';

let editor;
function make(content = '<p>Hello world</p>') {
  editor = new Editor({ extensions: buildExtensions(), content });
  return editor;
}
afterEach(() => editor && editor.destroy());

describe('editor formatting survives a save/reload round trip', () => {
  it('keeps bold, italic, underline, strike, colour, highlight, font and size', () => {
    make('<p>plain</p>');
    editor.commands.selectAll();
    editor
      .chain()
      .toggleBold()
      .toggleItalic()
      .toggleUnderline()
      .toggleStrike()
      .setColor('#b91c1c')
      .setHighlight({ color: '#fef08a' })
      .setFontFamily('Georgia, serif')
      .setFontSize(18)
      .run();
    const html = editor.getHTML();
    const reloaded = new Editor({ extensions: buildExtensions(), content: html });
    expect(reloaded.getHTML()).toBe(html);
    for (const needle of ['<strong>', '<em>', '<u>', '<s>', 'font-size: 18pt', 'Georgia', '<mark']) {
      expect(html).toContain(needle);
    }
    // jsdom (like browsers) may normalise #b91c1c to rgb(185, 28, 28)
    expect(html).toMatch(/color: (#b91c1c|rgb\(185, 28, 28\))/);
    reloaded.destroy();
  });

  it('supports headings, lists, blockquote and alignment', () => {
    make('<p>one</p>');
    editor.chain().selectAll().setHeading({ level: 2 }).setTextAlign('center').run();
    expect(editor.getHTML()).toMatch(/<h2[^>]*text-align: center/);
    editor.commands.setContent('<p>item</p>');
    editor.commands.setTextSelection(2);
    editor.commands.toggleBulletList();
    expect(editor.getHTML()).toContain('<ul>');
    editor.commands.toggleOrderedList(); // switches bullet -> numbered
    expect(editor.getHTML()).toContain('<ol>');
    expect(editor.getHTML()).not.toContain('<ul>');
    editor.commands.toggleOrderedList(); // toggles off
    expect(editor.getHTML()).toBe('<p>item</p>');
    editor.commands.toggleBlockquote();
    expect(editor.getHTML()).toContain('<blockquote>');
  });

  it('applies line height, paragraph spacing and indentation as block attributes', () => {
    make('<p>spaced</p>');
    editor.commands.selectAll();
    editor.commands.setLineHeight('1.5');
    editor.commands.setParagraphSpacing({ before: 6, after: 12 });
    editor.commands.indent();
    editor.commands.indent();
    const html = editor.getHTML();
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('margin-top: 6pt');
    expect(html).toContain('margin-bottom: 12pt');
    expect(html).toContain('data-indent="2"');
    editor.commands.outdent();
    expect(editor.getHTML()).toContain('data-indent="1"');
    const again = new Editor({ extensions: buildExtensions(), content: html });
    expect(again.getHTML()).toBe(html);
    again.destroy();
  });

  it('inserts links, tables with editable cells, horizontal rules and page breaks', () => {
    make('<p>link me</p>');
    editor.chain().selectAll().setLink({ href: 'https://example.com' }).run();
    expect(editor.getHTML()).toContain('href="https://example.com"');

    editor.chain().focus('end').insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run();
    let html = editor.getHTML();
    expect(html).toContain('<table');
    expect((html.match(/<th/g) || []).length).toBe(3);
    expect((html.match(/<td/g) || []).length).toBe(3);

    editor.commands.insertContent('cell text');
    expect(editor.getHTML()).toContain('cell text');
    editor.commands.addRowAfter();
    editor.commands.addColumnAfter();
    html = editor.getHTML();
    expect((html.match(/<tr/g) || []).length).toBe(3);

    editor.chain().focus('end').setHorizontalRule().setPageBreak().run();
    html = editor.getHTML();
    expect(html).toContain('<hr');
    expect(html).toContain('data-type="page-break"');
    const again = new Editor({ extensions: buildExtensions(), content: html });
    expect(again.getHTML()).toContain('data-type="page-break"');
    again.destroy();
  });

  it('Ctrl+Enter inserts a page break (not a hard line break)', () => {
    make('<p>before</p>');
    editor.commands.focus('end');
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    // typing right after the shortcut must land after the break, not replace it
    editor.commands.insertContent('after');
    const html = editor.getHTML();
    expect(html).toMatch(/<p>before<\/p><div[^>]*data-type="page-break"[^>]*><\/div><p>after<\/p>/);
    expect(html).not.toContain('<br');
  });

  it('undo and redo work', () => {
    make('<p>abc</p>');
    editor.commands.selectAll();
    editor.commands.toggleBold();
    expect(editor.getHTML()).toContain('<strong>');
    editor.commands.undo();
    expect(editor.getHTML()).not.toContain('<strong>');
    editor.commands.redo();
    expect(editor.getHTML()).toContain('<strong>');
  });

  it('counts words and characters', () => {
    make('<p>one two three</p><p>four</p>');
    expect(editor.storage.characterCount.words()).toBe(4);
    expect(editor.storage.characterCount.characters()).toBeGreaterThan(10);
  });
});

describe('find and replace', () => {
  it('finds matches across formatting boundaries, case-insensitively', () => {
    make('<p>Hello <strong>wor</strong>ld, hello again</p>');
    editor.commands.setSearch({ term: 'hello' });
    expect(getSearchState(editor).matches).toHaveLength(2);
    editor.commands.setSearch({ term: 'world' });
    expect(getSearchState(editor).matches).toHaveLength(1);
    editor.commands.setSearch({ term: 'hello', caseSensitive: true });
    expect(getSearchState(editor).matches).toHaveLength(1);
  });

  it('steps through matches with wrap-around and selects them', () => {
    make('<p>a b a b a</p>');
    editor.commands.setSearch({ term: 'a' });
    const st = () => getSearchState(editor);
    expect(st().matches).toHaveLength(3);
    expect(st().index).toBe(0);
    editor.commands.stepSearch(1);
    expect(st().index).toBe(1);
    editor.commands.stepSearch(1);
    editor.commands.stepSearch(1);
    expect(st().index).toBe(0);
    editor.commands.stepSearch(-1);
    expect(st().index).toBe(2);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('a');
  });

  it('replaces the current match and all matches, keeping formatting', () => {
    make('<p>cat <strong>cat</strong> cat</p>');
    editor.commands.setSearch({ term: 'cat' });
    editor.commands.replaceCurrent('dog');
    expect(editor.getText()).toBe('dog cat cat');
    editor.commands.replaceAll('bird');
    expect(editor.getText()).toBe('dog bird bird');
    expect(editor.getHTML()).toContain('<strong>bird</strong>');
  });

  it('clears highlights', () => {
    make('<p>x x</p>');
    editor.commands.setSearch({ term: 'x' });
    editor.commands.clearSearch();
    expect(getSearchState(editor).matches).toHaveLength(0);
  });
});

describe('table of contents', () => {
  it('builds from headings, round-trips, and updates in place', () => {
    make('<h1>Intro</h1><p>a</p><h2>Details</h2><p>b</p><h4>Skipped level</h4>');
    editor.commands.focus('end');
    editor.commands.insertTableOfContents();
    let html = editor.getHTML();
    expect(html).toContain('data-type="toc"');
    expect(html).toContain('Table of contents');
    expect(html).toMatch(/<p[^>]*>Intro<\/p>/);
    expect(html).toMatch(/data-indent="1"[^>]*>Details<\/p>/);
    expect(html).not.toMatch(/>Skipped level<\/p>.*data-type="toc"/s);

    const again = new Editor({ extensions: buildExtensions(), content: html });
    expect(again.getHTML()).toBe(html);
    again.destroy();

    editor.commands.setTextSelection(6);
    editor.commands.insertContent(' renamed');
    editor.commands.updateTableOfContents();
    html = editor.getHTML();
    expect(html).toMatch(/<p[^>]*>Intro renamed<\/p>/);
    expect((html.match(/data-type="toc"/g) || []).length).toBe(1);
  });

  it('says what to do when there are no headings, and update is a no-op without a TOC', () => {
    make('<p>plain</p>');
    expect(editor.commands.updateTableOfContents()).toBe(false);
    editor.commands.focus('end');
    editor.commands.insertTableOfContents();
    expect(editor.getText()).toContain('Add headings');
  });
});

describe('pagination planning', () => {
  it('moves a block that would straddle a page edge to the next page', async () => {
    const { planSpacers } = await import('../src/editor/extensions/pagination.js');
    const geo = { pageHeight: 1000, margin: 100 }; // content area 100..900 on page 1, 1100..1900 on page 2
    // a 300px block starting at 800 would end at 1100 (past 900): push to 1100
    const out = planSpacers([{ top: 100, height: 600, spacer: 0 }, { top: 710, height: 300, spacer: 0 }], geo);
    expect(out).toEqual([0, 390]);
  });
  it('leaves blocks that fit, and blocks taller than a page, alone', async () => {
    const { planSpacers } = await import('../src/editor/extensions/pagination.js');
    const geo = { pageHeight: 1000, margin: 100 };
    expect(planSpacers([{ top: 100, height: 700, spacer: 0 }, { top: 800, height: 50, spacer: 0 }], geo)).toEqual([0, 0]);
    expect(planSpacers([{ top: 500, height: 2000, spacer: 0 }], geo)).toEqual([0]);
  });
  it('is stable when run again on its own output', async () => {
    const { planSpacers } = await import('../src/editor/extensions/pagination.js');
    const geo = { pageHeight: 1000, margin: 100 };
    const first = planSpacers([{ top: 100, height: 600, spacer: 0 }, { top: 710, height: 300, spacer: 0 }], geo);
    const again = planSpacers([{ top: 100, height: 600, spacer: 0 }, { top: 710 + first[1], height: 300, spacer: first[1] }], geo);
    expect(again).toEqual(first);
  });
  it('starts the block after a hard page break on the next page', async () => {
    const { planSpacers } = await import('../src/editor/extensions/pagination.js');
    const geo = { pageHeight: 1000, margin: 100 };
    expect(planSpacers([{ top: 100, height: 200, spacer: 0, isBreak: true }, { top: 310, height: 40, spacer: 0 }], geo)).toEqual([0, 790]);
  });
});

describe('equations', () => {
  it('stores LaTeX in the document, round-trips, and reads as source in text exports', async () => {
    make('<p>Energy: </p>');
    editor.commands.focus('end');
    expect(editor.commands.insertMath({ latex: 'E = mc^2', display: false })).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('data-type="math"');
    expect(html).toContain('data-latex="E = mc^2"');
    expect(html).toContain('>$E = mc^2$<');
    const again = new Editor({ extensions: buildExtensions(), content: html });
    expect(again.getHTML()).toBe(html);
    again.destroy();
    const { htmlToMarkdown } = await import('../src/io/export.js');
    expect(await htmlToMarkdown('<p><span data-type="math" data-latex="x_i^2 * y" data-display="false">$x_i^2 * y$</span></p>')).toContain('$x_i^2 * y$');
  });

  it('updates a selected equation, and refuses empty LaTeX', () => {
    make('<p>a <span data-type="math" data-latex="x" data-display="false">$x$</span> b</p>');
    expect(editor.commands.insertMath({ latex: '   ' })).toBe(false);
    editor.commands.setNodeSelection(3);
    expect(editor.commands.updateMath({ latex: 'y^2', display: true })).toBe(true);
    expect(editor.getHTML()).toContain('data-latex="y^2"');
    expect(editor.getHTML()).toContain('data-display="true"');
    editor.commands.setTextSelection(1);
    expect(editor.commands.updateMath({ latex: 'z' })).toBe(false);
  });

  it('keeps equations through the sanitizer and caps their length', async () => {
    const { sanitizeHtml } = await import('../src/io/sanitize.js');
    const out = sanitizeHtml('<p><span data-type="math" data-latex="\\frac{a}{b}" data-display="false">$x$</span></p>');
    expect(out).toContain('data-latex');
    make(`<p><span data-type="math" data-latex="${'x'.repeat(5000)}">$x$</span></p>`);
    expect(editor.getHTML().match(/data-latex="(x*)"/)[1].length).toBe(2000);
  });
});

describe('footnotes', () => {
  it('number in document order and round-trip', async () => {
    const { collectFootnotes } = await import('../src/editor/extensions/footnote.js');
    make('<p>One</p><p>Two</p>');
    editor.commands.focus('end');
    editor.commands.insertFootnote('second note');
    editor.commands.setTextSelection(4);
    editor.commands.insertFootnote('first note');
    const notes = collectFootnotes(editor.state.doc);
    expect(notes.map((n) => [n.number, n.note])).toEqual([[1, 'first note'], [2, 'second note']]);
    const html = editor.getHTML();
    expect(html).toContain('data-type="footnote"');
    const again = new Editor({ extensions: buildExtensions(), content: html });
    expect(again.getHTML()).toBe(html);
    again.destroy();
    expect(editor.commands.insertFootnote('   ')).toBe(false);
  });

  it('edits the selected footnote only', () => {
    make('<p>a <span data-type="footnote" data-note="old"></span> b</p>');
    editor.commands.setNodeSelection(3);
    expect(editor.commands.updateFootnote('new text')).toBe(true);
    expect(editor.getHTML()).toContain('data-note="new text"');
    editor.commands.setTextSelection(1);
    expect(editor.commands.updateFootnote('x')).toBe(false);
  });
});

describe('comments', () => {
  it('anchors to selected text, allows overlap, and can be removed', async () => {
    const { collectComments } = await import('../src/editor/extensions/comment.js');
    make('<p>Hello brave new world</p>');
    editor.commands.setTextSelection({ from: 1, to: 12 });
    expect(editor.commands.addCommentMark('c1')).toBe(true);
    editor.commands.setTextSelection({ from: 7, to: 16 });
    editor.commands.addCommentMark('c2');
    const found = collectComments(editor.state.doc);
    expect(found.get('c1')).toBe('Hello brave');
    expect(found.get('c2')).toBe('brave new');
    expect(editor.getHTML()).toContain('data-comment-id="c1"');
    expect(editor.commands.removeCommentMark('c1')).toBe(true);
    expect(editor.getHTML()).not.toContain('c1');
    expect(editor.getHTML()).toContain('data-comment-id="c2"');
    editor.commands.setTextSelection(2);
    expect(editor.commands.addCommentMark('c3')).toBe(false); // needs a selection
    expect(editor.commands.addCommentMark('bad id!')).toBe(false);
  });

  it('ignores marks with unsafe ids when loading', () => {
    make('<p><span data-comment-id="x&quot; onmouseover=&quot;1">text</span></p>');
    expect(editor.getHTML()).not.toContain('onmouseover');
  });
});
