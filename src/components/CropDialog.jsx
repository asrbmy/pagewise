import { useEffect, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { useT } from '../i18n/index.js';

const SIDES = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
];
const MAX_EDGE = 60; // never crop more than 60% from one side, and the two sides together stay under 90%

/** Crop an embedded image by trimming a percentage from each side. The cropped pixels are removed from the document. */
export default function CropDialog({ src, onApply, onClose }) {
  const t = useT();
  const [c, setC] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [error, setError] = useState('');
  const [size, setSize] = useState(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setError(t('This image cannot be cropped.'));
    img.src = src;
  }, [src, t]);

  const set = (side, v) => {
    const other = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side];
    const value = Math.max(0, Math.min(MAX_EDGE, Number(v) || 0));
    setC((cur) => ({ ...cur, [side]: Math.min(value, 90 - cur[other]) }));
  };

  const apply = async (e) => {
    e.preventDefault();
    if (!size) return;
    const sx = Math.round((size.w * c.left) / 100);
    const sy = Math.round((size.h * c.top) / 100);
    const sw = Math.max(8, Math.round(size.w * (1 - (c.left + c.right) / 100)));
    const sh = Math.max(8, Math.round(size.h * (1 - (c.top + c.bottom) / 100)));
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const jpeg = /^data:image\/jpe?g/i.test(src);
      onApply(canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92));
    } catch {
      setError(t('This image cannot be cropped.'));
    }
  };

  return (
    <Dialog title={t('Crop image')} onClose={onClose} size="md">
      <form onSubmit={apply}>
        <div className="crop-preview" aria-hidden="true">
          <img src={src} alt="" style={{ clipPath: `inset(${c.top}% ${c.right}% ${c.bottom}% ${c.left}%)` }} />
        </div>
        <div className="crop-sliders">
          {SIDES.map(([side, label]) => (
            <label key={side}>
              <span>
                {t(label)}: {c[side]}%
              </span>
              <input type="range" min="0" max={MAX_EDGE} value={c[side]} onChange={(e) => set(side, e.target.value)} />
            </label>
          ))}
        </div>
        <p className="hint">{t('Cropped areas are removed from the document. Undo (Ctrl+Z) brings them back right after.')}</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer inline">
          <button type="button" className="btn btn-danger-text" onClick={() => setC({ top: 0, bottom: 0, left: 0, right: 0 })}>
            {t('Reset')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!size}>
            {t('Crop')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
