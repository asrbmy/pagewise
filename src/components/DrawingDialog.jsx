import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './Dialog.jsx';

const W = 720;
const H = 420;
const COLORS = ['#111827', '#b91c1c', '#c2410c', '#15803d', '#1d4ed8', '#7e22ce'];
const SIZES = [2, 4, 8, 16];
const MAX_UNDO = 30;

/** A simple sketch pad. The drawing is inserted into the document as a PNG image. */
export default function DrawingDialog({ onInsert, onClose }) {
  const canvasRef = useRef(null);
  const drawing = useRef(null);
  const undo = useRef([]);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [erase, setErase] = useState(false);
  const [alt, setAlt] = useState('Drawing');
  const [dirty, setDirty] = useState(false);
  const altId = useId();

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };

  const snapshot = () => {
    const ctx = canvasRef.current.getContext('2d');
    undo.current.push(ctx.getImageData(0, 0, W, H));
    if (undo.current.length > MAX_UNDO) undo.current.shift();
  };

  const down = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    snapshot();
    const p = pos(e);
    drawing.current = p;
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = erase ? '#ffffff' : color;
    ctx.fillStyle = erase ? '#ffffff' : color;
    ctx.lineWidth = erase ? size * 3 : size;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    setDirty(true);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const p = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(drawing.current.x, drawing.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawing.current = p;
  };
  const up = () => {
    drawing.current = null;
  };

  const doUndo = () => {
    const prev = undo.current.pop();
    if (prev) canvasRef.current.getContext('2d').putImageData(prev, 0, 0);
    if (!undo.current.length) setDirty(false);
  };
  const clear = () => {
    snapshot();
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    setDirty(false);
  };

  const insert = () => onInsert(canvasRef.current.toDataURL('image/png'), alt.trim() || 'Drawing');

  return (
    <Dialog
      title="Drawing"
      size="lg"
      onClose={onClose}
      description="Draw with a mouse, finger or pen. The drawing is added to the document as an image."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={insert} disabled={!dirty}>Insert drawing</button>
        </>
      }
    >
      <div className="drawing-tools" role="toolbar" aria-label="Drawing tools">
        {COLORS.map((c) => (
          <button key={c} type="button" className={`swatch${!erase && color === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Pen colour ${c}`} aria-pressed={!erase && color === c} onClick={() => { setColor(c); setErase(false); }} />
        ))}
        <button type="button" className={`btn${erase ? ' btn-primary' : ''}`} aria-pressed={erase} onClick={() => setErase(!erase)}>Eraser</button>
        <label className="sr-only" htmlFor="draw-size">Brush size</label>
        <select id="draw-size" className="tb-select" value={size} onChange={(e) => setSize(Number(e.target.value))}>
          {SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
        </select>
        <button type="button" className="btn" onClick={doUndo} disabled={!dirty}>Undo</button>
        <button type="button" className="btn" onClick={clear} disabled={!dirty}>Clear</button>
      </div>
      <canvas ref={canvasRef} className="drawing-canvas" width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="img" aria-label="Drawing area" />
      <label className="field-label" htmlFor={altId}>Description for screen readers</label>
      <input id={altId} className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
    </Dialog>
  );
}
