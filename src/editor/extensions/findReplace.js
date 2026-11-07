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
const MAX_MATCHES = 5000;

/** Build a RegExp for the search options, or null when the pattern is invalid. */
export function buildPattern(term, opts) {
  const { caseSensitive = false, wholeWord = false, regex = false } = opts;
  if (!term) return null;
  let src = regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, `gu${caseSensitive ? '' : 'i'}`);
  } catch {
    return null;
  }
}

/** The replacement text for one match (regex mode supports $1, $&). */
export function expandReplacement(match, replacement, term, opts) {
  if (!opts.regex) return replacement;
  const re = buildPattern(term, { ...opts, wholeWord: false });
  return re ? match.text.replace(re, replacement) : replacement;
}

/**
 * Find every occurrence of `term` in a ProseMirror document. Matching is done per text block
 * on the concatenated text, so a match that spans formatting changes (e.g. "he<b>llo</b>")
 * is still found. `opts` may be a boolean (caseSensitive) or {caseSensitive, wholeWord, regex}.
 * @returns {{from:number,to:number,text:string}[]}
 */
export function findMatches(doc, term, opts = false) {
  const o = typeof opts === 'boolean' ? { caseSensitive: opts } : opts;
  const results = [];
  const re = buildPattern(term, o);
  if (!re) return results;

  doc.descendants((node, pos) => {
    if (results.length >= MAX_MATCHES) return false;
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
    if (text.length > 100000) return false; // keep pathological patterns bounded
    re.lastIndex = 0;
    let m = re.exec(text);
    while (m && results.length < MAX_MATCHES) {
      if (m[0].length === 0) {
        re.lastIndex += 1; // skip empty matches
      } else {
        // Indices are UTF-16 units, same as `text` and `map`.
        results.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1, text: m[0] });
      }
      m = re.exec(text);
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

const EMPTY = { term: '', caseSensitive: false, wholeWord: false, regex: false, invalid: false, matches: [], index: -1, decorations: DecorationSet.empty };

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
            let { term, caseSensitive, wholeWord, regex, index } = prev;
            let recompute = tr.docChanged;
            if (meta) {
              if (meta.clear) return EMPTY;
              if (meta.term !== undefined) {
                term = meta.term;
                caseSensitive = !!meta.caseSensitive;
                wholeWord = !!meta.wholeWord;
                regex = !!meta.regex;
                recompute = true;
                index = -2; // pick nearest to selection below
              }
              if (meta.step) index = prev.index + meta.step;
              if (meta.index !== undefined) index = meta.index;
            }
            if (!recompute && !meta) return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) };
            const opts = { caseSensitive, wholeWord, regex };
            const matches = findMatches(newState.doc, term, opts);
            const invalid = !!term && !buildPattern(term, opts);
            if (!matches.length) index = -1;
            else if (index === -2) {
              const head = newState.selection.from;
              const nearest = matches.findIndex((m) => m.from >= head);
              index = nearest === -1 ? 0 : nearest;
            } else if (index >= matches.length) index = 0;
            else if (index < 0) index = matches.length - 1;
            const next = { term, caseSensitive, wholeWord, regex, invalid, matches, index };
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
        ({ term, caseSensitive = false, wholeWord = false, regex = false }) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplaceKey, { term, caseSensitive, wholeWord, regex }).setMeta('addToHistory', false));
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
            tr.insertText(expandReplacement(m, replacement, cur.term, cur), m.from, m.to);
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
              tr.insertText(expandReplacement(m, replacement, cur.term, cur), m.from, m.to);
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
