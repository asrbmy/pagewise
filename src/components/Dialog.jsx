import { useEffect, useId, useRef, useState } from 'react';
import { useFocusTrap } from '../a11y/focus.js';
import Icon from './Icon.jsx';

/** Accessible modal dialog: focus trap, Escape to close, labelled by its title. */
export function Dialog({ title, onClose, children, footer, size = 'md', description }) {
  const ref = useRef(null);
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
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" />
          </button>
        </div>
        {description && (
          <p id={descId} className="dialog-description">
            {description}
          </p>
        )}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} data-autofocus>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Dialog>
  );
}

/** Single-field prompt (rename, etc.). */
export function PromptDialog({ title, label, initialValue = '', confirmLabel = 'Save', onSubmit, onCancel }) {
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
          {label}
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
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
