import { sanitizeHtml } from './sanitize.js';

const MAX_RTF = 30 * 1024 * 1024;
const SKIP_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'footnote', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'fldinst']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A small RTF reader: paragraphs, bold/italic/underline/strike, centre/right alignment, tabs, unicode and
 * hex escapes. Tables, images, lists, headers/footers and colours are dropped.
 */
export function rtfToHtml(src) {
  const stack = [];
  let st = { skip: false, b: false, i: false, u: false, s: false, uc: 1 };
  let align = '';
  const paras = [];
  let runs = [];
  let text = '';
  let skipChars = 0;

  const flush = () => {
    if (!text) return;
    let h = esc(text).replace(/\t/g, '&emsp;');
    if (st.b) h = `<strong>${h}</strong>`;
    if (st.i) h = `<em>${h}</em>`;
    if (st.u) h = `<u>${h}</u>`;
    if (st.s) h = `<s>${h}</s>`;
    runs.push(h);
    text = '';
  };
  const endPara = () => {
    flush();
    const style = align ? ` style="text-align: ${align}"` : '';
    paras.push(`<p${style}>${runs.join('')}</p>`);
    runs = [];
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '{') {
      flush();
      stack.push({ ...st });
      i += 1;
    } else if (ch === '}') {
      flush();
      st = stack.pop() || st;
      i += 1;
    } else if (ch === '\\') {
      i += 1;
      const c = src[i];
      if (c === '\\' || c === '{' || c === '}') {
        if (!st.skip) text += c;
        i += 1;
      } else if (c === '\'') {
        const code = parseInt(src.slice(i + 1, i + 3), 16);
        if (!st.skip && !skipChars && Number.isFinite(code)) text += String.fromCharCode(code); // Windows-1252 approximated as Latin-1
        if (skipChars) skipChars -= 1;
        i += 3;
      } else if (c === '*') {
        // Ignorable destination: skip the whole group.
        st.skip = true;
        i += 1;
      } else if (c === '~') {
        if (!st.skip) text += ' ';
        i += 1;
      } else if (c === '\n' || c === '\r') {
        if (!st.skip) { flush(); endPara(); }
        i += 1;
      } else if (/[a-zA-Z]/.test(c || '')) {
        let j = i;
        while (j < n && /[a-zA-Z]/.test(src[j])) j += 1;
        const word = src.slice(i, j);
        let k = j;
        if (src[k] === '-') k += 1;
        while (k < n && /[0-9]/.test(src[k])) k += 1;
        const param = k > j ? parseInt(src.slice(j, k), 10) : null;
        i = src[k] === ' ' ? k + 1 : k;
        if (SKIP_DESTINATIONS.has(word)) st.skip = true;
        if (st.skip) continue;
        switch (word) {
          case 'par': endPara(); break;
          case 'line': flush(); runs.push('<br>'); break;
          case 'tab': text += '\t'; break;
          case 'pard': align = ''; break;
          case 'qc': align = 'center'; break;
          case 'qr': align = 'right'; break;
          case 'qj': align = 'justify'; break;
          case 'ql': align = ''; break;
          case 'b': flush(); st.b = param !== 0; break;
          case 'i': flush(); st.i = param !== 0; break;
          case 'ul': flush(); st.u = param !== 0; break;
          case 'ulnone': flush(); st.u = false; break;
          case 'strike': flush(); st.s = param !== 0; break;
          case 'plain': flush(); st.b = false; st.i = false; st.u = false; st.s = false; break;
          case 'uc': st.uc = param ?? 1; break;
          case 'u': {
            const cp = param < 0 ? param + 65536 : param;
            if (Number.isFinite(cp)) text += String.fromCharCode(cp);
            skipChars = st.uc;
            break;
          }
          case 'emdash': text += '—'; break;
          case 'endash': text += '–'; break;
          case 'lquote': text += '‘'; break;
          case 'rquote': text += '’'; break;
          case 'ldblquote': text += '“'; break;
          case 'rdblquote': text += '”'; break;
          case 'bullet': text += '•'; break;
          default: break;
        }
      } else {
        i += 1;
      }
    } else if (ch === '\r' || ch === '\n') {
      i += 1;
    } else {
      if (!st.skip) {
        if (skipChars) skipChars -= 1;
        else text += ch;
      }
      i += 1;
    }
  }
  if (text || runs.length) endPara();
  return paras.join('');
}

export async function importRtf(file) {
  if (file.size > MAX_RTF) throw new Error('This RTF file is too large to import in the browser.');
  const src = await file.text();
  if (!/^\s*\{\\rtf/.test(src)) throw new Error('This file is not a valid RTF document.');
  const html = sanitizeHtml(rtfToHtml(src)) || '<p></p>';
  return { html, warnings: ['RTF import keeps text, bold/italic/underline and alignment. Tables, images, lists, colours and headers/footers are dropped.'] };
}
