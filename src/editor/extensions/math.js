import { Node, mergeAttributes } from '@tiptap/core';

export const MAX_LATEX = 2000;

let katexPromise = null;
/** KaTeX and its stylesheet/fonts are loaded the first time an equation is shown. */
export function loadKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default || m);
  }
  return katexPromise;
}

/** Render LaTeX into `target` with KaTeX; falls back to the source text when KaTeX cannot parse it. */
export async function renderMath(target, latex, display) {
  try {
    const katex = await loadKatex();
    katex.render(latex, target, { displayMode: !!display, throwOnError: false, trust: false, output: 'html', maxExpand: 1000, strict: 'ignore' });
  } catch {
    target.textContent = display ? `$$${latex}$$` : `$${latex}$`;
  }
}

const clean = (v) => String(v || '').slice(0, MAX_LATEX);

/**
 * An equation written in LaTeX. It is stored as <span data-type="math" data-latex="…">$…$</span>:
 * the visible text is the LaTeX source in dollar signs, so every export (Word, Markdown, text)
 * degrades to readable source instead of losing the equation.
 */
export const MathNode = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: '', parseHTML: (el) => clean(el.getAttribute('data-latex') || el.textContent.replace(/^\$+|\$+$/g, '')) },
      display: { default: false, parseHTML: (el) => el.getAttribute('data-display') === 'true' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math"]' }];
  },

  renderHTML({ node }) {
    const { latex, display } = node.attrs;
    return ['span', mergeAttributes({ 'data-type': 'math', 'data-latex': clean(latex), 'data-display': display ? 'true' : 'false', class: 'math' }), display ? `$$${latex}$$` : `$${latex}$`];
  },

  addNodeView() {
    return ({ node: initial }) => {
      let node = initial;
      const dom = document.createElement('span');
      dom.className = 'math';
      dom.setAttribute('contenteditable', 'false');
      const paint = () => {
        dom.classList.toggle('math-display', !!node.attrs.display);
        dom.setAttribute('title', node.attrs.latex);
        dom.textContent = node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`;
        renderMath(dom, node.attrs.latex, node.attrs.display);
      };
      paint();
      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false;
          const changed = next.attrs.latex !== node.attrs.latex || next.attrs.display !== node.attrs.display;
          node = next;
          if (changed) paint();
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: () => false,
      };
    };
  },

  addCommands() {
    return {
      insertMath:
        ({ latex, display = false }) =>
        ({ commands }) =>
          !!clean(latex).trim() && commands.insertContent({ type: this.name, attrs: { latex: clean(latex).trim(), display: !!display } }),
      updateMath:
        ({ latex, display = false }) =>
        ({ state, tr, dispatch }) => {
          const sel = state.selection;
          if (!sel.node || sel.node.type.name !== this.name || !clean(latex).trim()) return false;
          if (dispatch) dispatch(tr.setNodeMarkup(sel.from, undefined, { latex: clean(latex).trim(), display: !!display }));
          return true;
        },
    };
  },
});
