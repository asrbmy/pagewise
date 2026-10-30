import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { sanitizeHtml } from '../io/sanitize.js';
import { formatModified } from '../app/format.js';

/**
 * Version history: lists saved snapshots of the document, previews one, and restores it.
 * Snapshots are taken automatically (when a document is opened and every ten minutes of editing)
 * and on request here. They live in this browser only, like the documents themselves.
 */
export default function VersionDialog({ store, docId, title, flush, onRestore, onClose, notify }) {
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await store.listVersions(docId);
      setVersions(list);
      setError('');
      return list;
    } catch (err) {
      setError(err.message);
      setVersions([]);
      return [];
    }
  }, [store, docId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    if (!selected) {
      setPreview(null);
      return undefined;
    }
    store.getVersion(selected).then((v) => alive && setPreview(v ? sanitizeHtml(v.html) : null)).catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [store, selected]);

  const current = useMemo(() => (versions || []).find((v) => v.vid === selected) || null, [versions, selected]);

  const saveVersion = async () => {
    setBusy(true);
    try {
      const html = await flush(); // saves pending edits and returns the current HTML
      const made = await store.addVersion(docId, { html, title, label: label.trim() || 'Saved version' });
      setLabel('');
      const list = await refresh();
      if (made) setSelected(made.vid);
      notify(list.length ? 'Version saved.' : 'Saved.', { kind: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await flush();
      const doc = await store.restoreVersion(docId, current.vid);
      onRestore(doc);
      notify('Version restored. The text you replaced was saved as "Before restore".', { kind: 'success' });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await store.deleteVersion(current.vid);
      setSelected(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Version history"
      size="lg"
      onClose={onClose}
      description="Snapshots are kept in this browser only. They are taken when you open a document, every ten minutes while you edit, and when you save a version here."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn" onClick={remove} disabled={!current || busy}>Delete version</button>
          <button type="button" className="btn btn-primary" onClick={restore} disabled={!current || busy}>Restore this version</button>
        </>
      }
    >
      <form
        className="version-save"
        onSubmit={(e) => {
          e.preventDefault();
          saveVersion();
        }}
      >
        <label htmlFor="version-label" className="sr-only">Name for this version</label>
        <input id="version-label" type="text" value={label} maxLength={80} placeholder="Name this version (optional)" onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="btn" disabled={busy}>Save version now</button>
      </form>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="version-layout">
        <ul className="version-list" aria-label="Saved versions">
          {versions === null && <li className="muted">Loading…</li>}
          {versions && !versions.length && <li className="muted">No versions yet. One is saved automatically as you edit.</li>}
          {(versions || []).map((v) => (
            <li key={v.vid}>
              <button type="button" className={`version-item${v.vid === selected ? ' is-selected' : ''}`} aria-pressed={v.vid === selected} onClick={() => setSelected(v.vid)}>
                <strong>{v.label || formatModified(v.createdAt)}</strong>
                <span>{v.label ? formatModified(v.createdAt) : 'Automatic'} · {v.wordCount.toLocaleString()} word{v.wordCount === 1 ? '' : 's'}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="version-preview" aria-live="polite">
          {!selected && <p className="muted">Select a version to preview it.</p>}
          {selected && preview === null && <p className="muted">Loading preview…</p>}
          {selected && preview !== null && <div className="doc version-doc" dangerouslySetInnerHTML={{ __html: preview }} />}
        </div>
      </div>
    </Dialog>
  );
}
