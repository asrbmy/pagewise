/** Theme handling: applies data-theme on <html> and follows the OS when set to "system". */
import { useEffect } from 'react';
import { usePrefs } from './prefs.js';
import { applyDocumentLanguage } from '../i18n/index.js';

export function resolveTheme(theme, prefersDark) {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark ? 'dark' : 'light';
}

export function useTheme() {
  const { theme, language } = usePrefs();
  useEffect(() => applyDocumentLanguage(language), [language]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = resolveTheme(theme, mq.matches);
      document.documentElement.setAttribute('data-theme', resolved);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#111827' : '#0f766e');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
