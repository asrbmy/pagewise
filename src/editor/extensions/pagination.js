import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('pagination');
const MAX_BLOCKS = 4000; // beyond this, measuring on every edit would be too slow: pagination switches itself off
const MAX_PASSES = 6;

/**
 * Pure planning step (exported for tests). Given each top-level block's measured top and height
 * (in px from the top of the editor box, current spacers included) and the spacer already in
 * front of it, return the spacer each block should have so that no block that fits on a page
 * straddles a page boundary. Blocks taller than a page are left alone. A block that follows a
 * hard page break is moved to the top of the next page.
 *
 * @param {{top:number,height:number,spacer:number,isBreak?:boolean}[]} blocks
 * @param {{pageHeight:number, margin:number}} geo
 * @returns {number[]} desired spacer height per block (0 = none)
 */
export function planSpacers(blocks, { pageHeight, margin }) {
  const usable = pageHeight - margin * 2;
  const out = [];
  let shift = 0; // how far every later block moves once the spacers planned so far are applied
  let prevBreakTop = null;
  blocks.forEach((b) => {
    const natural = b.top - b.spacer + shift; // where the block would sit with no spacer of its own
    const page = Math.floor(natural / pageHeight);
    const limit = (page + 1) * pageHeight - margin;
    let want = 0;
    if (prevBreakTop !== null) {
      const target = (Math.floor(prevBreakTop / pageHeight) + 1) * pageHeight + margin;
      if (natural < target) want = target - natural;
    } else if (b.height <= usable && natural + b.height > limit + 0.5) {
      want = (page + 1) * pageHeight + margin - natural;
    }
    want = Math.max(0, Math.round(want));
    out.push(want);
    shift += want - b.spacer;
    prevBreakTop = b.isBreak ? natural + want : null;
  });
  return out;
}

function spacerElement(height) {
  const el = document.createElement('div');
  el.className = 'page-spacer';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${height}px`;
  return el;
}

/**
 * On-screen pagination: inserts non-editable spacers (decorations, never part of the document) so
 * text does not run across the gap between pages. Printing, PDF and Word export lay pages out
 * themselves, so their page breaks can differ slightly from what is shown here.
 */
export const Pagination = Extension.create({
  name: 'pagination',

  addCommands() {
    return {
      setPagination:
        (config) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(paginationKey, { config }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => ({ enabled: false, pageHeight: 1056, margin: 96, spacers: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(paginationKey);
            let next = value;
            if (meta?.config) next = { ...next, ...meta.config, spacers: meta.config.enabled === false ? [] : next.spacers };
            if (meta?.spacers) next = { ...next, spacers: meta.spacers };
            else if (tr.docChanged && next.spacers.length) {
              // keep spacers attached to their blocks while the document changes
              next = { ...next, spacers: next.spacers.map((s) => ({ ...s, pos: tr.mapping.map(s.pos, -1) })) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = paginationKey.getState(state);
            if (!s.enabled || !s.spacers.length) return null;
            return DecorationSet.create(
              state.doc,
              s.spacers.filter((x) => x.pos <= state.doc.content.size).map((x) => Decoration.widget(x.pos, () => spacerElement(x.height), { side: -1, key: `ps-${x.pos}-${x.height}`, ignoreSelection: true })),
            );
          },
        },
        view(view) {
          let raf = 0;
          let frozen = false;
          const measure = (pass = 0) => {
            raf = 0;
            const s = paginationKey.getState(view.state);
            if (!s.enabled || frozen || !view.dom.isConnected) return;
            const doc = view.state.doc;
            if (doc.childCount > MAX_BLOCKS) {
              if (s.spacers.length) view.dispatch(view.state.tr.setMeta(paginationKey, { spacers: [] }).setMeta('addToHistory', false));
              return;
            }
            const blocks = [];
            const positions = [];
            const current = new Map(s.spacers.map((x) => [x.pos, x.height]));
            let pos = 0;
            doc.forEach((node, offset) => {
              const dom = view.nodeDOM(offset);
              positions.push(offset);
              if (dom && dom.nodeType === 1) {
                blocks.push({ top: dom.offsetTop, height: dom.offsetHeight, spacer: current.get(offset) || 0, isBreak: node.type.name === 'pageBreak' });
              } else blocks.push({ top: 0, height: 0, spacer: 0, isBreak: false });
              pos = offset;
            });
            if (!blocks.length || pos < 0) return;
            const want = planSpacers(blocks, { pageHeight: s.pageHeight, margin: s.margin });
            const next = positions.map((p, i) => ({ pos: p, height: want[i] })).filter((x) => x.height > 0);
            const same = next.length === s.spacers.length && next.every((x, i) => x.pos === s.spacers[i].pos && Math.abs(x.height - s.spacers[i].height) < 1);
            if (same) return;
            view.dispatch(view.state.tr.setMeta(paginationKey, { spacers: next }).setMeta('addToHistory', false));
            if (pass + 1 < MAX_PASSES) raf = requestAnimationFrame(() => measure(pass + 1));
          };
          const schedule = () => {
            if (!raf) raf = requestAnimationFrame(() => measure(0));
          };
          // images load after the first layout and change heights
          const onLoad = () => schedule();
          view.dom.addEventListener('load', onLoad, true);
          schedule();
          return {
            update(v, prev) {
              const a = paginationKey.getState(prev);
              const b = paginationKey.getState(v.state);
              if (v.state.doc !== prev.doc || a.enabled !== b.enabled || a.pageHeight !== b.pageHeight || a.margin !== b.margin) schedule();
            },
            destroy() {
              frozen = true;
              if (raf) cancelAnimationFrame(raf);
              view.dom.removeEventListener('load', onLoad, true);
            },
          };
        },
      }),
    ];
  },
});
