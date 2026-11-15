import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import Logo from './Logo.jsx';
import { store, requestPersistence, storageEstimate } from '../storage/documents.js';
import { downloadBackup, restoreBackup } from '../io/backup.js';
import { formatBytes } from '../app/format.js';
import { usePwaState } from '../pwa/register.js';
import { useToast } from './Toasts.jsx';
import { useT } from '../i18n/index.js';

export function PrivacyDialog({ onClose, onRestored }) {
  const t = useT();
  const toast = useToast();
  const pwa = usePwaState();
  const [estimate, setEstimate] = useState(null);
  const [count, setCount] = useState(null);
  const fileRef = useRef(null);

  const refresh = () => {
    storageEstimate().then(setEstimate);
    store.count().then(setCount).catch(() => setCount(null));
  };
  useEffect(refresh, []);

  const backup = async () => {
    try {
      const n = await downloadBackup(store);
      toast(n === 1 ? t('Backed up 1 document to a file in your downloads.') : t('Backed up {n} documents to a file in your downloads.', { n }), { kind: 'success' });
    } catch (err) {
      toast(err.message || 'Backup failed.', { kind: 'error' });
    }
  };

  const restore = async (file) => {
    if (!file) return;
    try {
      const { added, copied } = await restoreBackup(file, store);
      toast(added + copied === 1 ? t('Restored 1 document.') : t('Restored {n} documents.', { n: added + copied }), {
        kind: 'success',
        details: copied ? [t('{n} already existed, so they were added as copies marked "(restored)".', { n: copied })] : [],
      });
      refresh();
      onRestored && onRestored();
    } catch (err) {
      toast(err.message || 'Could not restore this file.', { kind: 'error' });
    }
  };

  const keep = async () => {
    const ok = await requestPersistence();
    toast(
      ok ? 'Your browser agreed to keep Pagewise data unless you clear it yourself.' : 'Your browser did not grant extra protection. Regular backups are the safest option.',
      { kind: ok ? 'success' : 'warning' },
    );
    refresh();
  };

  return (
    <Dialog title="Privacy and storage" onClose={onClose} size="lg">
      <div className="prose-dialog">
        <h3>{t('Your documents stay on this device')}</h3>
        <ul>
          <li>{t("Documents are saved in your browser's own database (IndexedDB). They are never uploaded anywhere.")}</li>
          <li>{t('Pagewise has no accounts, no analytics, no tracking and loads no third-party fonts or scripts.')}</li>
          <li>{t('Importing, exporting, PDF and Word conversion all run inside your browser.')}</li>
          <li>{t('Documents are not encrypted in browser storage (unless you lock them). Anyone who can use this browser profile can open them.')}</li>
          <li>{t('Pagewise only moves documents between devices if you choose a folder to sync with. That folder is then handled by your own cloud app, not by Pagewise.')}</li>
        </ul>

        <h3>{t('What can make documents disappear')}</h3>
        <ul>
          <li>{t('Clearing site data / cookies / history for this site, or "clear browsing data".')}</li>
          <li>{t('Using a private or incognito window (everything is erased when it closes).')}</li>
          <li>{t('The browser freeing space on a nearly-full disk, which can remove data that is not marked as persistent.')}</li>
          <li>{t('Opening Pagewise in another browser, profile or device: each one has its own, separate documents.')}</li>
        </ul>
        <p>
          <strong>{t('Back up regularly.')}</strong> {t('A backup file (or an exported .docx) kept somewhere else is the only durable copy. Backup files are plain JSON and are not encrypted.')}
        </p>

        <h3>{t('Status')}</h3>
        <table className="info-table">
          <tbody>
            <tr>
              <th scope="row">{t('Storage')}</th>
              <td>{store.persistent ? t('IndexedDB (saved in this browser)') : t('Unavailable: documents last only until this tab closes')}</td>
            </tr>
            {store.initError && (
              <tr>
                <th scope="row">{t('Problem')}</th>
                <td>{store.initError.message}</td>
              </tr>
            )}
            <tr>
              <th scope="row">{t('Documents')}</th>
              <td>{count ?? '…'}</td>
            </tr>
            {estimate && (
              <>
                <tr>
                  <th scope="row">{t('Space used')}</th>
                  <td>
                    {t('{used} of about {quota} available to this site', { used: formatBytes(estimate.usage), quota: formatBytes(estimate.quota) })}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('Protected from eviction')}</th>
                  <td>{estimate.persisted ? t('Yes') : t('No (best effort)')}</td>
                </tr>
              </>
            )}
            <tr>
              <th scope="row">{t('Offline use')}</th>
              <td>
                {pwa.offlineReady
                  ? t('Ready: the app is cached and works without a connection.')
                  : pwa.supported
                    ? t('Becomes available after the first full load of the deployed site.')
                    : t('Not available in this browser or in development mode.')}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={backup}>
            {t('Back up all documents')}
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {t('Restore from backup…')}
          </button>
          <button type="button" className="btn" onClick={keep}>
            {t('Ask browser to keep my data')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              restore(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}

export function AboutDialog({ onClose }) {
  const t = useT();
  return (
    <Dialog title="About Pagewise" onClose={onClose} size="md">
      <div className="about">
        <Logo size={56} />
        <div>
          <h3>{t('Pagewise 1.0')}</h3>
          <p>{t('A private, free document editor that runs entirely in your browser and can be hosted on any static site such as GitHub Pages.')}</p>
        </div>
      </div>
      <div className="prose-dialog">
        <p>
          {t('Pagewise is an independent project. It is not affiliated with Google, and documents made here are not Google Docs files. Use File → Download as → Microsoft Word (.docx) to move a document to other applications, including Google Docs.')}
        </p>
        <p>{t('Built with React, Tiptap / ProseMirror, idb, docx, mammoth, jsPDF, html2canvas, Turndown, marked and DOMPurify (all open source).')}</p>
      </div>
      <div className="dialog-footer inline">
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
          {t('Close')}
        </button>
      </div>
    </Dialog>
  );
}
