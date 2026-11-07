import { useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { atSelection } from './EditorDialogs.jsx';
import { collectBookmarks, slugifyBookmark, BOOKMARK_NAME } from '../editor/extensions/bookmark.js';
import { useT } from '../i18n/index.js';

/** Name the paragraph or heading at the cursor so links can point to it; lists and removes bookmarks. */
export default function BookmarkDialog({ editor, range, onClose }) {
  const t = useT();
  const existing = collectBookmarks(editor.state.doc);
  const here = (() => {
    const { $from } = editor.state.selection;
    return $from.depth ? $from.parent.attrs.bookmark || '' : '';
  })();
  const [name, setName] = useState(here);
  const [error, setError] = useState('');
  const [list, setList] = useState(existing);

  const submit = (e) => {
    e.preventDefault();
    const slug = slugifyBookmark(name);
    if (!BOOKMARK_NAME.test(slug)) return setError(t('Use letters or numbers for the bookmark name.'));
    atSelection(editor, range).setBookmark(slug).run();
    onClose();
  };
  const remove = (n) => {
    editor.chain().removeBookmark(n).run();
    setList(collectBookmarks(editor.state.doc));
  };

  return (
    <Dialog title={t('Bookmark')} onClose={onClose} size="sm">
      <form onSubmit={submit}>
        <p className="hint">{t('Names the paragraph or heading where your cursor is. Then use Insert → Link… to link to it.')}</p>
        <label className="field-label" htmlFor="pw-bookmark">{t('Bookmark name')}</label>
        <input id="pw-bookmark" className="input" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} data-autofocus />
        {error && <p className="field-error" role="alert">{error}</p>}
        {list.length > 0 && (
          <>
            <h3 className="field-label">{t('Bookmarks in this document')}</h3>
            <ul className="outline-list">
              {list.map((b) => (
                <li key={b.name}>
                  <span>{b.name}{b.text ? ` — ${b.text}` : ''}</span>{' '}
                  <button type="button" className="link-btn" onClick={() => remove(b.name)} aria-label={`${t('Remove')} ${b.name}`}>{t('Remove')}</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn btn-primary">{t('Set bookmark')}</button>
        </div>
      </form>
    </Dialog>
  );
}
