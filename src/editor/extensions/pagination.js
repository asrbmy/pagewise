import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('pagination');
const MAX_BLOCKS = 4000; // beyond this, measuring on every edit would be too slow: pagination switches itself off
const MAX_PASSES = 10;

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
export function planSpacers(blocks, geo) {
  const planner = createPlanner(geo);
  return blocks.map((b) => planner.next(b));
}

/**
 * Stateful form of planSpacers: feed blocks in order, in a "natural" frame (no spacers anywhere,
 * so `spacer` is normally 0). `shift` is the total spacer height planned so far; splits inside tall
 * blocks add theirs with `add()`.
 */
export function createPlanner({ pageHeight, margin }) {
  const usable = pageHeight - margin * 2;
  let shift = 0; // how far every later block moves once the spacers planned so far are applied
  let prevBreakTop = null;
  return {
    get shift() {
      return shift;
    },
    add(h) {
      shift += h;
    },
    isTall: (height) => height > usable,
    next(b) {
      const natural = b.top - (b.spacer || 0) + shift; // where the block would sit with no spacer of its own
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
      shift += want - (b.spacer || 0);
      prevBreakTop = b.isBreak ? natural + want : null;
      return want;
    },
  };
}

/**
 * Where to split a table taller than a page: before the first row that would cross a page edge
 * (rows taller than a page are left alone). `rows` are in the natural frame; `base` is the
 * planner's shift when the table starts.
 */
export function planRowSplits(rows, base, { pageHeight, margin }) {
  const usable = pageHeight - margin * 2;
  let shift = base;
  const out = [];
  rows.forEach((r, i) => {
    const top = r.top + shift;
    const page = Math.floor(top / pageHeight);
    const limit = (page + 1) * pageHeight - margin;
    if (i > 0 && r.height <= usable && top + r.height > limit + 0.5) {
      const h = Math.round((page + 1) * pageHeight + margin - top);
      if (h > 0) {
        out.push({ pos: r.pos, height: h, kind: 'row' });
        shift += h;
      }
    }
  });
  return { splits: out, total: shift - base };
}

/**
 * Same idea for the lines of one paragraph. `at(pos)` returns the natural {top, bottom} of the
 * line containing the character after `pos`. Break positions are found by bisection, so only
 * O(log n) layout reads are needed per page.
 */
export function planLineSplits(at, start, end, base, { pageHeight, margin }) {
  const out = [];
  let shift = base;
  let from = start;
  for (let n = 0; n < 400; n++) {
    const page = Math.floor((at(from).top + shift) / pageHeight);
    const limit = (page + 1) * pageHeight - margin + 0.5;
    if (at(end).bottom + shift <= limit) break;
    let lo = from;
    let hi = end;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(mid).bottom + shift > limit) hi = mid;
      else lo = mid + 1;
    }
    const cross = at(lo);
    const tol = Math.max(1, (cross.bottom - cross.top) * 0.5);
    let a = from;
    let b = lo;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (at(mid).top >= cross.top - tol) b = mid;
      else a = mid + 1;
    }
    if (a === from && n > 0) break; // a single line taller than the page: nothing to split
    const h = Math.round((page + 1) * pageHeight + margin - (at(a).top + shift));
    if (h <= 0) break;
    out.push({ pos: a, height: h, kind: 'line' });
    shift += h;
    from = a;
  }
  return { splits: out, total: shift - base };
}

function spacerElement(height) {
  const el = document.createElement('div');
  el.className = 'page-spacer';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${height}px`;
  return el;
}

function rowSpacerElement(height, cols) {
  const tr = document.createElement('tr');
  tr.className = 'page-spacer page-spacer-row';
  tr.setAttribute('contenteditable', 'false');
  tr.setAttribute('aria-hidden', 'true');
  const td = document.createElement('td');
  td.colSpan = Math.max(1, cols || 1);
  td.style.height = `${height}px`;
  tr.appendChild(td);
  return tr;
}

/** Split points inside a block taller than a page (long paragraph, big table). */
function tallSplits(view, node, offset, dom, base, geo, curBefore) {
  const empty = { list: [], total: 0, length: 0 };
  const rect = dom.getBoundingClientRect();
  const scale = dom.offsetHeight > 0 && rect.height > 0 ? rect.height / dom.offsetHeight : 1;
  const y = (clientY) => (clientY - rect.top) / scale + dom.offsetTop;
  let result;
  if (node.isTextblock) {
    const start = offset + 1;
    const end = offset + node.nodeSize - 1;
    if (end <= start) return empty;
    const at = (pos) => {
      const c = view.coordsAtPos(pos, 1);
      const sub = curBefore(pos);
      return { top: y(c.top) - sub, bottom: y(c.bottom) - sub };
    };
    result = planLineSplits(at, start, end, base, geo);
  } else if (node.type.name === 'table') {
    const rows = [];
    node.forEach((row, rowOffset) => {
      const pos = offset + 1 + rowOffset;
      const rowDom = view.nodeDOM(pos);
      if (!rowDom || rowDom.nodeType !== 1) return;
      const r = rowDom.getBoundingClientRect();
      const sub = curBefore(pos);
      rows.push({ pos, top: y(r.top) - sub, height: r.height / scale });
    });
    let cols = 0;
    node.firstChild?.forEach((cell) => {
      cols += cell.attrs.colspan || 1;
    });
    result = planRowSplits(rows, base, geo);
    result.splits.forEach((x) => {
      x.cols = cols;
    });
  } else return empty;
  return { list: result.splits, total: result.total, length: result.splits.length };
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
              s.spacers.filter((x) => x.pos <= state.doc.content.size).map((x) => Decoration.widget(x.pos, () => (x.kind === 'row' ? rowSpacerElement(x.height, x.cols) : spacerElement(x.height)), { side: -1, key: `ps-${x.kind || 'b'}-${x.pos}-${x.height}`, ignoreSelection: true })),
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
            const geo = { pageHeight: s.pageHeight, margin: s.margin };
            const planner = createPlanner(geo);
            const all = s.spacers.slice().sort((x, y) => x.pos - y.pos);
            // everything below is measured in a "natural" frame: current spacers subtracted out
            const curBefore = (pos) => {
              let sum = 0;
              for (const x of all) {
                if (x.pos > pos) break;
                sum += x.height;
              }
              return sum;
            };
            const next = [];
            doc.forEach((node, offset) => {
              const dom = view.nodeDOM(offset);
              if (!dom || dom.nodeType !== 1) {
                planner.next({ top: 0, height: 0, spacer: 0, isBreak: false });
                return;
              }
              const end = offset + node.nodeSize;
              const inside = all.reduce((a2, x) => (x.pos > offset && x.pos < end ? a2 + x.height : a2), 0);
              const height = dom.offsetHeight - inside;
              const want = planner.next({ top: dom.offsetTop - curBefore(offset), height, spacer: 0, isBreak: node.type.name === 'pageBreak' });
              if (want > 0) next.push({ pos: offset, height: want });
              if (!planner.isTall(height)) return;
              const splits = tallSplits(view, node, offset, dom, planner.shift, geo, curBefore);
              if (splits.length) {
                next.push(...splits.list);
                planner.add(splits.total);
              }
            });
            if (!doc.childCount) return;
            next.sort((x, y) => x.pos - y.pos);
            const same = next.length === s.spacers.length && next.every((x, i) => x.pos === all[i].pos && (x.kind || '') === (all[i].kind || '') && Math.abs(x.height - all[i].height) < 1);
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
