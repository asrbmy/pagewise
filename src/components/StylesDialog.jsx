import { useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { FONT_FAMILIES } from '../editor/constants.js';
import { STYLE_KEYS, normalizeStyles } from '../editor/styles.js';
import { useT } from '../i18n/index.js';

const LABELS = { normal: 'Normal text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3' };

/** Set the font, size, colour and weight used for normal text and headings across the whole document. */
export default function StylesDialog({ styles, onApply, onClose }) {
  const t = useT();
  const [draft, setDraft] = useState(() => normalizeStyles(styles));
  const set = (key, field, value) =>
    setDraft((d) => {
      const cur = { ...(d[key] || {}) };
      if (value === undefined || value === '' || value === null) delete cur[field];
      else cur[field] = value;
      const next = { ...d, [key]: cur };
      if (!Object.keys(cur).length) delete next[key];
      return next;
    });

  return (
    <Dialog title={t('Document styles')} onClose={onClose} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(normalizeStyles(draft));
        }}
      >
        <p className="hint">{t('These apply to the whole document, including exports. Formatting you apply to selected text still wins. Leave a field empty to keep the default.')}</p>
        <div className="styles-grid">
          {STYLE_KEYS.map((key) => {
            const s = draft[key] || {};
            return (
              <fieldset key={key} className="styles-row">
                <legend>{t(LABELS[key])}</legend>
                <label>
                  <span>{t('Font')}</span>
                  <select className="input" value={s.font || ''} onChange={(e) => set(key, 'font', e.target.value)}>
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.label} value={f.value || ''}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('Size (pt)')}</span>
                  <input className="input" type="number" min="6" max="96" step="0.5" value={s.size ?? ''} onChange={(e) => set(key, 'size', e.target.value === '' ? undefined : Number(e.target.value))} />
                </label>
                <label>
                  <span>{t('Colour')}</span>
                  <span className="color-row">
                    <input type="color" value={s.color || '#000000'} onChange={(e) => set(key, 'color', e.target.value)} aria-label={`${t(LABELS[key])} ${t('Colour')}`} />
                    <button type="button" className="link-btn" onClick={() => set(key, 'color', undefined)} disabled={!s.color}>
                      {t('Default')}
                    </button>
                  </span>
                </label>
                <label>
                  <span>{t('Weight')}</span>
                  <select className="input" value={s.bold === undefined ? '' : s.bold ? 'bold' : 'normal'} onChange={(e) => set(key, 'bold', e.target.value === '' ? undefined : e.target.value === 'bold')}>
                    <option value="">{t('Default')}</option>
                    <option value="bold">{t('Bold')}</option>
                    <option value="normal">{t('Regular')}</option>
                  </select>
                </label>
              </fieldset>
            );
          })}
        </div>
        <div className="dialog-footer inline">
          <button type="button" className="btn btn-danger-text" onClick={() => setDraft({})}>
            {t('Reset all')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('Apply')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
