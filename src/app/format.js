/** Date / size formatting helpers for the UI. */

import { t, resolveLanguage } from '../i18n/index.js';
import { getPrefs } from '../settings/prefs.js';

// dates follow the interface language (the browser's own locale when the language is English)
const locale = () => {
  const lang = resolveLanguage(getPrefs().language);
  return lang === 'en' ? undefined : lang;
};
const timeFmt = { format: (d) => new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(d) };
const dateFmt = { format: (d) => new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(d) };
const fullFmt = { format: (d) => new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeStyle: 'medium' }).format(d) };

export function formatModified(ts, now = Date.now()) {
  if (!ts) return '';
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return t('Today, {time}', { time: timeFmt.format(d) });
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return t('Yesterday, {time}', { time: timeFmt.format(d) });
  return dateFmt.format(d);
}

export function formatFull(ts) {
  return ts ? fullFmt.format(new Date(ts)) : '';
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
