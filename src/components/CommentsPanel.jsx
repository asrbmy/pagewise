import { useMemo } from 'react';
import Icon from './Icon.jsx';
import { collectComments } from '../editor/extensions/comment.js';
import { formatModified } from '../app/format.js';

/** Side panel listing the document's comments. */
export default function CommentsPanel({ editor, comments, onChange, onClose }) {
  const anchors = useMemo(() => collectComments(editor.state.doc), [editor.state.doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const order = [...anchors.keys()];
  const sorted = [...comments].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.createdAt - b.createdAt;
  });

  const goTo = (id) => {
    let range = null;
    editor.state.doc.descendants((node, pos) => {
      if (range || !node.isText) return !range;
      if (node.marks.some((m) => m.type.name === 'comment' && m.attrs.id === id)) range = { from: pos, to: pos + node.nodeSize };
      return !range;
    });
    if (range) editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  };
  const toggle = (id) => onChange(comments.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)));
  const remove = (id) => {
    editor.commands.removeCommentMark(id);
    onChange(comments.filter((c) => c.id !== id));
  };

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="comments-head">
        <h2>Comments</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close comments">
          <Icon name="x" />
        </button>
      </div>
      {!sorted.length && <p className="muted pad">No comments yet. Select some text, then choose Insert → Comment.</p>}
      <ul className="comments-list">
        {sorted.map((c) => {
          const quote = anchors.get(c.id);
          return (
            <li key={c.id} className={`comment-card${c.resolved ? ' is-resolved' : ''}`}>
              <p className="comment-quote">{quote ? `“${quote.slice(0, 90)}${quote.length > 90 ? '…' : ''}”` : 'The commented text was deleted.'}</p>
              <p className="comment-text">{c.text}</p>
              <p className="comment-meta">{formatModified(c.createdAt)}{c.resolved ? ' · Resolved' : ''}</p>
              <div className="comment-actions">
                {quote && <button type="button" className="link-btn" onClick={() => goTo(c.id)}>Show in text</button>}
                <button type="button" className="link-btn" onClick={() => toggle(c.id)}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
                <button type="button" className="link-btn danger" onClick={() => remove(c.id)}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
