import { useId, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import Icon from './Icon.jsx';
import { useT } from '../i18n/index.js';
import { MIN_PASSWORD } from '../storage/crypto.js';

/** Set a password on a document (mode "lock") or remove it (mode "remove"). */
export default function LockDialog({ mode = 'lock', onSubmit, onCancel }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const t = useT();
  const locking = mode === 'lock';

  const submit = async (e) => {
    e.preventDefault();
    if (locking) {
      if (pw.length < MIN_PASSWORD) return setError(t('Use at least {n} characters.', { n: MIN_PASSWORD }));
      if (pw !== again) return setError(t('The two passwords do not match.'));
      if (!ack) return setError(t('Please confirm that you understand a forgotten password cannot be recovered.'));
    } else if (!pw) {
      return setError(t('Enter the password.'));
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(pw);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={locking ? t('Lock with a password') : t('Remove password')} onClose={onCancel} size="sm">
      <form onSubmit={submit}>
        {locking ? (
          <p className="hint">
            The text of this document is encrypted in this browser (AES-256). The title, dates and word count stay readable. Its version history is deleted, and it is excluded from search.
          </p>
        ) : (
          <p className="hint">The document will be stored without encryption again.</p>
        )}
        <label htmlFor={`${id}-pw`} className="field-label">
          {locking ? t('Password') : t('Current password')}
        </label>
        <input id={`${id}-pw`} className="input" type="password" autoComplete={locking ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus />
        {locking && (
          <>
            <label htmlFor={`${id}-pw2`} className="field-label">
              {t('Repeat password')}
            </label>
            <input id={`${id}-pw2`} className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{t('I understand that if I forget this password the document cannot be recovered, by anyone.')}</span>
            </label>
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('Working…') : locking ? t('Lock document') : t('Remove password')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Shown instead of the editor when a locked document has not been unlocked in this session. */
export function UnlockScreen({ doc, onUnlock, onBack }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const t = useT();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onUnlock(pw);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="center-state unlock-screen">
      <form onSubmit={submit} className="unlock-card">
        <h1>
          <Icon name="lock" size={20} /> {doc.title}
        </h1>
        <p>{t('This document is password-protected. Its contents are encrypted in this browser.')}</p>
        <label htmlFor={id} className="field-label">
          {t('Password')}
        </label>
        <input id={id} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus autoFocus />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onBack}>
            {t('Back to all documents')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !pw}>
            {busy ? t('Unlocking…') : t('Unlock')}
          </button>
        </div>
      </form>
    </div>
  );
}
