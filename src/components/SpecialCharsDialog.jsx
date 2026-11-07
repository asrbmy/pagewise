import { useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { atSelection } from './EditorDialogs.jsx';
import { useT } from '../i18n/index.js';

const GROUPS = [
  ['Symbols', '© ® ™ § ¶ † ‡ • · … ‰ ° ′ ″ № ¿ ¡ « » “ ” ‘ ’ – — ✓ ✗ ★ ☆ ♥ ♦ ♣ ♠ ☀ ☂ ☎ ✉ ✂'],
  ['Arrows', '← ↑ → ↓ ↔ ↕ ⇐ ⇑ ⇒ ⇓ ⇔ ↩ ↪ ↗ ↘ ↙ ↖ ➜ ➤'],
  ['Math', '± × ÷ ≠ ≈ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ ∆ ∇ ∈ ∉ ∩ ∪ ⊂ ⊃ ⊆ ⊇ ∀ ∃ ∅ ¬ ∧ ∨ ½ ⅓ ¼ ¾ ² ³ ⁿ'],
  ['Greek', 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω Α Β Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω'],
  ['Currency', '$ € £ ¥ ₹ ₽ ₩ ₪ ₺ ฿ ¢ ₫ ₦ ₱ ₴ ₿'],
  ['Emoji', '😀 😁 😂 🙂 😉 😍 😎 🤔 😢 😡 👍 👎 👏 🙏 💪 🎉 ❤️ 🔥 ⭐ ✅ ❌ ⚠️ 💡 📌 📎 📅 📧 🔒 🚀'],
];

/** Pick characters to insert. The dialog stays open so several can be added in a row. */
export default function SpecialCharsDialog({ editor, range, onClose }) {
  const t = useT();
  const [tab, setTab] = useState(0);
  const [pos, setPos] = useState(range);
  const [last, setLast] = useState('');

  const insert = (ch) => {
    atSelection(editor, pos).insertContent(ch).run();
    const at = editor.state.selection.to;
    setPos({ from: at, to: at });
    setLast(ch);
  };

  return (
    <Dialog title={t('Special characters')} onClose={onClose} size="md">
      <div role="tablist" aria-label={t('Character groups')} className="chip-row">
        {GROUPS.map(([name], i) => (
          <button key={name} type="button" role="tab" aria-selected={tab === i} className={`chip ${tab === i ? 'is-active' : ''}`} onClick={() => setTab(i)}>
            {t(name)}
          </button>
        ))}
      </div>
      <div className="char-grid" role="tabpanel">
        {GROUPS[tab][1].split(' ').map((ch) => (
          <button key={ch} type="button" className="char-btn" aria-label={ch} onClick={() => insert(ch)} data-autofocus={ch === GROUPS[tab][1].split(' ')[0] || undefined}>
            {ch}
          </button>
        ))}
      </div>
      <p className="hint" aria-live="polite">
        {last ? t('Inserted {c}', { c: last }) : t('Click a character to insert it at the cursor.')}
      </p>
      <div className="dialog-footer inline">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('Done')}
        </button>
      </div>
    </Dialog>
  );
}
