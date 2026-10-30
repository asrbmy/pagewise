import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import Logo from './Logo.jsx';
import { store, requestPersistence, storageEstimate } from '../storage/documents.js';
import { downloadBackup, restoreBackup } from '../io/backup.js';
import { formatBytes } from '../app/format.js';
import { usePwaState } from '../pwa/register.js';
import { useToast } from './Toasts.jsx';

export function PrivacyDialog({ onClose, onRestored }) {
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
      toast(`Backed up ${n} document${n === 1 ? '' : 's'} to a file in your downloads.`, { kind: 'success' });
    } catch (err) {
      toast(err.message || 'Backup failed.', { kind: 'error' });
    }
  };

  const restore = async (file) => {
    if (!file) return;
    try {
      const { added, copied } = await restoreBackup(file, store);
      toast(`Restored ${added + copied} document${added + copied === 1 ? '' : 's'}.`, {
        kind: 'success',
        details: copied ? [`${copied} already existed, so they were added as copies marked "(restored)".`] : [],
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
        <h3>Your documents stay on this device</h3>
        <ul>
          <li>Documents are saved in your browser's own database (IndexedDB). They are never uploaded anywhere.</li>
          <li>Pagewise has no accounts, no analytics, no tracking and loads no third-party fonts or scripts.</li>
          <li>Importing, exporting, PDF and Word conversion all run inside your browser.</li>
          <li>
            Documents are <strong>not encrypted</strong> in browser storage, and Pagewise does not sync between devices. Anyone who can use this browser profile can open them.
          </li>
        </ul>

        <h3>What can make documents disappear</h3>
        <ul>
          <li>Clearing site data / cookies / history for this site, or "clear browsing data".</li>
          <li>Using a private or incognito window (everything is erased when it closes).</li>
          <li>The browser freeing space on a nearly-full disk, which can remove data that is not marked as persistent.</li>
          <li>Opening Pagewise in another browser, profile or device: each one has its own, separate documents.</li>
        </ul>
        <p>
          <strong>Back up regularly.</strong> A backup file (or an exported .docx) kept somewhere else is the only durable copy. Backup files are plain JSON and are not encrypted.
        </p>

        <h3>Status</h3>
        <table className="info-table">
          <tbody>
            <tr>
              <th scope="row">Storage</th>
              <td>{store.persistent ? 'IndexedDB (saved in this browser)' : 'Unavailable: documents last only until this tab closes'}</td>
            </tr>
            {store.initError && (
              <tr>
                <th scope="row">Problem</th>
                <td>{store.initError.message}</td>
              </tr>
            )}
            <tr>
              <th scope="row">Documents</th>
              <td>{count ?? '…'}</td>
            </tr>
            {estimate && (
              <>
                <tr>
                  <th scope="row">Space used</th>
                  <td>
                    {formatBytes(estimate.usage)} of about {formatBytes(estimate.quota)} available to this site
                  </td>
                </tr>
                <tr>
                  <th scope="row">Protected from eviction</th>
                  <td>{estimate.persisted ? 'Yes' : 'No (best effort)'}</td>
                </tr>
              </>
            )}
            <tr>
              <th scope="row">Offline use</th>
              <td>
                {pwa.offlineReady
                  ? 'Ready: the app is cached and works without a connection.'
                  : pwa.supported
                    ? 'Becomes available after the first full load of the deployed site.'
                    : 'Not available in this browser or in development mode.'}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={backup}>
            Back up all documents
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Restore from backup…
          </button>
          <button type="button" className="btn" onClick={keep}>
            Ask browser to keep my data
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
  return (
    <Dialog title="About Pagewise" onClose={onClose} size="md">
      <div className="about">
        <Logo size={56} />
        <div>
          <h3>Pagewise 1.0</h3>
          <p>A private, free document editor that runs entirely in your browser and can be hosted on any static site such as GitHub Pages.</p>
        </div>
      </div>
      <div className="prose-dialog">
        <p>
          Pagewise is an independent project. It is <strong>not</strong> affiliated with Google, and documents made here are <strong>not</strong> Google Docs files. Use <em>File → Download as → Microsoft Word (.docx)</em> to move a document to other
          applications, including Google Docs.
        </p>
        <p>Built with React, Tiptap / ProseMirror, idb, docx, mammoth, jsPDF, html2canvas, Turndown, marked and DOMPurify (all open source).</p>
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
