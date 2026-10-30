import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const findReplaceKey = new PluginKey('pagewiseFindReplace');

/**
 * Find every occurrence of `term` in a ProseMirror document. Matching is done per text block
 * on the concatenated text, so a match that spans formatting changes (e.g. "he<b>llo</b>")
 * is still found.
 * @returns {{from:number,to:number}[]}
 */
export function findMatches(doc, term, caseSensitive = false) {
  const results = [];
  if (!term) return results;
  const needle = caseSensitive ? term : term.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map = []; // map[i] = document position of character i
    node.descendants((child, childPos) => {
      if (child.isText) {
        for (let k = 0; k < child.text.length; k += 1) map.push(pos + 1 + childPos + k);
        text += child.text;
      } else if (child.isLeaf) {
        map.push(pos + 1 + childPos);
        text += '\n';
      }
      return false;
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    if (hay.length !== text.length) return false; // exotic case-folding: skip rather than mis-map
    let i = hay.indexOf(needle);
    while (i !== -1) {
      results.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
      i = hay.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return results;
}

function buildDecorations(doc, state) {
  if (!state.matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    state.matches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === state.index ? 'find-match find-match-current' : 'find-match' }),
    ),
  );
}

const EMPTY = { term: '', caseSensitive: false, matches: [], index: -1, decorations: DecorationSet.empty };

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findReplaceKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev, _old, newState) {
            const meta = tr.getMeta(findReplaceKey);
            let { term, caseSensitive, index } = prev;
            let recompute = tr.docChanged;
            if (meta) {
              if (meta.clear) return EMPTY;
              if (meta.term !== undefined) {
                term = meta.term;
                caseSensitive = !!meta.caseSensitive;
                recompute = true;
                index = -2; // pick nearest to selection below
              }
              if (meta.step) index = prev.index + meta.step;
              if (meta.index !== undefined) index = meta.index;
            }
            if (!recompute && !meta) return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) };
            const matches = findMatches(newState.doc, term, caseSensitive);
            if (!matches.length) index = -1;
            else if (index === -2) {
              const head = newState.selection.from;
              const nearest = matches.findIndex((m) => m.from >= head);
              index = nearest === -1 ? 0 : nearest;
            } else if (index >= matches.length) index = 0;
            else if (index < 0) index = matches.length - 1;
            const next = { term, caseSensitive, matches, index };
            return { ...next, decorations: buildDecorations(newState.doc, next) };
          },
        },
        props: {
          decorations(state) {
            return findReplaceKey.getState(state).decorations;
          },
        },
      }),
    ];
  },

  addCommands() {
    const select = (tr, match, doc) => {
      const sel = TextSelection.create(doc, match.from, match.to);
      tr.setSelection(sel).scrollIntoView();
    };

    return {
      /** Start / update a search. Highlights all matches. */
      setSearch:
        ({ term, caseSensitive = false }) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplaceKey, { term, caseSensitive }).setMeta('addToHistory', false));
          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplaceKey, { clear: true }).setMeta('addToHistory', false));
          return true;
        },

      /** Move to the next (step = 1) or previous (step = -1) match and select it. */
      stepSearch:
        (step = 1) =>
        ({ tr, state, dispatch }) => {
          const cur = findReplaceKey.getState(state);
          if (!cur.matches.length) return false;
          tr.setMeta(findReplaceKey, { step }).setMeta('addToHistory', false);
          if (dispatch) {
            // Work out the target index with the same wrap-around rules as the plugin.
            let idx = cur.index + step;
            if (idx >= cur.matches.length) idx = 0;
            if (idx < 0) idx = cur.matches.length - 1;
            select(tr, cur.matches[idx], state.doc);
            dispatch(tr);
          }
          return true;
        },

      /** Replace the current match, then move to the next one. */
      replaceCurrent:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const cur = findReplaceKey.getState(state);
          if (cur.index < 0 || !cur.matches[cur.index]) return false;
          const m = cur.matches[cur.index];
          if (dispatch) {
            tr.insertText(replacement, m.from, m.to);
            tr.setMeta(findReplaceKey, { index: cur.index });
            dispatch(tr);
          }
          return true;
        },

      /** Replace every match. Returns true; read the count beforehand from the plugin state. */
      replaceAll:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const cur = findReplaceKey.getState(state);
          if (!cur.matches.length) return false;
          if (dispatch) {
            for (let i = cur.matches.length - 1; i >= 0; i -= 1) {
              const m = cur.matches[i];
              tr.insertText(replacement, m.from, m.to);
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

export function getSearchState(editor) {
  return (editor && findReplaceKey.getState(editor.state)) || EMPTY;
}
