/**
 * Minimal translation layer. English text is the key: t('Your documents'). Strings with no
 * translation fall back to English, so a language can be added gradually. Placeholders use {name}.
 */
import { useCallback } from 'react';
import { usePrefs, getPrefs } from '../settings/prefs.js';
import es from './es.js';
import fr from './fr.js';

export const LANGUAGES = [
  { code: 'en', name: 'English', dict: {} },
  { code: 'es', name: 'Español', dict: es },
  { code: 'fr', name: 'Français', dict: fr },
];

/** Resolve the preference ('auto' follows the browser) to a supported language code. */
export function resolveLanguage(pref, navLang) {
  if (pref && pref !== 'auto' && LANGUAGES.some((l) => l.code === pref)) return pref;
  const base = String(navLang || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en').toLowerCase().split('-')[0];
  return LANGUAGES.some((l) => l.code === base) ? base : 'en';
}

export function translate(lang, text, vars) {
  const entry = LANGUAGES.find((l) => l.code === lang);
  let out = (entry && entry.dict[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Non-hook form for code outside components. */
export function t(text, vars) {
  return translate(resolveLanguage(getPrefs().language), text, vars);
}

/** Hook: returns a translate function that re-renders when the language changes. */
export function useT() {
  const { language } = usePrefs();
  const lang = resolveLanguage(language);
  return useCallback((text, vars) => translate(lang, text, vars), [lang]);
}

export function applyDocumentLanguage(pref) {
  if (typeof document !== 'undefined') document.documentElement.lang = resolveLanguage(pref);
}
