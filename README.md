# Pagewise

A private, browser-based document editor. Everything runs in your browser and is stored on your device: no server, no account, no analytics, no uploads. It deploys as a plain static site (GitHub Pages ready).

Pagewise is an original project. It is not affiliated with Google, and files it exports are ordinary `.docx`/`.pdf`/`.html`/`.md`/`.txt` files, not native Google Docs.

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (vitest)
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

**Version history**: File → Version history keeps snapshots (taken when a document is opened, every ten minutes of editing, and on request, with optional names), previews them, and restores one. A restore first saves the text it replaces as "Before restore". Up to 40 automatic snapshots are kept per document; named ones are kept until deleted. Snapshots live in this browser only and are not part of the backup file.

**Templates and structure**: start from a template (letter, meeting notes, résumé, report, project plan) on the home page or File → New from template. Insert → Table of contents builds a contents list from Heading 1–3 and Update table of contents refreshes it (entries are not linked or page-numbered).

**Header, footer and page numbers**: File → Page setup. They appear in PDF, Word (real page-number field) and web-page export, and in print on Chromium-based browsers (Chrome, Edge). The on-screen sheet shows the header and footer but not page numbers, because it is one continuous sheet.

**Backup reminder**: the home page nudges you when you have never backed up, or the last backup is over two weeks old (snooze for a week).

**Paste cleaning**: Word and web HTML is sanitized, Word lists are converted to real lists, and junk styles are dropped.

**Import**: `.docx`, `.txt`, `.md`/`.markdown`, `.html`. Unsupported features are reported in a notice.

**Export**: `.docx`, `.pdf`, `.html`, `.md`, `.txt`, plus Print. A full JSON backup of all documents can be exported and restored from the home page.

**Offline / PWA**: a service worker caches the app so it loads offline and can be installed.

**Accessibility**: an automated axe-core audit of the editor, dialogs and home page (light and dark) reports no WCAG 2.1 A/AA violations. Skip link, focus-trapped dialogs, ARIA menubar with arrow-key navigation, toolbar arrow-key navigation, live-region notifications, visible focus, reduced-motion respect.

## Privacy

- No analytics, tracking, or network requests with your content. Production CSP restricts what the page can load.
- Documents live in IndexedDB; preferences in localStorage. Clearing site data deletes them.
- Nothing is encrypted at rest and nothing syncs between devices. Use File → Download / Backup for copies.
- The browser may evict storage under pressure; Pagewise requests persistent storage but this can be denied. Back up important work.

## Security

- All HTML that did not come from the editor (imports, backups, pasted content, exported pages) goes through DOMPurify plus a CSS property allow-list and an image URL policy (https and raster `data:` images only). Scripts, event handlers, `javascript:` links, iframes, forms, SVG/MathML, `url()` in styles and fixed-position overlays are removed.
- A strict Content-Security-Policy is set in production builds (no inline script, no framing, no plugins). Exported `.html` files carry their own restrictive CSP.
- Backup restore validates structure, limits size and document count, and rejects unsafe ids.
- `tests/security.test.js` covers these rules, and a real-browser run with hostile `.html`/`.md` imports confirmed no script ran and no outside request was made.
- Remaining `npm audit` notice: 4 *low* findings from `deepmerge` inside `workbox-build` (a build-time tool of vite-plugin-pwa). It has no fixed release and never ships in the site.

## Architecture

```
src/
  main.jsx            entry; mounts App, initialises PWA
  app/                App (hash router, error boundary), HomePage, EditorPage (autosave, menus, dialogs), actions
  components/         Dialog, MenuBar, Toolbar, EditorDialogs (link/image/table/find/page setup), Toasts, Logo, Icon
  editor/             Tiptap extensions (font size, paragraph format, page break, find/replace), paste cleaning, image handling
  io/                 import (mammoth, marked), export (docx, pdf, html, md, txt), sanitize (DOMPurify), backup
  storage/            DocumentStore over IndexedDB (idb) with memory fallback, serial write queue, error classification
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
| dompurify | sanitising pasted/imported HTML |
| vite, vite-plugin-pwa | build, service worker |
| vitest, jsdom, fake-indexeddb | tests |

## Known limitations

- **PDF export** draws each page as an image with an invisible text layer on top, so Latin-script text can be selected, copied and searched. Other scripts (e.g. Chinese, Arabic) are not in the text layer, and the file is larger than a vector PDF. For true vector text use Print → Save as PDF.
- **DOCX import** keeps structure (headings, lists, tables, bold/italic, images) but drops fonts, colours, headers/footers, comments, tracked changes and page layout. **DOCX export** is an approximation of the on-screen layout.
- Page counts are approximate; there is no true on-screen pagination, so page numbers appear only in print/PDF/Word/HTML output.
- Version history, like documents, lives only in this browser and is not included in backup files.
- Not built: comments, footnotes, drawings, equations, folders, encryption and sync.
- No real-time collaboration, sync, or encryption.
- Browser storage quotas apply; large embedded images are downscaled to 1600 px.
- Mobile fit-to-width uses a reflow view because a full page would be unreadable at phone width.
- **Tiptap 3**: the project uses Tiptap 3.x (the 2.x line has advisory GHSA-cp6q-959q-f8rh). `npm audit` still reports issues in dev-only tooling (vitest); these do not ship in the built site.

## Troubleshooting

- **Blank page on GitHub Pages**: Pages source must be "GitHub Actions", and the build must use the repo subpath (the workflow does this).
- **Old version after deploy**: the service worker updates automatically; reload once or twice.
- **"Storage unavailable" message**: private browsing or blocked site data. Work will not persist; export a copy.
- **Storage full**: delete documents or large images, or export a backup.

## License

Provide your own license before publishing.
