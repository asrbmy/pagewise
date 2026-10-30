/** Accessibility helpers: focus trapping for modal dialogs and outside-click / Escape dismissal. */
import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Keep Tab / Shift+Tab inside `ref`, focus the first control on open and restore focus on close. */
export function useFocusTrap(ref, active = true) {
  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const root = ref.current;
    const previous = document.activeElement;
    const autofocus = root.querySelector('[data-autofocus]');
    (autofocus || focusables(root)[0] || root).focus();

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (previous && previous.focus && document.contains(previous)) previous.focus();
    };
  }, [ref, active]);
}

/** Call `onDismiss` on Escape or on a pointer-down outside `ref`. */
export function useDismiss(ref, onDismiss, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss(e);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss(e);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [ref, onDismiss, active]);
}
