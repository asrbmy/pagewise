import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const ToastContext = createContext(() => {});

/**
 * Toast notifications. Errors use role="alert" (announced immediately); everything else is a
 * polite live region. `details` is an optional list of extra lines (e.g. export warnings).
 */
export function ToastProvider({ children }) {
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
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={icons[t.kind] || 'info'} />
            <div className="toast-text">
              <div>{t.message}</div>
              {t.details.length > 0 && (
                <ul>
                  {t.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
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
