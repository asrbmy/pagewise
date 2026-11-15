import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useT } from '../i18n/index.js';

const ToastContext = createContext(() => {});

/**
 * Toast notifications. Errors use role="alert" (announced immediately); everything else is a
 * polite live region. `details` is an optional list of extra lines (e.g. export warnings).
 */
export function ToastProvider({ children }) {
  const t = useT();
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (message, { kind = 'info', details = [], duration } = {}) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((t) => [...t.slice(-3), { id, message, kind, details }]);
      const ms = duration ?? (kind === 'error' ? 9000 : details.length ? 12000 : 3500);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );

  // The context value is the `toast()` function itself, with `toast.dismiss(id)` attached.
  const value = useMemo(() => {
    const fn = (...args) => toast(...args);
    fn.dismiss = dismiss;
    return fn;
  }, [toast, dismiss]);
  const icons = { info: 'info', success: 'check', error: 'alert', warning: 'alert' };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={icons[x.kind] || 'info'} />
            <div className="toast-text">
              <div>{t(x.message)}</div>
              {x.details.length > 0 && (
                <ul>
                  {x.details.map((d) => (
                    <li key={d}>{t(d)}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label={t('Dismiss notification')} onClick={() => dismiss(x.id)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
