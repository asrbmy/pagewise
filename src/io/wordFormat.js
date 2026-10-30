/**
 * Carry direct character and paragraph formatting from Word files through mammoth, which on its
 * own only keeps bold/italic/underline/strike/sub/superscript.
 *
 * How: (1) colours are copied into the run-font attribute of document.xml, the one run property
 * mammoth reads but never uses, because mammoth ignores w:color; (2) mammoth's `transformDocument`
 * hook gives every distinct formatting combination a style name; (3) a first conversion pass
 * discovers the combinations so a style map can turn each into <span class="pwN">; (4) the
 * classes are replaced by inline styles. Formatting that comes from Word *styles* (rather than
 * being applied directly to text) is not carried over.
 */

const HIGHLIGHTS = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000',
};
const ALIGN = { center: 'center', right: 'right', both: 'justify', left: 'left' };
const HEADING_TAGS = { 'heading 1': 'h1', 'heading 2': 'h2', 'heading 3': 'h3', 'heading 4': 'h4', 'heading 5': 'h5', 'heading 6': 'h6', title: 'h1', subtitle: 'h2', quote: 'blockquote', 'intense quote': 'blockquote' };
const COLOR_TAG = /pwc=([0-9A-Fa-f]{6});/;
const SHADE_TAG = /pwh=([0-9A-Fa-f]{6});/;
const DEFAULT_SIZE_PT = 11;

/** Copy run colours into the font attribute so mammoth's document model carries them. */
export function embedColors(xml) {
  return xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (whole, inner) => {
    const m = inner.match(/<w:color\b[^>]*\bw:val="([0-9A-Fa-f]{6})"/);
    const sh = inner.match(/<w:shd\b[^>]*\bw:fill="([0-9A-Fa-f]{6})"/);
    const color = m && !/^000000$/.test(m[1]) ? m[1].toUpperCase() : '';
    const shade = sh && !/^FFFFFF$/i.test(sh[1]) ? sh[1].toUpperCase() : '';
    if (!color && !shade) return whole;
    const tag = `${color ? `pwc=${color};` : ''}${shade ? `pwh=${shade};` : ''}`;
    if (/<w:rFonts\b[^>]*\bw:ascii="/.test(inner)) {
      return `<w:rPr>${inner.replace(/(<w:rFonts\b[^>]*\bw:ascii=")/, `$1${tag}`)}</w:rPr>`;
    }
    return `<w:rPr><w:rFonts w:ascii="${tag}"/>${inner}</w:rPr>`;
  });
}

/** Rewrite word/document.xml inside the .docx. Returns the original buffer if anything is off. */
export async function embedColorsInDocx(arrayBuffer) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const entry = zip.file('word/document.xml');
    if (!entry) return arrayBuffer;
    zip.file('word/document.xml', embedColors(await entry.async('string')));
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return arrayBuffer;
  }
}

const safeFont = (f) => (f && /^[\w .,'-]{1,60}$/.test(f) ? f.trim() : '');

function runKey(run) {
  const raw = run.font || '';
  const cm = raw.match(COLOR_TAG);
  const sm = raw.match(SHADE_TAG);
  const color = cm ? `#${cm[1].toLowerCase()}` : '';
  const font = safeFont(raw.replace(COLOR_TAG, '').replace(SHADE_TAG, ''));
  const size = run.fontSize && run.fontSize !== DEFAULT_SIZE_PT && run.fontSize >= 4 && run.fontSize <= 200 ? run.fontSize : '';
  const hl = run.highlight && HIGHLIGHTS[run.highlight] ? HIGHLIGHTS[run.highlight] : sm ? `#${sm[1].toLowerCase()}` : '';
  return { color, font, size, hl };
}

/**
 * Build the mammoth `transformDocument` callback. `table` collects each distinct combination:
 * key -> { cls, style, hl, tag }.
 */
export function makeTransform(table) {
  const register = (key, info) => {
    if (!table.has(key)) table.set(key, { cls: `pw${table.size}`, ...info });
    return table.get(key);
  };
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'run') {
      const k = runKey(node);
      if (k.color || k.font || k.size || k.hl) {
        const style = [
          k.color && `color: ${k.color}`,
          k.font && `font-family: ${k.font}`,
          k.size && `font-size: ${k.size}pt`,
        ].filter(Boolean).join('; ');
        const key = `r|${k.color}|${k.font}|${k.size}|${k.hl}`;
        register(key, { kind: 'r', style, hl: k.hl });
        node.styleName = key;
        node.styleId = null;
      }
    } else if (node.type === 'paragraph') {
      const align = ALIGN[node.alignment];
      if (align && align !== 'left' && !node.numbering) {
        const base = String(node.styleName || '').toLowerCase();
        const idMatch = /^heading([1-6])$/i.exec(node.styleId || '');
        const tag = HEADING_TAGS[base] || (idMatch ? `h${idMatch[1]}` : /^heading ?([1-6])$/.exec(base) ? `h${/^heading ?([1-6])$/.exec(base)[1]}` : 'p');
        const key = `p|${align}|${tag}|${node.styleName || node.styleId || ''}`;
        register(key, { kind: 'p', style: `text-align: ${align}`, tag });
        node.styleName = key;
        node.styleId = null;
      }
    }
    if (node.children) node.children.forEach(walk);
  };
  return (doc) => {
    walk(doc);
    return doc;
  };
}

/** mammoth style-map lines for the collected combinations. */
export function styleMapRules(table) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return [...table.entries()].map(([key, v]) =>
    v.kind === 'r' ? `r[style-name='${esc(key)}'] => span.${v.cls}` : `p[style-name='${esc(key)}'] => ${v.tag}.${v.cls}:fresh`,
  );
}

/** Replace the marker classes with inline styles (and highlight with <mark>). */
export function applyFormatting(html, table) {
  if (!table.size) return html;
  const byClass = new Map([...table.values()].map((v) => [v.cls, v]));
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('[class]').forEach((el) => {
    const cls = [...el.classList].find((c) => byClass.has(c));
    if (!cls) return;
    const info = byClass.get(cls);
    el.removeAttribute('class');
    if (info.style) el.setAttribute('style', info.style);
    if (info.hl) {
      const mark = doc.createElement('mark');
      mark.setAttribute('data-color', info.hl);
      mark.setAttribute('style', `background-color: ${info.hl}; color: inherit`);
      while (el.firstChild) mark.appendChild(el.firstChild);
      el.appendChild(mark);
    }
  });
  return doc.body.innerHTML;
}
