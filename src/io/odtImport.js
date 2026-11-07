import JSZip from 'jszip';
import { sanitizeHtml } from './sanitize.js';

const NS = {
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
};
const MAX_XML = 40 * 1024 * 1024;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function styleInfo(doc) {
  const map = new Map();
  for (const st of Array.from(doc.getElementsByTagNameNS(NS.style, 'style'))) {
    const name = st.getAttributeNS(NS.style, 'name');
    const tp = st.getElementsByTagNameNS(NS.style, 'text-properties')[0];
    const pp = st.getElementsByTagNameNS(NS.style, 'paragraph-properties')[0];
    const info = {};
    const display = st.getAttributeNS(NS.style, 'display-name') || name || '';
    const parent = st.getAttributeNS(NS.style, 'parent-style-name') || '';
    const hm = /^Heading[ _]*(?:20_)?(\d)$/.exec(display) || /^Heading_20_(\d)$/.exec(name || '') || /^Heading_20_(\d)$/.exec(parent);
    if (hm) info.heading = Math.min(6, Number(hm[1]));
    else if (/^Title$/.test(display) || parent === 'Title') info.heading = 1;
    if (tp) {
      if (tp.getAttributeNS(NS.fo, 'font-weight') === 'bold') info.bold = true;
      if (tp.getAttributeNS(NS.fo, 'font-style') === 'italic') info.italic = true;
      const u = tp.getAttributeNS(NS.style, 'text-underline-style');
      if (u && u !== 'none') info.underline = true;
      const l = tp.getAttributeNS(NS.style, 'text-line-through-style');
      if (l && l !== 'none') info.strike = true;
    }
    if (pp) {
      const a = pp.getAttributeNS(NS.fo, 'text-align');
      if (['center', 'right', 'end', 'justify'].includes(a)) info.align = a === 'end' ? 'right' : a;
    }
    if (name) map.set(name, info);
  }
  return map;
}

function wrap(html, info) {
  let out = html;
  if (info.bold) out = `<strong>${out}</strong>`;
  if (info.italic) out = `<em>${out}</em>`;
  if (info.underline) out = `<u>${out}</u>`;
  if (info.strike) out = `<s>${out}</s>`;
  return out;
}

function inline(node, styles) {
  let out = '';
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType === 3) {
      out += esc(c.nodeValue);
    } else if (c.nodeType === 1) {
      const ln = c.localName;
      if (ln === 'span') out += wrap(inline(c, styles), styles.get(c.getAttributeNS(NS.text, 'style-name')) || {});
      else if (ln === 's') out += ' '.repeat(Number(c.getAttributeNS(NS.text, 'c')) || 1).replace(/ /g, '&nbsp;');
      else if (ln === 'tab') out += '&emsp;';
      else if (ln === 'line-break') out += '<br>';
      else if (ln === 'a') {
        const href = c.getAttributeNS(NS.xlink, 'href') || '';
        out += /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href).replace(/"/g, '&quot;')}">${inline(c, styles)}</a>` : inline(c, styles);
      } else if (ln === 'note' || ln === 'bookmark' || ln === 'bookmark-start' || ln === 'bookmark-end') {
        // Footnotes arrive as plain text of the note body would be noisy; skip them.
      } else out += inline(c, styles);
    }
  }
  return out;
}

function blocks(node, styles, ctx) {
  let out = '';
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType !== 1) continue;
    const ln = c.localName;
    if (ln === 'h') {
      const level = Math.min(6, Math.max(1, Number(c.getAttributeNS(NS.text, 'outline-level')) || 1));
      const inner = inline(c, styles).replace(/^<strong>([\s\S]*)<\/strong>$/, (m, x) => (x.includes('<strong>') ? m : x)); // headings are bold anyway
      out += `<h${level}>${inner}</h${level}>`;
    } else if (ln === 'p') {
      const info = styles.get(c.getAttributeNS(NS.text, 'style-name')) || {};
      if (info.heading) {
        out += `<h${info.heading}>${inline(c, styles)}</h${info.heading}>`;
        continue;
      }
      const align = info.align ? ` style="text-align: ${info.align}"` : '';
      const body = wrap(inline(c, styles), { ...info, align: undefined });
      out += `<p${align}>${body}</p>`;
    } else if (ln === 'list') {
      const ordered = ctx.ordered.has(c.getAttributeNS(NS.text, 'style-name'));
      const items = Array.from(c.childNodes).filter((x) => x.localName === 'list-item' || x.localName === 'list-header');
      out += `<${ordered ? 'ol' : 'ul'}>${items.map((li) => `<li>${blocks(li, styles, ctx) || '<p></p>'}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
    } else if (ln === 'table') {
      const rows = Array.from(c.getElementsByTagNameNS(NS.table, 'table-row'));
      out += `<table><tbody>${rows
        .map((r) => `<tr>${Array.from(r.childNodes).filter((x) => x.localName === 'table-cell').map((cell) => `<td>${blocks(cell, styles, ctx) || '<p></p>'}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
    } else if (['section', 'table-of-content', 'index-body', 'text', 'body'].includes(ln)) {
      out += blocks(c, styles, ctx);
    }
  }
  return out;
}

/** Import an OpenDocument text file (.odt). Images, footnote bodies, comments and page layout are not imported. */
export async function importOdt(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as an .odt document (it may be corrupted).');
  }
  const entry = zip.file('content.xml');
  if (!entry) throw new Error('This file is not an OpenDocument text file (content.xml is missing).');
  const xml = await entry.async('string');
  if (xml.length > MAX_XML) throw new Error('This document is too large to import in the browser.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The document content could not be parsed.');
  const styles = styleInfo(doc);
  const ordered = new Set();
  for (const ls of Array.from(doc.getElementsByTagNameNS(NS.text, 'list-style'))) {
    const first = ls.firstElementChild;
    if (first && first.localName === 'list-level-style-number') ordered.add(ls.getAttributeNS(NS.style, 'name'));
  }
  const body = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0];
  if (!body) throw new Error('This .odt file has no text content.');
  const html = sanitizeHtml(blocks(body, styles, { ordered })) || '<p></p>';
  const warnings = [];
  if (doc.getElementsByTagNameNS(NS.draw, 'image').length) warnings.push('Images in the .odt file were not imported.');
  if (doc.getElementsByTagNameNS(NS.text, 'note').length) warnings.push('Footnotes in the .odt file were not imported.');
  return { html, warnings };
}
