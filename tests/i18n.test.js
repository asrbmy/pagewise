import { describe, it, expect } from 'vitest';
import { translate, resolveLanguage, LANGUAGES } from '../src/i18n/index.js';

describe('i18n', () => {
  it('resolves auto from the browser language and falls back to English', () => {
    expect(resolveLanguage('auto', 'es-MX')).toBe('es');
    expect(resolveLanguage('auto', 'fr-CA')).toBe('fr');
    expect(resolveLanguage('auto', 'ja-JP')).toBe('en');
    expect(resolveLanguage('auto', 'hi-IN')).toBe('hi');
    expect(resolveLanguage('auto', 'pt-BR')).toBe('pt');
    expect(resolveLanguage('fr', 'es')).toBe('fr');
    expect(resolveLanguage('xx', 'en')).toBe('en');
  });
  it('translates, interpolates and falls back for unknown strings', () => {
    expect(translate('es', 'Your documents')).toBe('Tus documentos');
    expect(translate('es', 'Use at least {n} characters.', { n: 8 })).toBe('Usa al menos 8 caracteres.');
    expect(translate('es', 'Not in dictionary')).toBe('Not in dictionary');
    expect(translate('en', 'Your documents')).toBe('Your documents');
  });
  it('keeps placeholders consistent across languages', () => {
    for (const l of LANGUAGES) {
      for (const [k, v] of Object.entries(l.dict)) {
        expect((v.match(/\{\w+\}/g) || []).sort(), `${l.code}: ${k}`).toEqual((k.match(/\{\w+\}/g) || []).sort());
      }
    }
  });
});

describe('right-to-left languages', () => {
  it('Arabic and Hebrew are registered as RTL and keep placeholders', async () => {
    const { LANGUAGES, isRtlLanguage, applyDocumentLanguage } = await import('../src/i18n/index.js');
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('he')).toBe(true);
    expect(isRtlLanguage('es')).toBe(false);
    for (const code of ['ar', 'he']) {
      const dict = LANGUAGES.find((l) => l.code === code).dict;
      expect(Object.keys(dict).length).toBeGreaterThan(190);
      for (const [en, tr] of Object.entries(dict)) {
        for (const ph of en.match(/\{\w+\}/g) || []) expect(tr, `${code}: ${en}`).toContain(ph);
      }
    }
    applyDocumentLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    applyDocumentLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('every language translates the toolbar labels', async () => {
    const { translate } = await import('../src/i18n/index.js');
    for (const code of ['es', 'fr', 'de', 'pt', 'hi', 'ar', 'he']) {
      for (const k of ['Bold', 'Undo', 'Insert link', 'Align center', 'Font size', 'Heading 4', 'Hide formatting tools']) {
        expect(translate(code, k), `${code}: ${k}`).not.toBe(k);
      }
    }
  });
});

describe('dialog and template text', () => {
  it('is translated in every language', async () => {
    const { TEMPLATES } = await import('../src/editor/templates.js');
    const { LANGUAGES } = await import('../src/i18n/index.js');
    const keys = ['Close dialog', 'Cancel', 'Delete', 'Move', 'Leave anyway', ...TEMPLATES.flatMap((x) => [x.label, x.description])];
    for (const l of LANGUAGES.filter((x) => x.dict && Object.keys(x.dict).length)) for (const k of keys) expect(l.dict[k], `${l.code}: ${k}`).toBeTruthy();
  });
});

describe('messages', () => {
  it('storage and backup errors are translated in every language', async () => {
    const { LANGUAGES } = await import('../src/i18n/index.js');
    const keys = ['That password is not correct.', 'This file is not a Pagewise backup.', 'Password removed.', 'Backup failed.', 'Created "{title}".'];
    for (const l of LANGUAGES.filter((x) => Object.keys(x.dict).length)) for (const k of keys) expect(l.dict[k], `${l.code}: ${k}`).toBeTruthy();
  });
});

describe('dictionaries', () => {
  it('have no duplicate keys', async () => {
    const fs = await import('node:fs');
    for (const code of ['es', 'fr', 'de', 'pt', 'hi', 'ar', 'he']) {
      const src = fs.readFileSync(`src/i18n/${code}.js`, 'utf8');
      const keys = [...src.matchAll(/^ {2}(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_]\w*)):/gm)].map((m) => m[1] ?? m[2]);
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(dup, code).toEqual([]);
    }
  });
});
