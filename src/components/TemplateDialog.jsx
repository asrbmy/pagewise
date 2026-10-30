import { Dialog } from './Dialog.jsx';
import { TEMPLATES } from '../editor/templates.js';

/** Pick a starting point for a new document. */
export default function TemplateDialog({ onPick, onClose, busy }) {
  return (
    <Dialog title="New document from template" size="lg" onClose={onClose} description="Templates are ordinary documents. Change anything you like.">
      <ul className="template-grid">
        {TEMPLATES.map((t, i) => (
          <li key={t.id}>
            <button type="button" className="template-card" onClick={() => onPick(t.id)} disabled={busy} data-autofocus={i === 0 ? true : undefined}>
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
