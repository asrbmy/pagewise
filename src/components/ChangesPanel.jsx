import { useMemo } from 'react';
import Icon from './Icon.jsx';
import { collectChanges } from '../editor/extensions/trackChanges.js';
import { formatModified } from '../app/format.js';
import { useT } from '../i18n/index.js';

/** Side panel listing pending tracked changes, with accept / reject for each. */
export default function ChangesPanel({ editor, suggesting, onToggleSuggesting, onClose }) {
  const t = useT();
  const changes = useMemo(() => collectChanges(editor.state.doc), [editor.state.doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (c) => {
    let range = null;
    editor.state.doc.descendants((node, pos) => {
      if (range || !node.isInline) return !range;
      if (node.marks.some((m) => m.attrs?.id === c.id && (m.type.name === 'insertion' || m.type.name === 'deletion'))) {
        range = { from: pos, to: pos + node.nodeSize };
      }
      return !range;
    });
    if (range) editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  };

  return (
    <aside className="comments-panel changes-panel" aria-label={t('Tracked changes')}>
      <div className="comments-head">
        <h2>{t('Tracked changes')}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <Icon name="x" />
        </button>
      </div>
      <label className="check pad">
        <input type="checkbox" checked={suggesting} onChange={(e) => onToggleSuggesting(e.target.checked)} /> {t('Suggesting mode')}
      </label>
      {changes.length > 0 && (
        <div className="comment-actions pad">
          <button type="button" className="link-btn" onClick={() => editor.chain().focus().resolveAllChanges(true).run()}>{t('Accept all')}</button>
          <button type="button" className="link-btn danger" onClick={() => editor.chain().focus().resolveAllChanges(false).run()}>{t('Reject all')}</button>
        </div>
      )}
      {!changes.length && <p className="muted pad">{t('No tracked changes. Turn on Suggesting mode, then type or delete: each edit is recorded so you can accept or reject it.')}</p>}
      <ul className="comments-list">
        {changes.map((c) => (
          <li key={c.id} className="comment-card">
            <p className="comment-quote">
              <strong>{c.kind === 'insertion' ? t('Added') : t('Deleted')}:</strong>{' '}
              <span className={c.kind === 'insertion' ? 'tc-ins' : 'tc-del'}>“{c.text.slice(0, 90)}{c.text.length > 90 ? '…' : ''}”</span>
            </p>
            {c.time && <p className="comment-meta">{formatModified(c.time)}</p>}
            <div className="comment-actions">
              <button type="button" className="link-btn" onClick={() => goTo(c)}>{t('Show in text')}</button>
              <button type="button" className="link-btn" onClick={() => editor.chain().focus().resolveChange(c.id, true).run()}>{t('Accept')}</button>
              <button type="button" className="link-btn danger" onClick={() => editor.chain().focus().resolveChange(c.id, false).run()}>{t('Reject')}</button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
