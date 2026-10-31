import { describe, it, expect } from 'vitest';
import { translate, resolveLanguage, LANGUAGES } from '../src/i18n/index.js';

describe('i18n', () => {
  it('resolves auto from the browser language and falls back to English', () => {
    expect(resolveLanguage('auto', 'es-MX')).toBe('es');
    expect(resolveLanguage('auto', 'fr-CA')).toBe('fr');
    expect(resolveLanguage('auto', 'ja-JP')).toBe('en');
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
