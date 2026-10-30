import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useDismiss } from '../a11y/focus.js';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  DEFAULT_FONT_SIZE,
  LINE_SPACINGS,
  PARAGRAPH_SPACINGS,
  ZOOM_LEVELS,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  HEADING_STYLES,
} from '../editor/constants.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
export const MOD = isMac ? '⌘' : 'Ctrl+';

/** Icon button that never steals the editor selection when clicked. */
function Btn({ icon, label, shortcut, onClick, active, disabled, children }) {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : !!active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

const Sep = () => <span className="tb-sep" role="separator" aria-orientation="vertical" />;

function Popover({ icon, label, barColor, children, active }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  return (
    <div className="popover-wrap" ref={ref}>
      <button
        type="button"
        className={`tb-btn ${active ? 'active' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="color-icon">
          <Icon name={icon} />
          {barColor !== undefined && <span className="color-bar" style={{ background: barColor || 'transparent' }} />}
        </span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="popover" role="group" aria-label={label}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

function ColorPicker({ icon, label, colors, current, onPick, onReset, resetLabel }) {
  return (
    <Popover icon={icon} label={label} barColor={current || (icon === 'highlight' ? 'transparent' : '#000000')} active={false}>
      {(close) => (
        <>
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${current && current.toLowerCase() === c ? 'selected' : ''}`}
                style={{ background: c }}
                aria-label={`${label}: ${c}`}
                title={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  close();
                }}
              />
            ))}
          </div>
          <label className="custom-color">
            Custom
            <input
              type="color"
              aria-label={`Custom ${label.toLowerCase()}`}
              value={/^#[0-9a-f]{6}$/i.test(current || '') ? current : '#0f766e'}
              onChange={(e) => onPick(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-small"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onReset();
              close();
            }}
          >
            {resetLabel}
          </button>
        </>
      )}
    </Popover>
  );
}

function rgbToHex(c) {
  if (!c) return null;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return c;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

function currentBlockStyle(editor) {
  for (let l = 1; l <= 6; l += 1) if (editor.isActive('heading', { level: l })) return `h${l}`;
  if (editor.isActive('blockquote')) return 'quote';
  return 'p';
}

export default function Toolbar({ editor, zoom, onZoom, onLink, onImage, onTable, onPrint }) {
  const barRef = useRef(null);
  const [sizeDraft, setSizeDraft] = useState(null);

  // Arrow-key navigation between toolbar controls (buttons only; text fields keep arrows).
  useEffect(() => {
    const el = barRef.current;
    if (!el) return undefined;
    const onKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
      const items = Array.from(el.querySelectorAll('button:not([disabled]), select, input[type="text"]'));
      const i = items.indexOf(t);
      if (i === -1) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  if (!editor) return <div className="toolbar" role="toolbar" aria-label="Formatting" />;

  const chain = () => editor.chain().focus();
  const can = (cmd) => editor.can()[cmd]();
  const ts = editor.getAttributes('textStyle');
  const fontSize = ts.fontSize ? parseFloat(ts.fontSize) : DEFAULT_FONT_SIZE;
  const fontFamily = ts.fontFamily || '';
  const known = FONT_FAMILIES.some((f) => (f.value || '') === fontFamily);
  const color = rgbToHex(ts.color);
  const highlight = rgbToHex(editor.getAttributes('highlight').color);
  const para = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph');
  const align = ['center', 'right', 'justify'].find((a) => editor.isActive({ textAlign: a })) || 'left';

  const setSize = (n) => {
    const v = Math.min(400, Math.max(1, Math.round(n)));
    if (v === DEFAULT_FONT_SIZE) chain().unsetFontSize().run();
    else chain().setFontSize(v).run();
    setSizeDraft(null);
  };
  const stepSize = (dir) => {
    const list = FONT_SIZES;
    let next;
    if (dir > 0) next = list.find((s) => s > fontSize) ?? fontSize + 4;
    else next = [...list].reverse().find((s) => s < fontSize) ?? Math.max(1, fontSize - 1);
    setSize(next);
  };

  const applyStyle = (id) => {
    const style = HEADING_STYLES.find((s) => s.id === id);
    if (id === 'p') {
      if (editor.isActive('blockquote')) chain().lift('blockquote').setParagraph().run();
      else chain().setParagraph().run();
    } else if (id === 'quote') chain().toggleBlockquote().run();
    else chain().setHeading({ level: style.level }).run();
  };

  const clearFormatting = () => {
    chain()
      .unsetAllMarks()
      .unsetTextAlign()
      .resetAttributes('paragraph', ['lineHeight', 'spaceBefore', 'spaceAfter', 'indent'])
      .resetAttributes('heading', ['lineHeight', 'spaceBefore', 'spaceAfter', 'indent'])
      .run();
  };

  return (
    <>
    <div className="toolbar" role="toolbar" aria-label="Formatting" ref={barRef}>
      <Btn icon="undo" label="Undo" shortcut={`${MOD}Z`} onClick={() => chain().undo().run()} disabled={!can('undo')} />
      <Btn icon="redo" label="Redo" shortcut={`${MOD}Shift+Z`} onClick={() => chain().redo().run()} disabled={!can('redo')} />
      <Btn icon="print" label="Print" shortcut={`${MOD}P`} onClick={onPrint} />
      <Sep />

      <select className="tb-select tb-zoom" aria-label="Zoom" value={String(zoom)} onChange={(e) => onZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
        {ZOOM_LEVELS.map((z) => (
          <option key={z.value} value={String(z.value)}>
            {z.label}
          </option>
        ))}
      </select>
      <Sep />

      <select className="tb-select tb-style" aria-label="Paragraph style" value={currentBlockStyle(editor)} onChange={(e) => applyStyle(e.target.value)}>
        {HEADING_STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        className="tb-select tb-font"
        aria-label="Font family"
        value={known ? fontFamily : '__custom'}
        onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value || ''}>
            {f.label}
          </option>
        ))}
        {!known && <option value="__custom">{fontFamily.split(',')[0].replace(/["']/g, '') || 'Custom'}</option>}
      </select>
      <Sep />

      <div className="size-control" role="group" aria-label="Font size">
        <button type="button" className="tb-btn" aria-label="Decrease font size" title="Decrease font size" onMouseDown={(e) => e.preventDefault()} onClick={() => stepSize(-1)}>
          <Icon name="minus" size={14} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          className="size-input"
          aria-label="Font size in points"
          list="pw-font-sizes"
          value={sizeDraft ?? String(Math.round(fontSize * 10) / 10)}
          onChange={(e) => setSizeDraft(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={() => sizeDraft !== null && sizeDraft !== '' && setSize(parseFloat(sizeDraft))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (sizeDraft) setSize(parseFloat(sizeDraft));
              editor.commands.focus();
            } else if (e.key === 'Escape') {
              setSizeDraft(null);
              editor.commands.focus();
            }
          }}
        />
        <datalist id="pw-font-sizes">
          {FONT_SIZES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button type="button" className="tb-btn" aria-label="Increase font size" title="Increase font size" onMouseDown={(e) => e.preventDefault()} onClick={() => stepSize(1)}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <Sep />

      <Btn icon="bold" label="Bold" shortcut={`${MOD}B`} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
      <Btn icon="italic" label="Italic" shortcut={`${MOD}I`} active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
      <Btn icon="underline" label="Underline" shortcut={`${MOD}U`} active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
      <Btn icon="strike" label="Strikethrough" shortcut={`${MOD}Shift+X`} active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
      <ColorPicker
        icon="textColor"
        label="Text color"
        colors={TEXT_COLORS}
        current={color}
        onPick={(c) => chain().setColor(c).run()}
        onReset={() => chain().unsetColor().run()}
        resetLabel="Default color"
      />
      <ColorPicker
        icon="highlight"
        label="Highlight color"
        colors={HIGHLIGHT_COLORS}
        current={highlight}
        onPick={(c) => chain().setHighlight({ color: c }).run()}
        onReset={() => chain().unsetHighlight().run()}
        resetLabel="No highlight"
      />
      <Sep />

      <Btn icon="link" label="Insert link" shortcut={`${MOD}K`} active={editor.isActive('link')} onClick={onLink} />
      <Btn icon="image" label="Insert image" onClick={onImage} />
      <Btn icon="table" label="Insert table" onClick={onTable} />
      <Sep />

      <Btn icon="alignLeft" label="Align left" shortcut={`${MOD}Shift+L`} active={align === 'left'} onClick={() => chain().setTextAlign('left').run()} />
      <Btn icon="alignCenter" label="Align center" shortcut={`${MOD}Shift+E`} active={align === 'center'} onClick={() => chain().setTextAlign('center').run()} />
      <Btn icon="alignRight" label="Align right" shortcut={`${MOD}Shift+R`} active={align === 'right'} onClick={() => chain().setTextAlign('right').run()} />
      <Btn icon="alignJustify" label="Justify" shortcut={`${MOD}Shift+J`} active={align === 'justify'} onClick={() => chain().setTextAlign('justify').run()} />
      <Sep />

      <Popover icon="lineSpacing" label="Line and paragraph spacing">
        {(close) => (
          <div className="popover-list">
            <div className="popover-heading">Line spacing</div>
            {LINE_SPACINGS.map((l) => (
              <button
                key={l.value}
                type="button"
                className="popover-item"
                role="menuitemradio"
                aria-checked={para.lineHeight === l.value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  chain().setLineHeight(l.value).run();
                  close();
                }}
              >
                <span className="menu-check">{para.lineHeight === l.value ? '✓' : ''}</span>
                {l.label}
              </button>
            ))}
            <div className="popover-heading">Paragraph spacing</div>
            {PARAGRAPH_SPACINGS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="popover-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  chain().setParagraphSpacing({ before: p.before, after: p.after }).run();
                  close();
                }}
              >
                <span className="menu-check" />
                {p.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Btn icon="list" label="Bulleted list" shortcut={`${MOD}Shift+8`} active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
      <Btn icon="listOrdered" label="Numbered list" shortcut={`${MOD}Shift+7`} active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
      <Btn icon="outdent" label="Decrease indent" shortcut={`${MOD}[`} onClick={() => chain().outdent().run()} />
      <Btn icon="indent" label="Increase indent" shortcut={`${MOD}]`} onClick={() => chain().indent().run()} />
      <Sep />
      <Btn icon="clearFormat" label="Clear formatting" shortcut={`${MOD}\\`} onClick={clearFormatting} />
    </div>

      {editor.isActive('table') && (
        <div className="table-tools" role="group" aria-label="Table tools">
          <span className="table-tools-label">Table</span>
          <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowBefore().run()}>
            Row above
          </button>
          <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()}>
            Row below
          </button>
          <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnBefore().run()}>
            Column left
          </button>
          <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()}>
            Column right
          </button>
          <button type="button" className="btn btn-small" disabled={!can('deleteRow')} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()}>
            Delete row
          </button>
          <button type="button" className="btn btn-small" disabled={!can('deleteColumn')} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()}>
            Delete column
          </button>
          <button type="button" className="btn btn-small" disabled={!can('mergeCells')} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().mergeCells().run()}>
            Merge cells
          </button>
          <button type="button" className="btn btn-small" disabled={!can('splitCell')} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().splitCell().run()}>
            Split cell
          </button>
          <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleHeaderRow().run()}>
            Header row
          </button>
          <button type="button" className="btn btn-small btn-danger-text" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteTable().run()}>
            Delete table
          </button>
        </div>
      )}
    </>
  );
}
