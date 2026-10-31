/** HTML -> Rich Text Format (.rtf), built from the shared document model (see ./model.js). */
import { parseDocument } from './model.js';
import { normalizeLayout } from '../editor/layout.js';

const TWIPS = 20; // per point
const HEADING_PT = { 1: 26, 2: 20, 3: 16, 4: 13, 5: 11, 6: 11 };
const PAGE = { letter: { w: 12240, h: 15840 }, a4: { w: 11906, h: 16838 } };

/** Escape text for RTF: control characters and everything outside ASCII (as \uN? pairs). */
export function rtfEscape(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\t') out += '\\tab ';
    else if (code < 32) out += '';
    else if (code < 127) out += ch;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function buildRtf(html, { pageSize = 'letter', layout, title = '' } = {}) {
  const { blocks, warnings } = parseDocument(html);
  const warn = new Set(warnings);
  const fonts = ['Calibri'];
  const colors = [];
  const fontIndex = (name) => {
    const clean = (name || 'Calibri').replace(/[;{}\\]/g, '');
    let i = fonts.indexOf(clean);
    if (i < 0) i = fonts.push(clean) - 1;
    return i;
  };
  const colorIndex = (hexValue) => {
    let i = colors.indexOf(hexValue);
    if (i < 0) i = colors.push(hexValue) - 1;
    return i + 1; // colour 0 is "auto"
  };

  const run = (r, base = {}) => {
    if (r.br) return '\\line ';
    if (r.image) {
      if (!/^image\/(png|jpe?g)$/.test(r.image.mime)) {
        warn.add('GIF images are not supported in RTF and were replaced by a placeholder.');
        return rtfEscape('[image]');
      }
      const kind = r.image.mime === 'image/png' ? 'pngblip' : 'jpegblip';
      const wTw = Math.round(r.image.width * 15);
      const hTw = Math.round(r.image.height * 15);
      return `{\\pict\\${kind}\\picw${r.image.width}\\pich${r.image.height}\\picwgoal${wTw}\\pichgoal${hTw}\n${hex(r.image.bytes)}}`;
    }
    const m = { ...base, ...r };
    let c = '';
    if (m.bold) c += '\\b';
    if (m.italic) c += '\\i';
    if (m.underline || m.href) c += '\\ul';
    if (m.strike) c += '\\strike';
    if (m.sup) c += '\\super';
    if (m.sub) c += '\\sub';
    if (m.color || m.href) c += `\\cf${colorIndex(m.color || '0563c1')}`;
    if (m.bg) c += `\\highlight${colorIndex(m.bg)}`;
    if (m.font) c += `\\f${fontIndex(m.font)}`;
    if (m.size) c += `\\fs${Math.round(m.size * 2)}`;
    const body = `{${c} ${rtfEscape(r.text)}}`;
    return m.href ? `{\\field{\\*\\fldinst HYPERLINK "${m.href.replace(/["\\{}]/g, '')}"}{\\fldrslt ${body}}}` : body;
  };

  const paragraph = (b, { inCell = false } = {}) => {
    let p = '\\pard';
    if (b.align) p += { center: '\\qc', right: '\\qr', justify: '\\qj' }[b.align];
    let left = (b.indent || 0) * 720;
    if (b.quote) {
      left += 720;
      p += '\\brdrl\\brdrs\\brdrw20\\brsp160';
    }
    if (b.list) {
      left += 720 * (b.list.depth + 1);
      p += '\\fi-360';
    }
    if (left) p += `\\li${left}`;
    if (b.before) p += `\\sb${Math.round(b.before * TWIPS)}`;
    p += `\\sa${b.after != null ? Math.round(b.after * TWIPS) : 160}`;
    if (b.lineHeight) p += `\\sl${Math.round(b.lineHeight * 240)}\\slmult1`;
    let body = '';
    if (b.list && b.list.first) body += b.list.ordered ? `${rtfEscape(`${b.list.num}.`)}\\tab ` : '\\u8226?\\tab ';
    const base = b.heading ? { bold: true, size: HEADING_PT[b.heading] } : {};
    body += b.runs.map((r) => run(r, base)).join('');
    return `${p} ${body}${inCell ? '' : '\\par\n'}`;
  };

  const TABLE_W = 9360;
  const table = (t) => {
    const cols = Math.max(1, ...t.rows.map((r) => r.cells.reduce((n, c) => n + c.colspan, 0)));
    const unit = Math.floor(TABLE_W / cols);
    if (t.rows.some((r) => r.cells.some((c) => c.rowspan > 1))) warn.add('Merged table rows were exported as separate cells in RTF.');
    return t.rows.map((r) => {
      let x = 0;
      const defs = r.cells.map((c) => {
        x += unit * c.colspan;
        return `${c.header ? `\\clcbpat${colorIndex('f1f3f4')}` : ''}\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx${x}`;
      }).join('');
      const cells = r.cells.map((c) => {
        const paras = c.blocks.filter((b) => b.kind === 'para').map((b) => paragraph({ ...b, heading: c.header ? 0 : b.heading, runs: c.header ? b.runs.map((x) => ({ bold: true, ...x })) : b.runs, after: 0 }, { inCell: true }));
        return `${paras.join('\\par\n') || '\\pard '}\\cell\n`;
      }).join('');
      return `\\trowd\\trgaph108\\trleft0${defs}\n${cells}\\row\n`;
    }).join('') + '\\pard\\sa160\\par\n';
  };

  const body = blocks.map((b) => {
    if (b.kind === 'para') return paragraph(b);
    if (b.kind === 'table') return table(b);
    if (b.kind === 'hr') return '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20\\sa160\\par\n';
    return '\\page\n';
  }).join('');

  const l = normalizeLayout(layout);
  const small = '\\fs18\\cf0';
  const pageNum = '{\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}';
  const furniture = [];
  if (l.header) furniture.push(`{\\header\\pard\\qc{${small} ${rtfEscape(l.header)}}\\par}`);
  if (l.footer || l.pageNumbers !== 'none') {
    const align = { left: '\\ql', center: '\\qc', right: '\\qr' };
    const numbered = l.pageNumbers !== 'none';
    const both = numbered && l.pageNumbers === 'center';
    let f = '{\\footer';
    if (l.footer) f += `\\pard\\qc{${small} ${rtfEscape(both ? `${l.footer} · Page ` : l.footer)}${both ? pageNum : ''}}\\par`;
    if (numbered && !(both && l.footer)) f += `\\pard${align[l.pageNumbers]}{${small} Page ${pageNum}}\\par`;
    furniture.push(`${f}}`);
  }

  const size = PAGE[pageSize] || PAGE.letter;
  const fontTbl = `{\\fonttbl${fonts.map((f, i) => `{\\f${i}\\fnil\\fcharset0 ${f};}`).join('')}}`;
  const colorTbl = `{\\colortbl ;${colors.map((c) => `\\red${parseInt(c.slice(0, 2), 16)}\\green${parseInt(c.slice(2, 4), 16)}\\blue${parseInt(c.slice(4, 6), 16)};`).join('')}}`;
  const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n${fontTbl}\n${colorTbl}\n{\\info{\\title ${rtfEscape(title || 'Document')}}}\n\\paperw${size.w}\\paperh${size.h}\\margl1440\\margr1440\\margt1440\\margb1440\n${furniture.join('')}\\f0\\fs22\n${body}}`;
  return { rtf, warnings: [...warn] };
}
