import { Dialog } from './Dialog.jsx';
import { useT } from '../i18n/index.js';
import { TEMPLATES } from '../editor/templates.js';

/** Pick a starting point for a new document. */
export default function TemplateDialog({ onPick, onClose, busy }) {
  const t = useT();
  return (
    <Dialog title="New document from template" size="lg" onClose={onClose} description="Templates are ordinary documents. Change anything you like.">
      <ul className="template-grid">
        {TEMPLATES.map((tpl, i) => (
          <li key={tpl.id}>
            <button type="button" className="template-card" onClick={() => onPick(tpl.id)} disabled={busy} data-autofocus={i === 0 ? true : undefined}>
              <strong>{t(tpl.label)}</strong>
              <span>{t(tpl.description)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
