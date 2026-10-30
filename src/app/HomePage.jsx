import { useCallback, useEffect, useRef, useState } from 'react';
import { store, SORTS } from '../storage/documents.js';
import { exportAndDownload, EXPORTERS } from '../io/export.js';
import { IMPORT_ACCEPT } from '../io/import.js';
import { usePrefs, setPrefs } from '../settings/prefs.js';
import { useDismiss } from '../a11y/focus.js';
import Icon from '../components/Icon.jsx';
import Logo from '../components/Logo.jsx';
import { ConfirmDialog, PromptDialog } from '../components/Dialog.jsx';
import { PrivacyDialog, AboutDialog } from '../components/InfoDialogs.jsx';
import { useToast } from '../components/Toasts.jsx';
import { usePwaState, promptInstall } from '../pwa/register.js';
import { downloadBackup, backupReminderDue } from '../io/backup.js';
import TemplateDialog from '../components/TemplateDialog.jsx';
import { createNewDocument, createFromTemplate, importIntoNewDocument, openDocument } from './actions.js';
import { formatModified, formatFull } from './format.js';

function CardMenu({ doc, onOpen, onRename, onCopy, onDownload, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const item = (label, fn, extra = {}) => (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${extra.danger ? 'danger' : ''}`}
      onClick={() => {
        setOpen(false);
        fn();
      }}
    >
      <span className="menu-label">{label}</span>
    </button>
  );
  return (
    <div className="card-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Actions for ${doc.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={`Actions for ${doc.title}`}>
          {item('Open', onOpen)}
          {item('Rename', onRename)}
          {item('Make a copy', onCopy)}
          <div className="menu-separator" role="separator" />
          <div className="menu-heading" role="presentation">
            Download as
          </div>
          {Object.entries(EXPORTERS).map(([id, ex]) => item(ex.label, () => onDownload(id)))}
          <div className="menu-separator" role="separator" />
          {item('Delete…', onDelete, { danger: true })}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const toast = useToast();
  const prefs = usePrefs();
  const pwa = usePwaState();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    try {
      setError('');
      setDocs(await store.listDocuments({ query: debounced, sort: prefs.sort }));
    } catch (err) {
      setError(err.message || 'Could not read your documents.');
      setDocs([]);
    }
  }, [debounced, prefs.sort]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    document.title = 'Pagewise';
  }, []);

  const guard = async (fn) => {
    try {
      setBusy(true);
      await fn();
    } catch (err) {
      toast(err.message || 'Something went wrong.', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const create = () => guard(async () => openDocument((await createNewDocument()).id));
  const createTemplate = (id) => guard(async () => openDocument((await createFromTemplate(id)).id));

  const importFile = (file) =>
    guard(async () => {
      if (!file) return;
      const { doc, warnings } = await importIntoNewDocument(file);
      toast(`Imported "${doc.title}".`, { kind: warnings.length ? 'warning' : 'success', details: warnings });
      openDocument(doc.id);
    });

  const copy = (doc) =>
    guard(async () => {
      const c = await store.duplicateDocument(doc.id);
      toast(`Created "${c.title}".`, { kind: 'success' });
      await load();
    });

  const download = (doc, format) =>
    guard(async () => {
      const full = await store.getDocument(doc.id);
      const pending = toast(`Preparing ${EXPORTERS[format].label}…`, { duration: 0 });
      try {
        const result = await exportAndDownload(format, full);
        toast(`Downloaded ${result.filename}`, { kind: result.warnings.length ? 'warning' : 'success', details: result.warnings });
      } finally {
        toast.dismiss(pending);
      }
    });

  const remove = (doc) =>
    guard(async () => {
      await store.deleteDocument(doc.id);
      toast(`Deleted "${doc.title}".`, { kind: 'success' });
      setDialog(null);
      await load();
    });

  const rename = (doc, title) =>
    guard(async () => {
      await store.renameDocument(doc.id, title);
      setDialog(null);
      await load();
    });

  const hasQuery = debounced.trim().length > 0;
  const loading = docs === null;

  return (
    <div className="app-shell home-shell">
      <header className="topbar home-top">
        <div className="brand">
          <Logo size={36} />
          <span className="brand-name">Pagewise</span>
        </div>
        <div className="search">
          <Icon name="search" />
          <input type="search" className="search-input" placeholder="Search titles and contents" aria-label="Search documents" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="top-actions">
          {pwa.canInstall && (
            <button type="button" className="btn btn-small" onClick={promptInstall}>
              Install app
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Privacy and storage" title="Privacy and storage" onClick={() => setDialog({ type: 'privacy' })}>
            <Icon name="shield" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Switch theme"
            title="Switch theme"
            onClick={() => setPrefs({ theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark' })}
          >
            <Icon name={document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="icon-btn" aria-label="About Pagewise" title="About" onClick={() => setDialog({ type: 'about' })}>
            <Icon name="info" />
          </button>
        </div>
      </header>

      {!store.persistent && (
        <div className="banner banner-warn" role="alert">
          <Icon name="alert" /> Browser storage is not available here ({store.initError?.message || 'it may be disabled or this is a private window'}). You can still write, but documents will be lost when this tab closes. Download anything you want to keep.
        </div>
      )}
      {store.persistent && docs && backupReminderDue(prefs, docs) && (
        <div className="banner banner-warn" role="note">
          <Icon name="alert" />
          <span>
            {prefs.lastBackupAt ? `Your last backup was ${formatModified(prefs.lastBackupAt)}.` : 'You have not backed up your documents yet.'} Browsers can erase site data, so a backup file is your safety net.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              guard(async () => {
                const n = await downloadBackup(store);
                toast(`Backed up ${n} document${n === 1 ? '' : 's'} to a file in your downloads.`, { kind: 'success' });
              })
            }
          >
            Back up now
          </button>
          <button type="button" className="icon-btn" aria-label="Remind me in a week" title="Remind me in a week" onClick={() => setPrefs({ backupSnoozedUntil: Date.now() + 7 * 24 * 60 * 60 * 1000 })}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {store.persistent && !prefs.dismissedStorageNotice && (
        <div className="banner banner-info" role="note">
          <Icon name="shield" />
          <span>
            Your documents are saved only in this browser and are never uploaded. Clearing site data can erase them, so{' '}
            <button type="button" className="link-btn" onClick={() => setDialog({ type: 'privacy' })}>
              back up regularly
            </button>
            .
          </span>
          <button type="button" className="icon-btn" aria-label="Dismiss this notice" onClick={() => setPrefs({ dismissedStorageNotice: true })}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <main className="home-main" id="main" tabIndex={-1}>
        <div className="home-actions">
          <h1>Your documents</h1>
          <span className="spacer" />
          <label className="sort">
            <span className="sr-only">Sort documents by</span>
            <select className="tb-select" value={prefs.sort} onChange={(e) => setPrefs({ sort: e.target.value })} aria-label="Sort documents">
              {Object.entries(SORTS).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => importRef.current?.click()} disabled={busy}>
            <Icon name="upload" /> Import file
          </button>
          <button type="button" className="btn" onClick={() => setDialog({ type: 'templates' })} disabled={busy}>
            <Icon name="file" /> Templates
          </button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
            <Icon name="filePlus" /> New document
          </button>
          <input
            ref={importRef}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(e) => {
              importFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <div className="banner banner-error" role="alert">
            <Icon name="alert" /> {error}{' '}
            <button type="button" className="link-btn" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {loading && (
          <div className="doc-grid" aria-busy="true" aria-label="Loading documents">
            {[0, 1, 2].map((i) => (
              <div key={i} className="doc-card skeleton" aria-hidden="true" />
            ))}
          </div>
        )}

        {!loading && docs.length === 0 && !error && (
          <div className="empty-state">
            <Logo size={56} />
            {hasQuery ? (
              <>
                <h2>No documents match "{debounced}"</h2>
                <p>Search looks at titles and document text. Try a different word.</p>
                <button type="button" className="btn" onClick={() => setQuery('')}>
                  Clear search
                </button>
              </>
            ) : (
              <>
                <h2>No documents yet</h2>
                <p>Create a document, or import a Word (.docx), Markdown or text file. Everything stays in this browser.</p>
                <div className="button-row center">
                  <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
                    <Icon name="filePlus" /> New document
                  </button>
                  <button type="button" className="btn" onClick={() => importRef.current?.click()} disabled={busy}>
                    <Icon name="upload" /> Import file
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!loading && docs.length > 0 && (
          <ul className="doc-grid" aria-label="Documents">
            {docs.map((d) => (
              <li key={d.id} className="doc-card">
                <button type="button" className="doc-open" onClick={() => openDocument(d.id)}>
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-snippet">{d.snippet || 'Empty document'}</span>
                  <span className="doc-meta" title={`Last modified ${formatFull(d.updatedAt)}`}>
                    <Icon name="file" size={14} /> {formatModified(d.updatedAt)} · {d.wordCount.toLocaleString()} word{d.wordCount === 1 ? '' : 's'}
                  </span>
                </button>
                <CardMenu
                  doc={d}
                  onOpen={() => openDocument(d.id)}
                  onRename={() => setDialog({ type: 'rename', doc: d })}
                  onCopy={() => copy(d)}
                  onDownload={(f) => download(d, f)}
                  onDelete={() => setDialog({ type: 'delete', doc: d })}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="home-footer">Pagewise keeps documents in your browser only. No accounts, no uploads, no tracking.</footer>

      {dialog?.type === 'templates' && <TemplateDialog busy={busy} onPick={createTemplate} onClose={() => setDialog(null)} />}
      {dialog?.type === 'privacy' && <PrivacyDialog onClose={() => setDialog(null)} onRestored={load} />}
      {dialog?.type === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog?.type === 'rename' && <PromptDialog title="Rename document" label="Document title" initialValue={dialog.doc.title} onCancel={() => setDialog(null)} onSubmit={(t) => rename(dialog.doc, t)} />}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Delete this document?"
          message={`"${dialog.doc.title}" will be permanently removed from this browser. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => remove(dialog.doc)}
        />
      )}
    </div>
  );
}
