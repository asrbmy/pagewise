import { useState } from 'react';
import { Dialog } from './Dialog.jsx';

/** Choose the folder a document lives in. */
export default function MoveDialog({ doc, folders, onMove, onClose }) {
  const [choice, setChoice] = useState(doc.folderId || '');
  return (
    <Dialog title="Move to folder" size="sm" onClose={onClose} description={`Choose where to keep "${doc.title}".`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onMove(choice || null);
        }}
      >
        <fieldset className="radio-group">
          <legend className="sr-only">Folder</legend>
          <label className="check">
            <input type="radio" name="folder" value="" checked={choice === ''} onChange={() => setChoice('')} data-autofocus={choice === '' ? true : undefined} /> No folder
          </label>
          {folders.map((f) => (
            <label key={f.id} className="check">
              <input type="radio" name="folder" value={f.id} checked={choice === f.id} onChange={() => setChoice(f.id)} data-autofocus={choice === f.id ? true : undefined} /> {f.name}
            </label>
          ))}
        </fieldset>
        {!folders.length && <p className="hint">You have no folders yet. Close this and choose "New folder" first.</p>}
        <div className="dialog-footer inline">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Move</button>
        </div>
      </form>
    </Dialog>
  );
}
