import { useEffect, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import Icon from './Icon.jsx';
import { useT } from '../i18n/index.js';
import { formatModified } from '../app/format.js';
import { isSupported, loadState, chooseFolder, syncNow, disableSync } from '../storage/folderSync.js';

/** Choose a folder on this device that your own cloud client (Dropbox, Drive, OneDrive, Syncthing…) already syncs. */
export default function SyncDialog({ onClose, onSynced }) {
  const t = useT();
  const [state, setState] = useState(loadState);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const supported = isSupported();

  useEffect(() => setErr(''), [state.enabled]);

  const summary = (r) => {
    if (!r) return '';
    if (r.needsPermission) return t('Pagewise needs your permission to use that folder again.');
    const parts = [];
    if (r.pushed) parts.push(t('{n} saved to the folder', { n: r.pushed }));
    if (r.pulled) parts.push(t('{n} brought in', { n: r.pulled }));
    if (r.removed) parts.push(t('{n} removed', { n: r.removed }));
    if (r.conflicts) parts.push(t('{n} edited on both sides (the older text is in version history)', { n: r.conflicts }));
    if (r.skipped?.length) parts.push(t('{n} files skipped because they could not be read', { n: r.skipped.length }));
    return parts.length ? parts.join(' · ') : t('Everything is up to date.');
  };

  const run = async (fn) => {
    setBusy(true);
    setErr('');
    try {
      const r = await fn();
      setState(loadState());
      setMsg(summary(r));
      if (r && !r.needsPermission) onSynced?.();
    } catch (e) {
      if (e?.name !== 'AbortError') setErr(e?.message || t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('Sync with a folder')} size="md" onClose={onClose} description={t('Keep your documents in a folder on this device. Pagewise itself never uses the network.')}>
      {!supported ? (
        <p className="hint">{t('This browser cannot save to a folder you pick. Use Chrome, Edge or another Chromium browser on a computer, or use backups instead.')}</p>
      ) : state.enabled ? (
        <>
          <p>
            <Icon name="cloudCheck" /> {t('Syncing with the folder "{name}".', { name: state.name })}{' '}
            {state.lastRun ? t('Last synced {when}.', { when: formatModified(state.lastRun) }) : ''}
          </p>
          <p className="hint">{t('Each document is one small file in that folder. Open Pagewise on another computer, choose the same synced folder there, and your documents follow you.')}</p>
          <div className="dialog-footer inline">
            <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await disableSync(); return null; })}>
              {t('Stop syncing')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} data-autofocus onClick={() => run(() => syncNow({ interactive: true }))}>
              {busy ? t('Syncing…') : t('Sync now')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t('Pick a folder that your own Dropbox, Google Drive, OneDrive or Syncthing app already keeps in sync. Pagewise writes one small file per document there and reads changes back. Nothing is sent anywhere by Pagewise.')}</p>
          <p className="hint">{t('Files in the folder are not encrypted, so anyone who can open that folder can read your documents. Locked documents stay encrypted.')}</p>
          <div className="dialog-footer inline">
            <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              data-autofocus
              onClick={() => run(async () => { await chooseFolder(); return syncNow({ interactive: true }); })}
            >
              {t('Choose folder')}
            </button>
          </div>
        </>
      )}
      {msg && <p role="status" className="hint">{msg}</p>}
      {err && <p role="alert" className="field-error">{err}</p>}
    </Dialog>
  );
}
