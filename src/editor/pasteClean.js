/**
 * Clean HTML that arrives from the clipboard before ProseMirror parses it.
 *
 * Handles the usual offenders:
 *  - Microsoft Word / Outlook: conditional comments, <o:p>, mso-* styles, MsoNormal classes,
 *    fake lists made of paragraphs (mso-list), <style> blocks
 *  - Google Docs: the <b id="docs-internal-guid-…"> wrapper (which would bold everything)
 *  - Web pages: scripts, styles, tracking pixels, iframes
 *
 * The result is plain, semantic HTML that the editor schema turns into real paragraphs,
 * headings, lists, tables, links and basic inline formatting.
 */

const DROP_TAGS = ['script', 'style', 'meta', 'link', 'title', 'xml', 'iframe', 'object', 'embed', 'noscript', 'form', 'input', 'button', 'select', 'textarea'];

function removeComments(root) {
  const walker = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.remove());
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function cleanStyle(el) {
  const style = el.getAttribute('style');
  if (!style) return;
  const kept = style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      const prop = d.split(':')[0].trim().toLowerCase();
      if (prop.startsWith('mso-') || prop.startsWith('-webkit-') || prop.startsWith('-moz-')) return false;
      // Page-layout properties pasted from Word make no sense inside the page.
      return !['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'width', 'height', 'position', 'float', 'page-break-before', 'tab-stops', 'text-indent', 'layout-grid-mode', 'orphans', 'widows', 'line-height'].includes(prop);
    });
  if (kept.length) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

/** Turn runs of Word "list paragraphs" into real <ul>/<ol> lists. */
function convertWordLists(body) {
  const doc = body.ownerDocument;
  const isListPara = (el) =>
    el.nodeType === 1 && el.tagName === 'P' && /mso-list\s*:\s*(?!none)/i.test(el.getAttribute('style') || '') && !/mso-list\s*:\s*ignore/i.test(el.getAttribute('style') || '');

  const children = Array.from(body.children);
  let i = 0;
  while (i < children.length) {
    if (!isListPara(children[i])) {
      i += 1;
      continue;
    }
    const run = [];
    const listId = (el) => ((el.getAttribute('style') || '').match(/mso-list\s*:\s*(l\d+)/i) || [])[1];
    const id = listId(children[i]);
    // One run = consecutive paragraphs that belong to the same Word list.
    while (i < children.length && isListPara(children[i]) && listId(children[i]) === id) {
      run.push(children[i]);
      i += 1;
    }
    const anchor = run[0];
    const rootList = { el: null, level: 0 };
    const stack = [];
    run.forEach((p) => {
      const style = p.getAttribute('style') || '';
      const level = Math.max(1, parseInt((style.match(/level(\d+)/i) || [])[1] || '1', 10));
      // The bullet/number lives in a span marked mso-list:Ignore – read it, then drop it.
      let marker = '';
      p.querySelectorAll('span').forEach((sp) => {
        if (/mso-list\s*:\s*ignore/i.test(sp.getAttribute('style') || '')) {
          marker = sp.textContent.trim();
          sp.remove();
        }
      });
      const ordered = /^(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]$/.test(marker);
      const tag = ordered ? 'ol' : 'ul';
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      if (!stack.length || stack[stack.length - 1].level < level) {
        const list = doc.createElement(tag);
        if (stack.length) {
          const parentLi = stack[stack.length - 1].el.lastElementChild;
          (parentLi || stack[stack.length - 1].el).appendChild(list);
        } else rootList.el = list;
        stack.push({ el: list, level });
      }
      const li = doc.createElement('li');
      li.innerHTML = p.innerHTML.trim();
      stack[stack.length - 1].el.appendChild(li);
    });
    if (rootList.el) anchor.parentNode.insertBefore(rootList.el, anchor);
    run.forEach((p) => p.remove());
  }
}

export function cleanPastedHtml(html) {
  if (!html) return html;
  // Conditional comments such as <!--[if gte mso 9]>…<![endif]--> hide real markup from parsers.
  const input = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '').replace(/<!\[if[^\]]*\]>|<!\[endif\]>/gi, '');
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const body = doc.body;

  removeComments(doc);
  body.querySelectorAll(DROP_TAGS.join(',')).forEach((n) => n.remove());
  // Word namespace tags: <o:p>, <w:…>, <v:…>
  body.querySelectorAll('*').forEach((n) => {
    if (n.tagName.includes(':')) unwrap(n);
  });
  // Google Docs wraps everything in <b style="font-weight:normal" id="docs-internal-guid-…">
  body.querySelectorAll('b[id^="docs-internal-guid"]').forEach(unwrap);
  // Tracking pixels / tiny images
  body.querySelectorAll('img').forEach((img) => {
    const w = parseInt(img.getAttribute('width') || '', 10);
    const h = parseInt(img.getAttribute('height') || '', 10);
    if ((w && w <= 2) || (h && h <= 2) || img.src.startsWith('file:')) img.remove();
  });

  convertWordLists(body);

  body.querySelectorAll('*').forEach((el) => {
    cleanStyle(el);
    const cls = el.getAttribute('class');
    if (cls) el.removeAttribute('class');
    ['lang', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'v:shapes'].forEach((a) => {
      if (el.tagName !== 'IMG' && el.tagName !== 'TD' && el.tagName !== 'TH') el.removeAttribute(a);
    });
    // Remove event handlers
    Array.from(el.attributes).forEach((a) => {
      if (a.name.startsWith('on')) el.removeAttribute(a.name);
    });
  });

  // Empty spans left over after style stripping
  body.querySelectorAll('span:not([style])').forEach(unwrap);
  // Remove empty <p>&nbsp;</p> runs that Word uses for spacing? Keep one—ProseMirror collapses them.
  return body.innerHTML.trim();
}
