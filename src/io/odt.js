/** HTML -> OpenDocument Text (.odt, LibreOffice / OpenOffice), from the shared model (./model.js). */
import { parseDocument } from './model.js';
import { normalizeLayout } from '../editor/layout.js';

const HEADING_PT = { 1: 26, 2: 20, 3: 16, 4: 13, 5: 11, 6: 11 };
const PAGE = { letter: { w: '8.5in', h: '11in' }, a4: { w: '21cm', h: '29.7cm' } };
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';

export const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const px = (n) => `${(n / 96).toFixed(3)}in`;

export async function buildOdt(html, { pageSize = 'letter', layout, title = '' } = {}) {
  const { default: JSZip } = await import('jszip');
  const { blocks, warnings } = parseDocument(html);
  const warn = new Set(warnings);

  // ---- automatic styles, de-duplicated by their definition
  const pStyles = new Map();
  const tStyles = new Map();
  const styleName = (map, prefix, def) => {
    if (!map.has(def)) map.set(def, `${prefix}${map.size + 1}`);
    return map.get(def);
  };
  const pStyle = (b, extra = '') => {
    const parent = b.heading ? `Heading_20_${b.heading}` : 'Standard';
    const attrs = [];
    if (b.align) attrs.push(`fo:text-align="${b.align === 'justify' ? 'justify' : b.align}"`);
    if (b.indent) attrs.push(`fo:margin-left="${(b.indent * 0.5).toFixed(2)}in"`);
    if (b.before) attrs.push(`fo:margin-top="${b.before}pt"`);
    if (b.after != null && b.after !== undefined) attrs.push(`fo:margin-bottom="${b.after}pt"`);
    if (b.lineHeight) attrs.push(`fo:line-height="${Math.round(b.lineHeight * 100)}%"`);
    if (b.quote) attrs.push('fo:margin-left="0.5in"', 'fo:border-left="1.5pt solid #9ca3af"', 'fo:padding-left="0.1in"');
    const all = attrs.join(' ') + (extra ? ` ${extra}` : '');
    if (!all.trim() && !b.heading) return 'Standard';
    return styleName(pStyles, 'P', `${parent}|${all}`);
  };
  const tStyle = (m) => {
    const a = [];
    if (m.bold) a.push('fo:font-weight="bold"');
    if (m.italic) a.push('fo:font-style="italic"');
    if (m.underline || m.href) a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (m.strike) a.push('style:text-line-through-style="solid"');
    if (m.sup) a.push('style:text-position="super 58%"');
    if (m.sub) a.push('style:text-position="sub 58%"');
    if (m.color) a.push(`fo:color="#${m.color}"`);
    else if (m.href) a.push('fo:color="#0563c1"');
    if (m.bg) a.push(`fo:background-color="#${m.bg}"`);
    if (m.font) a.push(`style:font-name="${xmlEscape(m.font)}" fo:font-family="${xmlEscape(m.font)}"`);
    if (m.size) a.push(`fo:font-size="${m.size}pt"`);
    return a.length ? styleName(tStyles, 'T', a.join(' ')) : '';
  };

  // ---- images
  const pictures = [];
  const imageXml = (img) => {
    if (!/^image\/(png|jpe?g|gif)$/.test(img.mime)) return xmlEscape('[image]');
    const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/gif' ? 'gif' : 'jpg';
    const name = `Pictures/image${pictures.length + 1}.${ext}`;
    pictures.push({ name, mime: img.mime === 'image/jpg' ? 'image/jpeg' : img.mime, bytes: img.bytes });
    return `<draw:frame draw:name="img${pictures.length}" text:anchor-type="as-char" svg:width="${px(img.width)}" svg:height="${px(img.height)}"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  };

  const runsXml = (runs, base = {}) =>
    runs.map((r) => {
      if (r.br) return '<text:line-break/>';
      if (r.image) return imageXml(r.image);
      const m = { ...base, ...r };
      const text = xmlEscape(r.text).replace(/ {2,}/g, (s) => ` <text:s text:c="${s.length - 1}"/>`).replace(/\t/g, '<text:tab/>');
      const style = tStyle(m);
      const inner = style ? `<text:span text:style-name="${style}">${text}</text:span>` : text;
      return m.href ? `<text:a xlink:type="simple" xlink:href="${xmlEscape(m.href)}">${inner}</text:a>` : inner;
    }).join('');

  const paraXml = (b, extra = {}) => {
    const base = b.heading ? { bold: true, size: HEADING_PT[b.heading] } : {};
    const style = pStyle({ ...b, ...extra });
    const inner = runsXml(b.runs, base);
    return b.heading
      ? `<text:h text:style-name="${style}" text:outline-level="${b.heading}">${inner}</text:h>`
      : `<text:p text:style-name="${style}">${inner}</text:p>`;
  };

  // ---- lists: consecutive list paragraphs become nested text:list elements
  const listXml = (items, start, depth) => {
    const styleId = items[start].list.ordered ? 'LNum' : 'LBul';
    let xml = depth === 0 ? `<text:list text:style-name="${styleId}">` : '<text:list>';
    let i = start;
    while (i < items.length && items[i].list && items[i].list.depth >= depth) {
      if (items[i].list.depth > depth) {
        const nested = listXml(items, i, depth + 1);
        xml += `<text:list-item>${nested.xml}</text:list-item>`;
        i = nested.next;
        continue; // eslint-disable-line no-continue
      }
      xml += `<text:list-item>${paraXml({ ...items[i], list: undefined })}`;
      i += 1;
      while (i < items.length && items[i].list) {
        if (items[i].list.depth === depth && !items[i].list.first) {
          xml += paraXml({ ...items[i], list: undefined });
          i += 1;
        } else if (items[i].list.depth > depth) {
          const nested = listXml(items, i, depth + 1);
          xml += nested.xml;
          i = nested.next;
        } else break;
      }
      xml += '</text:list-item>';
    }
    return { xml: `${xml}</text:list>`, next: i };
  };

  const tableXml = (t, n) => {
    const cols = Math.max(1, ...t.rows.map((r) => r.cells.reduce((s, c) => s + c.colspan, 0)));
    const covered = new Set();
    let xml = `<table:table table:name="Table${n}" table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>`;
    t.rows.forEach((r, ri) => {
      xml += '<table:table-row>';
      let col = 0;
      r.cells.forEach((c) => {
        while (covered.has(`${ri}:${col}`)) {
          xml += '<table:covered-table-cell/>';
          col += 1;
        }
        const span = c.colspan > 1 ? ` table:number-columns-spanned="${c.colspan}"` : '';
        const rspan = c.rowspan > 1 ? ` table:number-rows-spanned="${c.rowspan}"` : '';
        const paras = c.blocks.filter((b) => b.kind === 'para').map((b) => paraXml({ ...b, heading: 0, runs: c.header ? b.runs.map((x) => ({ bold: true, ...x })) : b.runs }, { after: 0 }));
        xml += `<table:table-cell table:style-name="${c.header ? 'TblH' : 'TblC'}" office:value-type="string"${span}${rspan}>${paras.join('') || '<text:p text:style-name="Standard"/>'}</table:table-cell>`;
        for (let k = 1; k < c.colspan; k += 1) xml += '<table:covered-table-cell/>';
        for (let rr = 1; rr < c.rowspan; rr += 1) for (let k = 0; k < c.colspan; k += 1) covered.add(`${ri + rr}:${col + k}`);
        col += c.colspan;
      });
      xml += '</table:table-row>';
    });
    return `${xml}</table:table>`;
  };

  let content = '';
  let tableNo = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.kind === 'para' && b.list) {
      const { xml, next } = listXml(blocks, i, 0);
      content += xml;
      i = next - 1;
    } else if (b.kind === 'para') content += paraXml(b);
    else if (b.kind === 'table') {
      tableNo += 1;
      if (b.rows.some((r) => r.cells.some((c) => c.blocks.length > 1))) warn.add('Tables keep their text; cell formatting beyond bold/italic/colour may differ.');
      content += tableXml(b, tableNo);
    } else if (b.kind === 'hr') content += '<text:p text:style-name="Hr"/>';
    else content += '<text:p text:style-name="PageBreak"/>';
  }

  const fontDecls = new Set();
  tStyles.forEach((_, def) => {
    const m = /style:font-name="([^"]+)"/.exec(def);
    if (m) fontDecls.add(m[1]);
  });
  const fontXml = `<office:font-face-decls>${[...fontDecls].map((f) => `<style:font-face style:name="${f}" svg:font-family="${f}"/>`).join('')}</office:font-face-decls>`;
  const bulletLevels = Array.from({ length: 6 }, (_, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${i % 2 ? '◦' : '•'}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.5 * (i + 1)}in" fo:text-indent="-0.25in" fo:margin-left="${0.5 * (i + 1)}in"/></style:list-level-properties></text:list-level-style-bullet>`).join('');
  const numLevels = Array.from({ length: 6 }, (_, i) => `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${['1', 'a', 'i'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.5 * (i + 1)}in" fo:text-indent="-0.25in" fo:margin-left="${0.5 * (i + 1)}in"/></style:list-level-properties></text:list-level-style-number>`).join('');

  const autoStyles = [
    ...[...pStyles].map(([def, name]) => {
      const [parent, attrs] = def.split('|');
      return `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${attrs}/></style:style>`;
    }),
    ...[...tStyles].map(([def, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${def}/></style:style>`),
    '<style:style style:name="Hr" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="0.75pt solid #9ca3af" fo:margin-bottom="8pt"/></style:style>',
    '<style:style style:name="PageBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-after="page" fo:margin="0in"/></style:style>',
    '<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="6.5in" table:align="left" fo:margin-bottom="0.1in"/></style:style>',
    '<style:style style:name="TblC" style:family="table-cell"><style:table-cell-properties fo:padding="0.05in" fo:border="0.5pt solid #9ca3af"/></style:style>',
    '<style:style style:name="TblH" style:family="table-cell"><style:table-cell-properties fo:padding="0.05in" fo:border="0.5pt solid #9ca3af" fo:background-color="#f1f3f4"/></style:style>',
    `<text:list-style style:name="LBul">${bulletLevels}</text:list-style>`,
    `<text:list-style style:name="LNum">${numLevels}</text:list-style>`,
  ].join('');

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.2">${fontXml}<office:automatic-styles>${autoStyles}</office:automatic-styles><office:body><office:text>${content || '<text:p text:style-name="Standard"/>'}</office:text></office:body></office:document-content>`;

  const l = normalizeLayout(layout);
  const size = PAGE[pageSize] || PAGE.letter;
  const pageNum = '<text:page-number text:select-page="current"/>';
  const footerParas = [];
  if (l.footer) footerParas.push(`<text:p text:style-name="FooterC">${xmlEscape(l.footer)}${l.pageNumbers === 'center' ? ` · Page ${pageNum}` : ''}</text:p>`);
  if (l.pageNumbers !== 'none' && !(l.pageNumbers === 'center' && l.footer)) {
    footerParas.push(`<text:p text:style-name="Footer${{ left: 'L', center: 'C', right: 'R' }[l.pageNumbers]}">Page ${pageNum}</text:p>`);
  }
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NS} office:version="1.2"><office:font-face-decls><style:font-face style:name="Calibri" svg:font-family="Calibri"/></office:font-face-decls><office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="8pt" fo:line-height="115%"/><style:text-properties style:font-name="Calibri" fo:font-family="Calibri" fo:font-size="11pt"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
${[1, 2, 3, 4, 5, 6].map((n) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${n}" style:class="text"><style:paragraph-properties fo:margin-top="12pt" fo:margin-bottom="6pt" fo:keep-with-next="always"/><style:text-properties fo:font-size="${HEADING_PT[n]}pt" fo:font-weight="bold"/></style:style>`).join('')}
<style:style style:name="HeaderC" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0pt"/><style:text-properties fo:font-size="9pt" fo:color="#555555"/></style:style>
<style:style style:name="FooterL" style:family="paragraph" style:parent-style-name="HeaderC"><style:paragraph-properties fo:text-align="start"/></style:style>
<style:style style:name="FooterC" style:family="paragraph" style:parent-style-name="HeaderC"/>
<style:style style:name="FooterR" style:family="paragraph" style:parent-style-name="HeaderC"><style:paragraph-properties fo:text-align="end"/></style:style>
</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${size.w}" fo:page-height="${size.h}" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1in" fo:margin-right="1in"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${l.header ? `<style:header><text:p text:style-name="HeaderC">${xmlEscape(l.header)}</text:p></style:header>` : ''}${footerParas.length ? `<style:footer>${footerParas.join('')}</style:footer>` : ''}</style:master-page></office:master-styles></office:document-styles>`;

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NS} office:version="1.2"><office:meta><dc:title>${xmlEscape(title)}</dc:title><meta:generator>Pagewise</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pictures.map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${p.mime}"/>`).join('')}</manifest:manifest>`;

  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' }); // must be first and uncompressed
  zip.file('META-INF/manifest.xml', manifest);
  zip.file('content.xml', contentXml);
  zip.file('styles.xml', stylesXml);
  zip.file('meta.xml', metaXml);
  pictures.forEach((p) => zip.file(p.name, p.bytes));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text', compression: 'DEFLATE' });
  return { blob, warnings: [...warn] };
}
