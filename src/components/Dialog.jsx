import { useEffect, useId, useRef, useState } from 'react';
import { useFocusTrap } from '../a11y/focus.js';
import Icon from './Icon.jsx';
import { useT } from '../i18n/index.js';

/** Accessible modal dialog: focus trap, Escape to close, labelled by its title. */
export function Dialog({ title, onClose, children, footer, size = 'md', description }) {
  const ref = useRef(null);
  const t = useT();
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, true);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{t(title)}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close dialog')}>
            <Icon name="x" />
          </button>
        </div>
        {description && (
          <p id={descId} className="dialog-description">
            {t(description)}
          </p>
        )}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const t = useT();
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} data-autofocus>
            {t('Cancel')}
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {t(confirmLabel)}
          </button>
        </>
      }
    >
      <p>{t(message)}</p>
    </Dialog>
  );
}

/** Single-field prompt (rename, etc.). */
export function PromptDialog({ title, label, initialValue = '', confirmLabel = 'Save', onSubmit, onCancel }) {
  const t = useT();
  const [value, setValue] = useState(initialValue);
  const inputId = useId();
  const submit = (e) => {
    e.preventDefault();
    onSubmit(value);
  };
  return (
    <Dialog title={title} onClose={onCancel} size="sm">
      <form onSubmit={submit}>
        <label htmlFor={inputId} className="field-label">
          {t(label)}
        </label>
        <input
          id={inputId}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          data-autofocus
          onFocus={(e) => e.target.select()}
        />
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t(confirmLabel)}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
