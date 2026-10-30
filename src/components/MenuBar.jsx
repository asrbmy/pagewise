import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDismiss } from '../a11y/focus.js';

/**
 * Application menu bar (File, Edit, View …) following the WAI-ARIA menubar pattern:
 * Arrow keys move between items / menus, Enter or Space activates, Escape closes.
 *
 * menus: [{ label, items: [{ label, shortcut?, onSelect, disabled?, checked?, separator? }] }]
 */
export default function MenuBar({ menus }) {
  const [open, setOpen] = useState(-1);
  const barRef = useRef(null);
  const baseId = useId();

  const close = useCallback((restoreFocus = false) => {
    setOpen((cur) => {
      if (restoreFocus && cur >= 0) barRef.current?.querySelectorAll('[data-menu-button]')[cur]?.focus();
      return -1;
    });
  }, []);
  useDismiss(barRef, () => close(true), open >= 0);

  const focusItem = (menuIndex, which) => {
    requestAnimationFrame(() => {
      const items = Array.from(barRef.current?.querySelectorAll(`[data-menu="${menuIndex}"] [role^="menuitem"]:not([disabled])`) || []);
      if (!items.length) return;
      const idx = which === 'last' ? items.length - 1 : 0;
      items[idx].focus();
    });
  };

  // When a menu opens (via click or keyboard) put focus on its first item.
  useEffect(() => {
    if (open >= 0) focusItem(open, 'first');
  }, [open]);

  const onButtonKey = (e, i) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(i);
      focusItem(i, 'first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(i);
      focusItem(i, 'last');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = menus.length;
      const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      barRef.current.querySelectorAll('[data-menu-button]')[next].focus();
      if (open >= 0) setOpen(next);
    }
  };

  const onMenuKey = (e, i) => {
    const items = Array.from(barRef.current.querySelectorAll(`[data-menu="${i}"] [role^="menuitem"]:not([disabled])`));
    const cur = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(cur + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(cur - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = menus.length;
      const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      setOpen(next);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className="menubar" role="menubar" aria-label="Application menu" ref={barRef}>
      {menus.map((menu, i) => (
        <div className="menu-wrap" key={menu.label}>
          <button
            type="button"
            className={`menu-button ${open === i ? 'open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            aria-controls={open === i ? `${baseId}-${i}` : undefined}
            data-menu-button
            onClick={() => setOpen(open === i ? -1 : i)}
            onMouseEnter={() => open >= 0 && setOpen(i)}
            onKeyDown={(e) => onButtonKey(e, i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="menu" role="menu" id={`${baseId}-${i}`} aria-label={menu.label} data-menu={i} onKeyDown={(e) => onMenuKey(e, i)}>
              {menu.items.map((item, k) =>
                item.separator ? (
                  <div key={`sep-${k}`} className="menu-separator" role="separator" />
                ) : item.heading ? (
                  <div key={item.heading} className="menu-heading" role="presentation">
                    {item.heading}
                  </div>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    className="menu-item"
                    role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                    aria-checked={item.checked !== undefined ? !!item.checked : undefined}
                    disabled={item.disabled}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      close();
                      // run after the menu has closed so focus restoration by dialogs/editor wins
                      setTimeout(() => item.onSelect && item.onSelect(), 0);
                    }}
                  >
                    <span className="menu-check" aria-hidden="true">
                      {item.checked ? '✓' : ''}
                    </span>
                    <span className="menu-label">{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
