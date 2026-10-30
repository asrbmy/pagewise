/**
 * Lightweight application preferences, kept in localStorage (never document content).
 * Exposes a tiny external store so React components can subscribe with useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'pagewise:prefs';

export const DEFAULT_PREFS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  spellcheck: true,
  pageSize: 'letter', // default for new documents: 'letter' | 'a4'
  sort: 'modified-desc',
  showStatusBar: true,
  pagination: true, // keep text from running across page gaps in the editor
  dismissedStorageNotice: false,
  lastBackupAt: 0, // ms timestamp of the last backup file the user downloaded
  backupSnoozedUntil: 0,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let prefs = load();
const listeners = new Set();

export function getPrefs() {
  return prefs;
}

export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked: preferences last for this session only */
  }
  listeners.forEach((l) => l());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePrefs() {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
