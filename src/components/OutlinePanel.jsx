import { useMemo } from 'react';
import Icon from './Icon.jsx';
import { useT } from '../i18n/index.js';

/** Collect headings (levels 1-6) with their positions. */
export function collectOutline(doc) {
  const items = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableOfContents') return false;
    if (node.type.name === 'heading' && node.textContent.trim()) items.push({ level: node.attrs.level, text: node.textContent.trim(), pos });
    return true;
  });
  return items;
}

/** Side panel listing the document's headings; clicking one jumps to it. */
export default function OutlinePanel({ editor, onClose }) {
  const t = useT();
  const items = useMemo(() => collectOutline(editor.state.doc), [editor.state.doc]);
  const goTo = (pos) => {
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  };
  return (
    <aside className="comments-panel outline-panel" aria-label={t('Outline')}>
      <div className="comments-head">
        <h2>{t('Outline')}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close outline')}>
          <Icon name="x" />
        </button>
      </div>
      {!items.length && <p className="muted pad">{t('Headings you add (Format → Paragraph styles) appear here.')}</p>}
      <ul className="outline-list">
        {items.map((h) => (
          <li key={h.pos} style={{ paddingLeft: `${(h.level - 1) * 14}px` }}>
            <button type="button" className="link-btn outline-item" onClick={() => goTo(h.pos)}>
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
