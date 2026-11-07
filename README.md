# Pagewise

A private, browser-based document editor. Everything runs in your browser and is stored on your device: no server, no account, no analytics, no uploads. It deploys as a plain static site (GitHub Pages ready).

Pagewise is an original project. It is not affiliated with Google, and files it exports are ordinary `.docx`/`.pdf`/`.html`/`.odt`/`.rtf`/`.epub`/`.md`/`.txt` files, not native Google Docs.

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (vitest)
npm run e2e        # real-browser suites (Chromium via puppeteer-core); `npm run e2e lock i18n` runs some
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to the `main` branch.
2. In the repository go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` installs, runs the tests, builds and publishes `dist/`.

The workflow sets `BASE_PATH` automatically to `/<repo-name>/` (or `/` for a `<user>.github.io` repository), so the site works under a project subpath. Locally you can reproduce this:

```bash
BASE_PATH=/my-repo/ npm run build && npm run preview
```

Without `BASE_PATH` the build uses relative asset paths (`./`), which also works on most static hosts. Routing uses the URL hash (`#/`, `#/d/<id>`), so no server rewrite rules are needed and refreshing any page works.

## Features

**Documents**: create, rename, edit, autosave (700 ms debounce) plus manual save, duplicate, delete with confirmation, search by title and content, sort (modified, created, title), last-modified dates, recovery after refresh, a warning before closing with unsaved changes, and clear messages when storage is full or blocked.

**Editing**: undo/redo, font family and size, bold/italic/underline/strike, sub/superscript, text colour and highlight, paragraph styles and headings, alignment, indent/outdent, bulleted and numbered lists, line height, paragraph spacing, links, images (upload, paste or URL; resizable), tables (add/remove rows, columns, header row), horizontal rule, page break, find and replace, browser spellcheck, word/character counts, zoom, page size and margins, light/dark theme, and keyboard shortcuts (Help → Keyboard shortcuts).

**Version history**: File → Version history keeps snapshots (taken when a document is opened, every ten minutes of editing, and on request, with optional names), previews them, and restores one. A restore first saves the text it replaces as "Before restore". Up to 40 automatic snapshots are kept per document; named ones are kept until deleted. Snapshots are included in backup files (except for password-locked documents, which keep none).

**Templates and structure**: start from a template (letter, meeting notes, résumé, report, project plan) on the home page or File → New from template. Insert → Table of contents builds a contents list from Heading 1–3 and Update table of contents refreshes it. Entries link to their headings (click one in the editor, or in exported HTML). With page gaps on they also show page numbers ("· p. 3"), taken from the on-screen layout; use Update table of contents after editing.

**Header, footer and page numbers**: File → Page setup. They appear in PDF, Word (real page-number field) and web-page export, and in print on Chromium-based browsers (Chrome, Edge). With View → Show page gaps on, each page on screen shows its own header, footer and "Page n"; with it off the sheet is continuous and shows the header and footer once.

**Folders**: group documents in folders (home page chips; move via a document's action menu). Deleting a folder keeps its documents.

**Equations, footnotes, drawings, comments**: Insert → Equation (LaTeX, typeset with KaTeX, inline or display), Footnote (auto-numbered, notes listed at the end; exported as numbered notes), Drawing (freehand canvas saved as an image) and Comment (anchored to selected text; View → Comments panel to reply-resolve; comments are stripped from exports and copies).

**Password lock**: File → Lock with password encrypts a document's text and comments in this browser (PBKDF2-SHA256, 600,000 iterations → AES-256-GCM, fresh IV on every save). The title, dates and word count stay readable, a locked document is not searchable, its version history is deleted, and the password is never stored. **A forgotten password cannot be recovered.** Locked documents stay encrypted in backup files and can be unlocked after a restore. Unlocking lasts until you close the tab or use Lock now. Note that images, once decrypted into the editor, are ordinary page content; the lock protects data at rest, not a compromised browser.

**Languages**: English, Spanish, French, German, Portuguese and Hindi (picker in the home header; "Auto" follows the browser). The home page, lock screens, editor menus and common labels are translated; Spanish and French cover the most strings. Right-to-left layout (Arabic, Hebrew UI) is not built. Dialog bodies, toolbar tooltips, help and error messages are still English. Add a language by creating `src/i18n/<code>.js` (English text → translation) and listing it in `src/i18n/index.js`.

**Outline and find**: View → Outline lists the headings and jumps to them. Find and replace supports match case, whole word and regular expressions (replacement text can use `$1`).

**Diagnostics**: Help → Copy diagnostics copies a short environment report (browser, storage, counts) with no document titles or text, for bug reports.

**Two PDF formats**: *PDF document* draws each page as an image with an invisible text layer, so it looks exactly like the editor (including equations and Chinese/Japanese/Korean text). *PDF, text only* is a true text PDF: a few KB instead of megabytes, sharp at any zoom, fully selectable. It lays out text itself, so it is plainer than the editor: tables use equal column widths and rows never split, non-Latin text (Greek, Cyrillic, Hebrew, Arabic) uses one regular font, and Chinese/Japanese/Korean and typeset equations are not supported there.

**Image cropping**: select an image, then Format → Image: crop… to trim a percentage from each side with a live preview. Cropping permanently removes the trimmed pixels (Undo works right after); it is offered for embedded images, not linked web images.

**Document styles**: File → Document styles… sets the font, size, colour and weight for normal text and Headings 1–3 across the whole document, including every export format. Formatting you apply to selected text still takes precedence.

**Bookmarks**: Insert → Bookmark… names the paragraph or heading at the cursor; Insert → Link… then offers those bookmarks, and clicking such a link jumps there. Bookmark links work in exported HTML; in Word, PDF and the other formats the link text stays but the link is dropped.

**Captions**: Insert → Caption adds a numbered "Figure n:" / "Table n:" line under the selected image, the table you are in, or the current block; type the description after the colon.

**Also**: Insert → Special characters (symbols, arrows, math, Greek, currency, emoji); View → Focus mode (hides the toolbars, Esc to leave); table cell colours and merge/split; locked documents close themselves after 15 idle minutes (change under File → Auto-lock).

**Backup reminder**: the home page nudges you when you have never backed up, or the last backup is over two weeks old (snooze for a week).

**Paste cleaning**: Word and web HTML is sanitized, Word lists are converted to real lists, and junk styles are dropped.

**Import**: `.docx`, `.odt`, `.rtf`, `.txt`, `.md`/`.markdown`, `.html`. Unsupported features are reported in a notice. ODT keeps headings, lists, tables, links and bold/italic/underline (images and footnotes are skipped); RTF keeps text, basic formatting and alignment (lists become plain text lines, tables and images are dropped).

**Export**: `.docx`, `.pdf` (page image, or a smaller text-only version), `.html`, `.odt`, `.rtf`, `.epub` (e-book: one chapter per Heading 1, images embedded, remote images become their alt text), `.md`, `.txt`, plus Print. Equations are typeset in PDF, print and on screen, and exported as `$LaTeX$` text in Word, ODT, RTF and Markdown. A full JSON backup of all documents can be exported and restored from the home page.

**Page orientation and columns**: File → Page setup sets portrait or landscape and 1–3 text columns for the whole document. Orientation and columns apply in the editor, Print, Word, ODT, RTF and web-page export (checked by opening the files in LibreOffice); both PDF formats honour orientation, but PDF export uses a single column. With columns on, the editor hides the on-screen page gaps. Per-section changes (a landscape page in the middle of a portrait document) are not supported.

**Text direction**: Format → Text direction sets a paragraph or heading to right-to-left or left-to-right (Ctrl/Cmd+Shift+X toggles). Arabic, Hebrew and similar text lays out and aligns correctly, indents flip to the right margin, and the direction is kept in Word (`bidi`), ODT, RTF and the text PDF. The app's own interface is still left-to-right.

**Offline / PWA**: a service worker caches the app so it loads offline and can be installed.

**Accessibility**: an automated axe-core audit of the editor, dialogs and home page (light and dark) reports no WCAG 2.1 A/AA violations. Skip link, focus-trapped dialogs, ARIA menubar with arrow-key navigation, toolbar arrow-key navigation, live-region notifications, visible focus, reduced-motion respect.

## Privacy

- No analytics, tracking, or network requests with your content. Production CSP restricts what the page can load.
- Documents live in IndexedDB; preferences in localStorage. Clearing site data deletes them.
- Documents are stored unencrypted unless you lock them (File → Lock with password), and nothing syncs between devices. Use File → Download / Backup for copies.
- The browser may evict storage under pressure; Pagewise requests persistent storage but this can be denied. Back up important work.

## Security

- All HTML that did not come from the editor (imports, backups, pasted content, exported pages) goes through DOMPurify plus a CSS property allow-list and an image URL policy (https and raster `data:` images only). Scripts, event handlers, `javascript:` links, iframes, forms, SVG/MathML, `url()` in styles and fixed-position overlays are removed.
- A strict Content-Security-Policy is set in production builds (no inline script, no framing, no plugins). Exported `.html` files carry their own restrictive CSP.
- Backup restore validates structure, limits size and document count, and rejects unsafe ids.
- `tests/security.test.js` covers these rules, and a real-browser run with hostile `.html`/`.md` imports confirmed no script ran and no outside request was made.
- `npm audit --omit=dev` reports 0 vulnerabilities. The remaining notices (`deepmerge` inside `workbox-build`, `glob`/`minimatch`) are in build and test tooling and never ship in the site.

## Architecture

```
src/
  main.jsx            entry; mounts App, initialises PWA
  app/                App (hash router, error boundary), HomePage, EditorPage (autosave, menus, dialogs), actions
  components/         Dialog, MenuBar, Toolbar, EditorDialogs (link/image/table/find/page setup), Toasts, Logo, Icon
  editor/             Tiptap extensions (font size, paragraph format, page break, find/replace), paste cleaning, image handling
  io/                 import (mammoth, marked), export (docx, pdf, html, odt, rtf, md, txt), sanitize (DOMPurify), backup
  storage/            DocumentStore over IndexedDB (idb) with memory fallback, serial write queue, error classification; crypto.js (password lock)
  i18n/               translation layer and dictionaries
  settings/           localStorage preferences and theme
  pwa/                service worker registration and install prompt
  a11y/               focus trap and dismiss helpers
  styles/app.css      design tokens, themes, layout, print
tests/                vitest suites for editor, storage, import/export
```

Key design points:

- **Storage** is isolated in `DocumentStore`. Writes go through a serial queue so a rename cannot be overwritten by a stale autosave. If IndexedDB is unavailable, a memory store is used and the user is told that work will not persist.
- **Editor** is Tiptap 3 (ProseMirror). Content is stored as sanitized HTML plus derived plain text for search.
- **Dialogs that insert content** capture the selection when opened and re-apply it on confirm, because focus moves out of the editor.
- **Pages** are a continuous sheet with page-boundary guides; real pagination happens at print/PDF time.

### Dependencies

| Package | Why |
| --- | --- |
| react, react-dom | UI |
| @tiptap/* | rich-text editing on ProseMirror |
| idb | IndexedDB promises |
| docx | `.docx` export |
| mammoth | `.docx` import |
| marked, turndown (+gfm) | Markdown import/export |
| jspdf, html2canvas | PDF export |
| jszip | reading .docx packages (Word import formatting), writing .odt |
| katex | equation typesetting |
| dompurify | sanitising pasted/imported HTML |
| vite, vite-plugin-pwa | build, service worker |
| vitest, jsdom, fake-indexeddb | tests |

## Known limitations

- **PDF export** (the page-image format) draws each page as an image with an invisible text layer on top, so text can be selected, copied and searched: Latin, Greek, Cyrillic, Hebrew and Arabic use a bundled font (DejaVu Sans, loaded only when needed). Chinese, Japanese and Korean text looks right but is not selectable, and Arabic/Hebrew selection follows the stored character order. The file is larger than a text PDF: use "PDF, text only" for small files with true text, or Print → Save as PDF.
- **DOCX import** keeps structure (headings, lists, tables, images) and text formatting applied directly in Word: bold, italic, underline, colours, highlights, fonts, sizes and alignment. Formatting that only comes from Word *styles*, plus headers/footers, comments, tracked changes, columns and page layout, is dropped. **DOCX export** is an approximation of the on-screen layout.
- **Pages on screen** are kept from straddling the page edge (View → Show page gaps): paragraphs, lists and tables that fit on a page are moved whole to the next page. Blocks taller than a page still run across the edge, and print, PDF and Word export lay pages out on their own, so their breaks can differ slightly. Page numbers on screen follow the on-screen layout and can differ from the printed one.
- Documents and version history live only in this browser; backups are your copy.
- Voice typing is deliberately not included: browser speech recognition sends audio to an online service, which would break the no-upload promise.
- Equations and comments live in this browser; comments are not part of Word/PDF exports.
- Not built: sync and real-time collaboration.
- Browser storage quotas apply; large embedded images are downscaled to 1600 px.
- Mobile fit-to-width uses a reflow view because a full page would be unreadable at phone width.
- **Dependencies**: the project uses Tiptap 3.x (the 2.x line has advisory GHSA-cp6q-959q-f8rh). Full `npm audit` still lists a few findings in build/test tools (`deepmerge` in `workbox-build`, `glob`/`minimatch`); none ship in the site. Recheck after vite-plugin-pwa updates.

## Troubleshooting

- **Blank page on GitHub Pages**: Pages source must be "GitHub Actions", and the build must use the repo subpath (the workflow does this).
- **Old version after deploy**: the service worker updates automatically; reload once or twice.
- **"Storage unavailable" message**: private browsing or blocked site data. Work will not persist; export a copy.
- **Storage full**: delete documents or large images, or export a backup.

## License

MIT, see `LICENSE`. Change it if you prefer another.

## Third-party assets

- `public/fonts/DejaVuSans.ttf` (DejaVu Sans, Bitstream Vera / public-domain licence, see `public/fonts/DejaVu-LICENSE.txt`) is used only to make non-Latin PDF text selectable.
