import { useEffect, useId, useRef, useState } from 'react';
import { normalizeLayout, NUMBER_POSITIONS } from '../editor/layout.js';
import { Dialog } from './Dialog.jsx';
import Icon from './Icon.jsx';
import { fileToImageDataUrl, ACCEPTED_IMAGE_TYPES } from '../editor/images.js';
import { getSearchState } from '../editor/extensions/findReplace.js';
import { PAGE_SIZES } from '../editor/constants.js';
import { MOD } from './Toolbar.jsx';

/** Re-apply the selection captured when the dialog opened, then continue the chain. */
export function atSelection(editor, range) {
  return atRange(editor, range);
}

function atRange(editor, range) {
  const chain = editor.chain().focus();
  if (range) {
    const max = editor.state.doc.content.size;
    chain.setTextSelection({ from: Math.min(range.from, max), to: Math.min(range.to, max) });
  }
  return chain;
}

// ------------------------------------------------------------------ Link

/** Normalise user input into a safe href (http, https, mailto or tel only). */
export function normalizeUrl(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme) return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase()) ? raw : null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return `mailto:${raw}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) || raw.startsWith('localhost')) return `https://${raw}`;
  return null;
}

export function LinkDialog({ editor, range, href: existing = '', onClose }) {
  const hasSelection = !!range && (range.from !== range.to || !!existing);
  const [url, setUrl] = useState(existing);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const urlId = useId();
  const textId = useId();

  const submit = (e) => {
    e.preventDefault();
    const href = normalizeUrl(url);
    if (!href) {
      setError('Enter a web address (https://…), an email address, or a phone number (tel:…).');
      return;
    }
    const chain = atRange(editor, range);
    if (hasSelection) chain.extendMarkRange('link').setLink({ href }).run();
    else {
      chain.insertContent({ type: 'text', text: text.trim() || href, marks: [{ type: 'link', attrs: { href } }] }).run();
    }
    onClose();
  };

  const remove = () => {
    atRange(editor, range).extendMarkRange('link').unsetLink().run();
    onClose();
  };

  return (
    <Dialog title={existing ? 'Edit link' : 'Insert link'} onClose={onClose} size="sm">
      <form onSubmit={submit} noValidate>
        {!hasSelection && (
          <>
            <label className="field-label" htmlFor={textId}>
              Text to display
            </label>
            <input id={textId} className="input" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        <label className="field-label" htmlFor={urlId}>
          Link address
        </label>
        <input
          id={urlId}
          className="input"
          type="text"
          inputMode="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError('');
          }}
          aria-invalid={!!error}
          aria-describedby={error ? `${urlId}-err` : undefined}
          data-autofocus
        />
        {error && (
          <p className="field-error" id={`${urlId}-err`} role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer inline">
          {existing && (
            <button type="button" className="btn btn-danger-text" onClick={remove}>
              Remove link
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Apply
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Image

export function ImageDialog({ editor, range, onClose, notify }) {
  const [tab, setTab] = useState('upload');
  const [alt, setAlt] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileId = useId();
  const altId = useId();
  const urlId = useId();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setBusy(true);
      if (tab === 'upload') {
        if (!file) throw new Error('Choose an image file first.');
        const { src } = await fileToImageDataUrl(file);
        atRange(editor, range).setImage({ src, alt: alt.trim() }).run();
      } else {
        const href = normalizeUrl(url);
        if (!href || !/^https?:/i.test(href)) throw new Error('Enter a full image address starting with https://');
        atRange(editor, range).setImage({ src: href, alt: alt.trim() }).run();
        notify('Linked images load from the web each time the document is opened.', { kind: 'info' });
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Insert image" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Image source">
        {[
          ['upload', 'Upload from device'],
          ['url', 'By web address'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} noValidate>
        {tab === 'upload' ? (
          <>
            <label className="field-label" htmlFor={fileId}>
              Image file
            </label>
            <input id={fileId} className="input" type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={(e) => setFile(e.target.files[0] || null)} data-autofocus />
            <p className="hint">The image is stored inside your document, in this browser. Large images are scaled down to 1600 px.</p>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor={urlId}>
              Image address
            </label>
            <input id={urlId} className="input" type="text" inputMode="url" placeholder="https://example.com/photo.jpg" value={url} onChange={(e) => setUrl(e.target.value)} data-autofocus />
            <p className="hint">
              <Icon name="info" size={14} /> The image will be fetched from that website whenever the document is opened. Upload instead to keep everything private and offline.
            </p>
          </>
        )}
        <label className="field-label" htmlFor={altId}>
          Description (alt text)
        </label>
        <input id={altId} className="input" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image for people using screen readers" />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer inline">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Inserting…' : 'Insert'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Table

export function TableDialog({ editor, range, onClose }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  const rid = useId();
  const cid = useId();
  const clamp = (v, max) => Math.min(max, Math.max(1, Number(v) || 1));
  const submit = (e) => {
    e.preventDefault();
    atRange(editor, range).insertTable({ rows: clamp(rows, 50), cols: clamp(cols, 12), withHeaderRow: header }).run();
    onClose();
  };
  return (
    <Dialog title="Insert table" onClose={onClose} size="sm">
      <form onSubmit={submit}>
        <div className="row">
          <div>
            <label className="field-label" htmlFor={rid}>
              Rows (1–50)
            </label>
            <input id={rid} className="input" type="number" min="1" max="50" value={rows} onChange={(e) => setRows(e.target.value)} data-autofocus />
          </div>
          <div>
            <label className="field-label" htmlFor={cid}>
              Columns (1–12)
            </label>
            <input id={cid} className="input" type="number" min="1" max="12" value={cols} onChange={(e) => setCols(e.target.value)} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> First row is a header
        </label>
        <div className="dialog-footer inline">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Insert table
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Find & replace (floating panel)

export function FindReplacePanel({ editor, onClose, initialTerm = '' }) {
  const [find, setFind] = useState(initialTerm);
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const findRef = useRef(null);
  const findId = useId();
  const replId = useId();

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);

  useEffect(() => {
    editor.commands.setSearch({ term: find, caseSensitive });
  }, [find, caseSensitive, editor]);

  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.commands.clearSearch();
    },
    [editor],
  );

  const st = getSearchState(editor);
  const count = st.matches.length;
  const label = !find ? '' : count ? `${st.index + 1} of ${count}` : 'No results';

  const step = (dir) => editor.commands.stepSearch(dir);

  return (
    <div className="find-panel" role="search" aria-label="Find and replace">
      <div className="find-row">
        <label className="sr-only" htmlFor={findId}>
          Find
        </label>
        <input
          id={findId}
          ref={findRef}
          className="input"
          placeholder="Find"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <span className="find-count" aria-live="polite">
          {label}
        </span>
        <button type="button" className="icon-btn" aria-label="Previous match" onClick={() => step(-1)} disabled={!count}>
          <Icon name="chevronDown" className="flip" />
        </button>
        <button type="button" className="icon-btn" aria-label="Next match" onClick={() => step(1)} disabled={!count}>
          <Icon name="chevronDown" />
        </button>
        <button type="button" className="icon-btn" aria-label="Close find and replace" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="find-row">
        <label className="sr-only" htmlFor={replId}>
          Replace with
        </label>
        <input
          id={replId}
          className="input"
          placeholder="Replace with"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              editor.commands.replaceCurrent(replace);
            } else if (e.key === 'Escape') onClose();
          }}
        />
        <button type="button" className="btn btn-small" onClick={() => editor.commands.replaceCurrent(replace)} disabled={!count}>
          Replace
        </button>
        <button type="button" className="btn btn-small" onClick={() => editor.commands.replaceAll(replace)} disabled={!count}>
          Replace all
        </button>
      </div>
      <label className="check small">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ Page setup

export function PageSetupDialog({ pageSize, layout, onApply, onClose }) {
  const [size, setSize] = useState(pageSize);
  const [lay, setLay] = useState(() => normalizeLayout(layout));
  const [asDefault, setAsDefault] = useState(false);
  return (
    <Dialog
      title="Page setup"
      onClose={onClose}
      size="sm"
      description="Sets the paper size, header, footer and page numbers used for printing and for PDF, Word and web-page export. Margins are 1 inch."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(size, asDefault, normalizeLayout(lay));
          onClose();
        }}
      >
        <fieldset className="radio-group">
          <legend className="field-label">Paper size</legend>
          {Object.entries(PAGE_SIZES).map(([id, p]) => (
            <label key={id} className="check">
              <input type="radio" name="page-size" value={id} checked={size === id} onChange={() => setSize(id)} data-autofocus={size === id ? true : undefined} /> {p.label}
            </label>
          ))}
        </fieldset>
        <label className="field-label" htmlFor="pw-header">Header (top of every page)</label>
        <input id="pw-header" className="input" type="text" value={lay.header} maxLength={150} onChange={(e) => setLay({ ...lay, header: e.target.value })} />
        <label className="field-label" htmlFor="pw-footer">Footer (bottom of every page)</label>
        <input id="pw-footer" className="input" type="text" value={lay.footer} maxLength={150} onChange={(e) => setLay({ ...lay, footer: e.target.value })} />
        <label className="field-label" htmlFor="pw-numbers">Page numbers</label>
        <select id="pw-numbers" className="input" value={lay.pageNumbers} onChange={(e) => setLay({ ...lay, pageNumbers: e.target.value })}>
          {Object.entries(NUMBER_POSITIONS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <p className="hint">The editor shows one continuous sheet, so page numbers appear in print (Chrome, Edge), PDF, Word and web-page export, not on screen.</p>
        <label className="check">
          <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} /> Use this size for new documents
        </label>
        <div className="dialog-footer inline">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            OK
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Word count

export function WordCountDialog({ editor, pages, onClose }) {
  const cc = editor.storage.characterCount;
  const { from, to } = editor.state.selection;
  const selected = from !== to ? editor.state.doc.textBetween(from, to, ' ') : '';
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const allText = editor.getText({ blockSeparator: ' ' });
  const rows = [
    ['Pages (estimated)', pages],
    ['Words', cc.words()],
    ['Characters (with spaces)', cc.characters()],
    ['Characters (without spaces)', allText.replace(/\s/g, '').length],
  ];
  return (
    <Dialog title="Word count" onClose={onClose} size="sm">
      <table className="info-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v.toLocaleString()}</td>
            </tr>
          ))}
          {selected && (
            <>
              <tr>
                <th scope="row">Selected words</th>
                <td>{words(selected).toLocaleString()}</td>
              </tr>
              <tr>
                <th scope="row">Selected characters</th>
                <td>{selected.length.toLocaleString()}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <div className="dialog-footer inline">
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
          Close
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Shortcuts

export function ShortcutsDialog({ onClose }) {
  const groups = [
    ['Document', [['Save now', `${MOD}S`], ['Find and replace', `${MOD}F`], ['Print', `${MOD}P`], ['Insert link', `${MOD}K`], ['Insert page break', `${MOD}Enter`]]],
    ['Text', [['Bold', `${MOD}B`], ['Italic', `${MOD}I`], ['Underline', `${MOD}U`], ['Strikethrough', `${MOD}Shift+X`], ['Clear formatting', `${MOD}\\`], ['Undo', `${MOD}Z`], ['Redo', `${MOD}Shift+Z`]]],
    ['Paragraph', [['Heading 1 – 6', `${MOD}Alt+1 … 6`], ['Normal text', `${MOD}Alt+0`], ['Bulleted list', `${MOD}Shift+8`], ['Numbered list', `${MOD}Shift+7`], ['Block quote', `${MOD}Shift+B`], ['Increase indent', `${MOD}]`], ['Decrease indent', `${MOD}[`]]],
    ['Alignment', [['Left', `${MOD}Shift+L`], ['Center', `${MOD}Shift+E`], ['Right', `${MOD}Shift+R`], ['Justify', `${MOD}Shift+J`]]],
    ['Navigation', [['Move between toolbar buttons', '← → Home End'], ['Open a menu', 'Enter / ↓ on the menu name'], ['Close menu or dialog', 'Esc']]],
  ];
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcuts">
        {groups.map(([title, items]) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {items.map(([name, keys]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <kbd>{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="dialog-footer inline">
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
          Close
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Equation

const SNIPPETS = [
  ['Fraction', '\\frac{a}{b}'],
  ['Square root', '\\sqrt{x}'],
  ['Power', 'x^{2}'],
  ['Subscript', 'x_{i}'],
  ['Sum', '\\sum_{i=1}^{n} x_i'],
  ['Integral', '\\int_{a}^{b} f(x)\\,dx'],
  ['Greek', '\\alpha \\beta \\gamma \\pi'],
  ['Matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
];

export function EquationDialog({ editor, range, initial, editing, onClose }) {
  const [latex, setLatex] = useState(initial?.latex || '');
  const [display, setDisplay] = useState(!!initial?.display);
  const previewRef = useRef(null);
  const areaRef = useRef(null);
  const areaId = useId();

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return undefined;
    if (!latex.trim()) {
      el.textContent = 'The preview appears here.';
      return undefined;
    }
    let alive = true;
    import('../editor/extensions/math.js').then(({ renderMath }) => alive && renderMath(el, latex, display));
    return () => {
      alive = false;
    };
  }, [latex, display]);

  const addSnippet = (text) => {
    const ta = areaRef.current;
    const start = ta ? ta.selectionStart : latex.length;
    const end = ta ? ta.selectionEnd : latex.length;
    setLatex(latex.slice(0, start) + text + latex.slice(end));
    requestAnimationFrame(() => ta && ta.focus());
  };

  const submit = (e) => {
    e.preventDefault();
    if (!latex.trim()) return;
    if (editing) {
      editor.chain().focus().setNodeSelection(range.from).run();
      editor.commands.updateMath({ latex, display });
    } else atRange(editor, range).insertMath({ latex, display }).run();
    onClose();
  };

  return (
    <Dialog title={editing ? 'Edit equation' : 'Insert equation'} size="md" onClose={onClose} description="Write the equation in LaTeX. Word, Markdown and text exports keep it as LaTeX source between dollar signs.">
      <form onSubmit={submit}>
        <label className="field-label" htmlFor={areaId}>LaTeX</label>
        <textarea id={areaId} ref={areaRef} className="input" rows={3} maxLength={2000} value={latex} onChange={(e) => setLatex(e.target.value)} data-autofocus spellCheck={false} placeholder="E = mc^2" />
        <div className="snippet-row" role="group" aria-label="Insert a common form">
          {SNIPPETS.map(([label, text]) => (
            <button key={label} type="button" className="chip" onClick={() => addSnippet(text)}>{label}</button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> Large, centred (display style)
        </label>
        <p className="field-label">Preview</p>
        <div ref={previewRef} className="equation-preview" aria-live="polite" />
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!latex.trim()}>{editing ? 'Update' : 'Insert'}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Footnote & comment

export function FootnoteDialog({ editor, range, initial, editing, onClose }) {
  const [note, setNote] = useState(initial || '');
  const id = useId();
  const submit = (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    if (editing) {
      editor.chain().focus().setNodeSelection(range.from).run();
      editor.commands.updateFootnote(note);
    } else atRange(editor, range).insertFootnote(note).run();
    onClose();
  };
  return (
    <Dialog title={editing ? 'Edit footnote' : 'Insert footnote'} size="md" onClose={onClose} description="The note is numbered automatically and listed under the document.">
      <form onSubmit={submit}>
        <label className="field-label" htmlFor={id}>Note</label>
        <textarea id={id} className="input" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!note.trim()}>{editing ? 'Update' : 'Insert'}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function CommentDialog({ excerpt, onSubmit, onClose }) {
  const [text, setText] = useState('');
  const id = useId();
  return (
    <Dialog title="Add comment" size="md" onClose={onClose} description={excerpt ? `On: “${excerpt.slice(0, 120)}${excerpt.length > 120 ? '…' : ''}”` : undefined}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSubmit(text);
        }}
      >
        <label className="field-label" htmlFor={id}>Comment</label>
        <textarea id={id} className="input" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        <p className="hint">Comments stay in this browser with the document. They are not included in exports.</p>
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Comment</button>
        </div>
      </form>
    </Dialog>
  );
}
