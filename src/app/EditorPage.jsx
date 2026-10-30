import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { buildExtensions } from '../editor/extensions/index.js';
import { cleanPastedHtml } from '../editor/pasteClean.js';
import { fileToImageDataUrl, isImageFile } from '../editor/images.js';
import { PAGE_SIZES, ZOOM_LEVELS } from '../editor/constants.js';
import { normalizeLayout, pageMarginRules } from '../editor/layout.js';
import TemplateDialog from '../components/TemplateDialog.jsx';
import { store, AUTO_VERSION_INTERVAL } from '../storage/documents.js';
import VersionDialog from '../components/VersionDialog.jsx';
import { exportAndDownload, EXPORTERS } from '../io/export.js';
import { downloadBackup } from '../io/backup.js';
import { IMPORT_ACCEPT } from '../io/import.js';
import { usePrefs, setPrefs } from '../settings/prefs.js';
import { usePwaState, promptInstall } from '../pwa/register.js';
import MenuBar from '../components/MenuBar.jsx';
import Toolbar, { MOD } from '../components/Toolbar.jsx';
import Icon from '../components/Icon.jsx';
import Logo from '../components/Logo.jsx';
import { ConfirmDialog } from '../components/Dialog.jsx';
import { useToast } from '../components/Toasts.jsx';
import { LinkDialog, ImageDialog, TableDialog, FindReplacePanel, PageSetupDialog, WordCountDialog, ShortcutsDialog } from '../components/EditorDialogs.jsx';
import { PrivacyDialog, AboutDialog } from '../components/InfoDialogs.jsx';
import { createNewDocument, createFromTemplate, importIntoNewDocument, openDocument, goHome } from './actions.js';
import { formatModified, formatFull } from './format.js';

const SAVE_DELAY = 700;

/** Loads the document, then mounts the editor surface (the editor needs its content up front). */
export default function EditorPage({ docId }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    store
      .getDocument(docId)
      .then((doc) => !cancelled && setState(doc ? { status: 'ready', doc } : { status: 'missing' }))
      .catch((err) => !cancelled && setState({ status: 'error', message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (state.status === 'ready') return <EditorSurface key={docId} doc={state.doc} />;

  return (
    <div className="center-state" role={state.status === 'error' ? 'alert' : 'status'}>
      <Logo size={48} />
      {state.status === 'loading' && <p>Opening document…</p>}
      {state.status === 'missing' && (
        <>
          <h1>Document not found</h1>
          <p>It may have been deleted, or it was created in a different browser or profile. Documents are stored only in the browser that created them.</p>
          <button type="button" className="btn btn-primary" onClick={goHome}>
            Back to all documents
          </button>
        </>
      )}
      {state.status === 'error' && (
        <>
          <h1>Couldn't open this document</h1>
          <p>{state.message}</p>
          <button type="button" className="btn btn-primary" onClick={goHome}>
            Back to all documents
          </button>
        </>
      )}
    </div>
  );
}

function EditorSurface({ doc }) {
  const toast = useToast();
  const prefs = usePrefs();
  const pwa = usePwaState();

  const [title, setTitle] = useState(doc.title);
  const [pageSize, setPageSizeState] = useState(doc.pageSize || 'letter');
  const [layout, setLayout] = useState(() => normalizeLayout(doc.layout));
  const [updatedAt, setUpdatedAt] = useState(doc.updatedAt);
  const [saveState, setSaveState] = useState('saved'); // saved | dirty | saving | error
  const [saveError, setSaveError] = useState('');
  const [zoom, setZoom] = useState(() => (window.innerWidth < 900 ? 'fit' : 1));
  const [canvasWidth, setCanvasWidth] = useState(1000);
  const [contentHeight, setContentHeight] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState('');
  const [busyExport, setBusyExport] = useState(false);

  const canvasRef = useRef(null);
  const importRef = useRef(null);
  const titleRef = useRef(null);
  const editorRef = useRef(null);
  const timer = useRef(null);
  const dirty = useRef(false);
  const version = useRef(0); // bumps on every edit
  const inflight = useRef(null);
  const titleSaved = useRef(doc.title);
  const lastSnapshot = useRef(Date.now());

  // ---------------------------------------------------------------- saving

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return true;
    if (inflight.current) {
      await inflight.current; // let the running save finish, then check again
      if (!dirty.current) return true;
    }
    clearTimeout(timer.current);
    if (!dirty.current) return true;
    const started = version.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        const saved = await store.saveDocument(doc.id, { html: editor.getHTML() });
        setUpdatedAt(saved.updatedAt);
        if (Date.now() - lastSnapshot.current >= AUTO_VERSION_INTERVAL) {
          lastSnapshot.current = Date.now();
          store.addVersion(doc.id, { html: saved.html, title: saved.title }).catch(() => {}); // best effort
        }
        if (version.current === started) {
          dirty.current = false;
          setSaveState('saved');
        } else {
          setSaveState('dirty');
          timer.current = setTimeout(save, SAVE_DELAY);
        }
        setSaveError('');
        return true;
      } catch (err) {
        setSaveState('error');
        setSaveError(err.message || 'Could not save.');
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [doc.id]);

  const markDirty = useCallback(() => {
    version.current += 1;
    dirty.current = true;
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY);
  }, [save]);

  const saveNow = useCallback(
    async (announce = true) => {
      const ok = await save();
      if (announce) toast(ok ? (store.persistent ? 'Saved in this browser.' : 'Saved for this session only: browser storage is unavailable.') : 'Could not save. See the warning in the header.', { kind: ok ? (store.persistent ? 'success' : 'warning') : 'error' });
      return ok;
    },
    [save, toast],
  );

  // Remember how the document looked when it was opened, so a session's edits can be rolled back.
  useEffect(() => {
    if (doc.text && doc.text.trim()) store.addVersion(doc.id, { html: doc.html, title: doc.title }).catch(() => {});
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush when the tab is hidden / page closes, warn about unsaved work.
  useEffect(() => {
    const flush = () => {
      if (dirty.current) save();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    const onBeforeUnload = (e) => {
      if (dirty.current || inflight.current || !store.persistent) {
        flush();
        if (dirty.current || inflight.current || !store.persistent) {
          e.preventDefault();
          e.returnValue = '';
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(timer.current);
      if (dirty.current) save(); // leaving the editor inside the app: persist right away
    };
  }, [save]);

  // ---------------------------------------------------------------- editor

  const insertImages = useCallback(
    async (files, pos) => {
      const editor = editorRef.current;
      for (const file of files) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { src } = await fileToImageDataUrl(file);
          const chain = editor.chain().focus();
          if (pos != null) chain.insertContentAt(pos, { type: 'image', attrs: { src, alt: file.name || '' } }).run();
          else chain.setImage({ src, alt: file.name || '' }).run();
        } catch (err) {
          toast(err.message, { kind: 'error' });
        }
      }
    },
    [toast],
  );

  const editor = useEditor({
    // Tiptap 3 stops re-rendering on every transaction by default; the toolbar, find panel and counts rely on it.
    shouldRerenderOnTransaction: true,
    immediatelyRender: true,
    extensions: useMemo(() => buildExtensions({ placeholder: 'Start typing, or paste text from Word or a web page…' }), []),
    content: doc.html,
    editorProps: {
      attributes: {
        class: 'pw-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Document body',
        spellcheck: String(prefs.spellcheck),
      },
      transformPastedHTML: cleanPastedHtml,
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || []).filter(isImageFile);
        if (!files.length) return false;
        event.preventDefault();
        insertImages(files);
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files || []).filter(isImageFile);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertImages(files, at ? at.pos : null);
        return true;
      },
    },
    onUpdate: () => markDirty(),
  });
  editorRef.current = editor;

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dom.setAttribute('spellcheck', String(prefs.spellcheck));
  }, [editor, prefs.spellcheck]);

  // Page size drives print layout (@page) and zoom maths.
  const page = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'pw-page-style';
    style.textContent = `@page { size: ${page.css}; margin: 1in; ${pageMarginRules(layout)} }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [page.css, layout]);

  // Measure the canvas and the document body.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setCanvasWidth(el.clientWidth));
    ro.observe(el);
    setCanvasWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed || typeof ResizeObserver === 'undefined') return undefined;
    const dom = editor.view.dom;
    const ro = new ResizeObserver(() => setContentHeight(dom.offsetHeight));
    ro.observe(dom);
    setContentHeight(dom.offsetHeight);
    return () => ro.disconnect();
  }, [editor]);

  // On narrow screens "Fit width" reflows the text to the screen (readable) instead of shrinking the
  // whole page to a thumbnail. Choose a fixed zoom level to see the true page layout on a phone.
  const reflow = zoom === 'fit' && canvasWidth < 700;
  const pageW = reflow ? Math.max(280, canvasWidth - 16) : page.width;
  const zoomValue = reflow ? 1 : zoom === 'fit' ? Math.max(0.3, Math.min(2, (canvasWidth - 32) / page.width)) : zoom;
  const pages = Math.max(1, Math.ceil((contentHeight - 4) / page.height));
  const sheetHeight = reflow ? Math.max(contentHeight, 480) : pages * page.height;

  const setZoomClamped = (z) => setZoom(z === 'fit' ? 'fit' : Math.min(2, Math.max(0.25, z)));
  const zoomStep = (dir) => {
    const levels = ZOOM_LEVELS.map((l) => l.value).filter((v) => v !== 'fit');
    const cur = zoomValue;
    const next = dir > 0 ? levels.find((l) => l > cur + 0.001) : [...levels].reverse().find((l) => l < cur - 0.001);
    if (next) setZoom(next);
  };

  // ---------------------------------------------------------------- title

  const commitTitle = async () => {
    const next = title.trim() || 'Untitled document';
    setTitle(next);
    if (next === titleSaved.current) return;
    try {
      const saved = await store.renameDocument(doc.id, next);
      titleSaved.current = saved.title;
      setUpdatedAt(saved.updatedAt);
    } catch (err) {
      toast(err.message || 'Could not rename the document.', { kind: 'error' });
      setTitle(titleSaved.current);
    }
  };

  useEffect(() => {
    document.title = `${title || 'Untitled document'} – Pagewise`;
    return () => {
      document.title = 'Pagewise';
    };
  }, [title]);

  // ---------------------------------------------------------------- navigation & actions

  /** Save before leaving; if saving fails, let the user decide. */
  const leaveTo = useCallback(
    async (go) => {
      const ok = await save();
      if (ok) go();
      else setDialog({ type: 'leave-unsaved', go });
    },
    [save],
  );

  const exportAs = async (format) => {
    if (!editor || busyExport) return;
    setBusyExport(true);
    await save();
    const label = EXPORTERS[format].label;
    const pending = toast(`Preparing ${label}…`, { duration: 0 });
    try {
      const result = await exportAndDownload(format, { title, html: editor.getHTML(), pageSize, layout });
      toast.dismiss(pending);
      toast(`Downloaded ${result.filename}`, { kind: result.warnings.length ? 'warning' : 'success', details: result.warnings });
    } catch (err) {
      toast.dismiss(pending);
      toast(`Export failed: ${err.message || 'unknown error'}`, { kind: 'error' });
    } finally {
      setBusyExport(false);
    }
  };

  const makeCopy = async () => {
    if (!(await save())) return;
    try {
      const copy = await store.duplicateDocument(doc.id);
      toast(`Created "${copy.title}".`, { kind: 'success' });
      openDocument(copy.id);
    } catch (err) {
      toast(err.message, { kind: 'error' });
    }
  };

  const newDocument = () =>
    leaveTo(async () => {
      try {
        openDocument((await createNewDocument()).id);
      } catch (err) {
        toast(err.message, { kind: 'error' });
      }
    });

  const newFromTemplate = (id) =>
    leaveTo(async () => {
      try {
        openDocument((await createFromTemplate(id)).id);
      } catch (err) {
        toast(err.message, { kind: 'error' });
      }
    });

  const importFromMenu = async (file) => {
    if (!file) return;
    try {
      await save();
      const { doc: created, warnings } = await importIntoNewDocument(file);
      toast(`Imported "${created.title}" as a new document.`, { kind: warnings.length ? 'warning' : 'success', details: warnings });
      openDocument(created.id);
    } catch (err) {
      toast(err.message || 'Import failed.', { kind: 'error' });
    }
  };

  const deleteDoc = async () => {
    try {
      dirty.current = false;
      clearTimeout(timer.current);
      await store.deleteDocument(doc.id);
      toast(`Deleted "${title}".`, { kind: 'success' });
      goHome();
    } catch (err) {
      toast(err.message, { kind: 'error' });
    }
  };

  /** Open an insert dialog, remembering the selection: focus moves into the dialog and the
   *  browser may alter the editor's selection while it is open. */
  const openInsertDialog = (type) => {
    // Let ProseMirror absorb any selection change the browser has made but not yet reported.
    try { editor.view.domObserver.flush(); } catch { /* internal API; best effort */ }
    const { from, to } = editor.state.selection;
    setDialog({ type, range: { from, to }, href: type === 'link' ? editor.getAttributes('link').href || '' : '' });
  };

  const openFind = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const sel = from !== to ? editor.state.doc.textBetween(from, to, ' ') : '';
    setFindSeed(sel && sel.length < 80 && !sel.includes('\n') ? sel : '');
    setFindOpen(true);
  };

  const closeFind = () => {
    setFindOpen(false);
    editor?.commands.focus();
  };

  // Document-level shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        saveNow(true);
      } else if (k === 'f' && !e.shiftKey) {
        e.preventDefault();
        openFind();
      } else if (k === 'k' && !e.shiftKey) {
        e.preventDefault();
        openInsertDialog('link');
      } else if (k === 'p') {
        e.preventDefault();
        window.print();
      } else if (k === '\\') {
        e.preventDefault();
        editor?.chain().focus().unsetAllMarks().unsetTextAlign().run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- menus

  const chain = () => editor.chain().focus();
  const act = (fn) => () => editor && fn(editor);
  const run = (cmd) => act((e) => chain()[cmd]().run());
  const paraAttrs = editor ? editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph') : {};
  const isImageSelected = editor?.isActive('image');
  const imageWidth = editor?.getAttributes('image').width;

  const menus = !editor
    ? []
    : [
        {
          label: 'File',
          items: [
            { label: 'New document', onSelect: newDocument },
            { label: 'New from template…', onSelect: () => setDialog({ type: 'templates' }) },
            { label: 'All documents', onSelect: () => leaveTo(goHome) },
            { label: 'Import file as new document…', onSelect: () => importRef.current?.click() },
            { separator: true },
            { label: 'Make a copy', onSelect: makeCopy },
            { label: 'Rename', onSelect: () => titleRef.current?.focus() },
            { label: 'Version history…', onSelect: () => setDialog({ type: 'versions' }) },
            { label: 'Save now', shortcut: `${MOD}S`, onSelect: () => saveNow(true) },
            { separator: true },
            { heading: 'Download as' },
            ...Object.entries(EXPORTERS).map(([id, ex]) => ({ label: ex.label, onSelect: () => exportAs(id), disabled: busyExport })),
            { separator: true },
            { label: 'Print / Save as PDF (selectable text)', shortcut: `${MOD}P`, onSelect: () => window.print() },
            { label: 'Back up all documents…', onSelect: async () => {
              try {
                const n = await downloadBackup(store);
                toast(`Backed up ${n} document${n === 1 ? '' : 's'}.`, { kind: 'success' });
              } catch (err) {
                toast(err.message, { kind: 'error' });
              }
            } },
            { separator: true },
            { label: 'Page setup…', onSelect: () => setDialog({ type: 'page' }) },
            { label: 'Delete document…', onSelect: () => setDialog({ type: 'delete' }) },
          ],
        },
        {
          label: 'Edit',
          items: [
            { label: 'Undo', shortcut: `${MOD}Z`, onSelect: run('undo'), disabled: !editor.can().undo() },
            { label: 'Redo', shortcut: `${MOD}Shift+Z`, onSelect: run('redo'), disabled: !editor.can().redo() },
            { separator: true },
            { label: 'Cut', shortcut: `${MOD}X`, onSelect: () => { editor.commands.focus(); document.execCommand('cut'); } },
            { label: 'Copy', shortcut: `${MOD}C`, onSelect: () => { editor.commands.focus(); document.execCommand('copy'); } },
            { label: 'Select all', shortcut: `${MOD}A`, onSelect: run('selectAll') },
            { separator: true },
            { label: 'Find and replace…', shortcut: `${MOD}F`, onSelect: openFind },
            { label: 'Clear formatting', shortcut: `${MOD}\\`, onSelect: () => chain().unsetAllMarks().unsetTextAlign().run() },
          ],
        },
        {
          label: 'View',
          items: [
            { label: 'Zoom in', onSelect: () => zoomStep(1) },
            { label: 'Zoom out', onSelect: () => zoomStep(-1) },
            { label: 'Zoom to 100%', onSelect: () => setZoomClamped(1) },
            { label: 'Fit to width', checked: zoom === 'fit', onSelect: () => setZoomClamped('fit') },
            { separator: true },
            { heading: 'Theme' },
            { label: 'Light', checked: prefs.theme === 'light', onSelect: () => setPrefs({ theme: 'light' }) },
            { label: 'Dark', checked: prefs.theme === 'dark', onSelect: () => setPrefs({ theme: 'dark' }) },
            { label: 'Match system', checked: prefs.theme === 'system', onSelect: () => setPrefs({ theme: 'system' }) },
            { separator: true },
            { label: 'Show status bar', checked: prefs.showStatusBar, onSelect: () => setPrefs({ showStatusBar: !prefs.showStatusBar }) },
            { label: 'Full screen', onSelect: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) },
          ],
        },
        {
          label: 'Insert',
          items: [
            { label: 'Link…', shortcut: `${MOD}K`, onSelect: () => openInsertDialog('link') },
            { label: 'Image…', onSelect: () => openInsertDialog('image') },
            { label: 'Table…', onSelect: () => openInsertDialog('table') },
            { separator: true },
            { label: 'Horizontal line', onSelect: run('setHorizontalRule') },
            { label: 'Page break', shortcut: `${MOD}Enter`, onSelect: run('setPageBreak') },
            { label: 'Table of contents', onSelect: run('insertTableOfContents') },
            { label: 'Update table of contents', onSelect: run('updateTableOfContents') },
            { label: 'Block quote', checked: editor.isActive('blockquote'), onSelect: run('toggleBlockquote') },
          ],
        },
        {
          label: 'Format',
          items: [
            { heading: 'Text' },
            { label: 'Bold', shortcut: `${MOD}B`, checked: editor.isActive('bold'), onSelect: run('toggleBold') },
            { label: 'Italic', shortcut: `${MOD}I`, checked: editor.isActive('italic'), onSelect: run('toggleItalic') },
            { label: 'Underline', shortcut: `${MOD}U`, checked: editor.isActive('underline'), onSelect: run('toggleUnderline') },
            { label: 'Strikethrough', shortcut: `${MOD}Shift+X`, checked: editor.isActive('strike'), onSelect: run('toggleStrike') },
            { label: 'Superscript', checked: editor.isActive('superscript'), onSelect: run('toggleSuperscript') },
            { label: 'Subscript', checked: editor.isActive('subscript'), onSelect: run('toggleSubscript') },
            { label: 'Code', checked: editor.isActive('code'), onSelect: run('toggleCode') },
            { separator: true },
            { heading: 'Paragraph style' },
            { label: 'Normal text', shortcut: `${MOD}Alt+0`, checked: !editor.isActive('heading'), onSelect: run('setParagraph') },
            ...[1, 2, 3, 4, 5, 6].map((l) => ({
              label: `Heading ${l}`,
              shortcut: `${MOD}Alt+${l}`,
              checked: editor.isActive('heading', { level: l }),
              onSelect: () => chain().setHeading({ level: l }).run(),
            })),
            { separator: true },
            { heading: 'Align' },
            ...['left', 'center', 'right', 'justify'].map((a) => ({
              label: `Align ${a}`,
              checked: editor.isActive({ textAlign: a }),
              onSelect: () => chain().setTextAlign(a).run(),
            })),
            { separator: true },
            { heading: 'Line spacing' },
            ...[['Single', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['Double', '2']].map(([label, v]) => ({
              label: `Line spacing: ${label}`,
              checked: paraAttrs.lineHeight === v,
              onSelect: () => chain().setLineHeight(v).run(),
            })),
            { label: 'Add space before paragraph', onSelect: () => chain().setParagraphSpacing({ before: 12 }).run() },
            { label: 'Add space after paragraph', onSelect: () => chain().setParagraphSpacing({ after: 12 }).run() },
            { label: 'Remove paragraph spacing', onSelect: () => chain().setParagraphSpacing({ before: 0, after: 0 }).run() },
            { separator: true },
            { heading: 'Lists and indentation' },
            { label: 'Bulleted list', shortcut: `${MOD}Shift+8`, checked: editor.isActive('bulletList'), onSelect: run('toggleBulletList') },
            { label: 'Numbered list', shortcut: `${MOD}Shift+7`, checked: editor.isActive('orderedList'), onSelect: run('toggleOrderedList') },
            { label: 'Increase indent', shortcut: `${MOD}]`, onSelect: run('indent') },
            { label: 'Decrease indent', shortcut: `${MOD}[`, onSelect: run('outdent') },
            ...(isImageSelected
              ? [
                  { separator: true },
                  { heading: 'Selected image' },
                  ...['25%', '50%', '75%', '100%'].map((w) => ({ label: `Image width ${w}`, checked: imageWidth === w, onSelect: () => chain().updateAttributes('image', { width: w }).run() })),
                  { label: 'Image: original size', checked: !imageWidth, onSelect: () => chain().updateAttributes('image', { width: null }).run() },
                ]
              : []),
          ],
        },
        {
          label: 'Tools',
          items: [
            { label: 'Word count…', onSelect: () => setDialog({ type: 'count' }) },
            { label: 'Find and replace…', shortcut: `${MOD}F`, onSelect: openFind },
            { separator: true },
            { label: 'Browser spell check', checked: prefs.spellcheck, onSelect: () => setPrefs({ spellcheck: !prefs.spellcheck }) },
            { label: 'Page setup…', onSelect: () => setDialog({ type: 'page' }) },
          ],
        },
        {
          label: 'Help',
          items: [
            { label: 'Keyboard shortcuts', onSelect: () => setDialog({ type: 'shortcuts' }) },
            { label: 'Privacy and storage', onSelect: () => setDialog({ type: 'privacy' }) },
            { label: 'Install Pagewise as an app', onSelect: promptInstall, disabled: !pwa.canInstall },
            { separator: true },
            { label: 'About Pagewise', onSelect: () => setDialog({ type: 'about' }) },
          ],
        },
      ];

  // ---------------------------------------------------------------- render

  const closeDialog = () => {
    setDialog(null);
    editor?.commands.focus();
  };

  const statusText = {
    saved: store.persistent ? 'Saved in this browser' : 'Not saved: session only',
    dirty: 'Unsaved changes…',
    saving: 'Saving…',
    error: 'Could not save',
  }[saveState];
  const statusIcon = { saved: store.persistent ? 'cloudCheck' : 'cloudOff', dirty: 'pencil', saving: 'loader', error: 'alert' }[saveState];

  const cc = editor?.storage.characterCount;
  const sel = editor ? editor.state.selection : null;
  const selText = sel && sel.from !== sel.to ? editor.state.doc.textBetween(sel.from, sel.to, ' ') : '';
  const selWords = selText.trim() ? selText.trim().split(/\s+/).length : 0;

  return (
    <div className={`app-shell editor-shell ${reflow ? 'reflow' : ''}`} style={{ '--page-w': `${pageW}px`, '--page-h': `${page.height}px`, '--page-pad': reflow ? '20px' : '96px' }}>
      <header className="topbar">
        <button type="button" className="home-link" onClick={() => leaveTo(goHome)} aria-label="Back to all documents" title="All documents">
          <Logo size={34} />
        </button>
        <div className="title-block">
          <input
            ref={titleRef}
            className="title-input"
            value={title}
            aria-label="Document title"
            maxLength={200}
            spellCheck={false}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
                editor?.commands.focus();
              } else if (e.key === 'Escape') {
                setTitle(titleSaved.current);
                e.currentTarget.blur();
              }
            }}
          />
          <div className="menu-row">
            <MenuBar menus={menus} />
            <div className={`save-status save-${saveState}`} role="status" aria-live="polite" title={`Last edited ${formatFull(updatedAt)}`}>
              <Icon name={statusIcon} size={16} />
              <span>{statusText}</span>
              {saveState === 'error' && (
                <button type="button" className="link-btn" onClick={() => saveNow(true)}>
                  Retry
                </button>
              )}
              <span className="last-edit">· Last edit {formatModified(updatedAt)}</span>
            </div>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-btn" aria-label="Privacy and storage" title="Privacy and storage" onClick={() => setDialog({ type: 'privacy' })}>
            <Icon name="shield" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Switch theme (now ${prefs.theme})`}
            title="Switch theme"
            onClick={() => setPrefs({ theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark' })}
          >
            <Icon name={document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      {saveState === 'error' && (
        <div className="banner banner-error" role="alert">
          <Icon name="alert" /> {saveError} Your latest changes are not stored yet. Keep this tab open and use <strong>File → Download as</strong> to keep a copy.
        </div>
      )}
      {!store.persistent && saveState !== 'error' && (
        <div className="banner banner-warn" role="status">
          <Icon name="alert" /> Browser storage is unavailable, so this document only lives in this tab. Download a copy before closing.
        </div>
      )}

      <Toolbar
        editor={editor}
        zoom={zoom}
        onZoom={setZoomClamped}
        onLink={() => openInsertDialog('link')}
        onImage={() => openInsertDialog('image')}
        onTable={() => openInsertDialog('table')}
        onPrint={() => window.print()}
      />

      <main className="canvas" ref={canvasRef} id="main" tabIndex={-1}>
        {findOpen && editor && <FindReplacePanel editor={editor} initialTerm={findSeed} onClose={closeFind} />}
        <div className="sheet-wrap" style={{ width: pageW * zoomValue, height: sheetHeight * zoomValue }}>
          <div className="sheet-scaler" style={{ width: pageW, transform: `scale(${zoomValue})` }}>
            <div
              className="sheet"
              style={{ minHeight: sheetHeight }}
              onMouseDown={(e) => {
                // clicking the margin / empty area below the text should still focus the document
                if (e.target === e.currentTarget) {
                  e.preventDefault();
                  editor?.commands.focus('end');
                }
              }}
            >
              {layout.header && <div className="sheet-furniture sheet-header" aria-hidden="true">{layout.header}</div>}
              <EditorContent editor={editor} />
              {layout.footer && <div className="sheet-furniture sheet-footer" aria-hidden="true">{layout.footer}</div>}
            </div>
          </div>
        </div>
      </main>

      {prefs.showStatusBar && (
        <footer className="statusbar" aria-label="Document status">
          <span>
            {selText ? `${selWords.toLocaleString()} of ${(cc?.words() || 0).toLocaleString()} words selected` : `${(cc?.words() || 0).toLocaleString()} words`}
          </span>
          <span>{(cc?.characters() || 0).toLocaleString()} characters</span>
          <span>{reflow ? 'Reflow view' : `${pages} page${pages === 1 ? '' : 's'} · ${pageSize === 'a4' ? 'A4' : 'Letter'}`}</span>
          <span className="spacer" />
          <span className="hide-small">{prefs.spellcheck ? 'Spell check on' : 'Spell check off'}</span>
          <span>{Math.round(zoomValue * 100)}%</span>
        </footer>
      )}

      <input
        ref={importRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          importFromMenu(e.target.files[0]);
          e.target.value = '';
        }}
      />

      {dialog?.type === 'link' && editor && <LinkDialog editor={editor} range={dialog.range} href={dialog.href} onClose={closeDialog} />}
      {dialog?.type === 'image' && editor && <ImageDialog editor={editor} range={dialog.range} onClose={closeDialog} notify={toast} />}
      {dialog?.type === 'table' && editor && <TableDialog editor={editor} range={dialog.range} onClose={closeDialog} />}
      {dialog?.type === 'count' && editor && <WordCountDialog editor={editor} pages={pages} onClose={closeDialog} />}
      {dialog?.type === 'templates' && <TemplateDialog onPick={(id) => { closeDialog(); newFromTemplate(id); }} onClose={closeDialog} />}
      {dialog?.type === 'versions' && editor && (
        <VersionDialog
          store={store}
          docId={doc.id}
          title={title}
          notify={toast}
          flush={async () => {
            await save();
            return editor.getHTML();
          }}
          onRestore={(restored) => {
            editor.commands.setContent(restored.html, { emitUpdate: false });
            version.current += 1;
            dirty.current = false;
            setUpdatedAt(restored.updatedAt);
            setSaveState('saved');
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'shortcuts' && <ShortcutsDialog onClose={closeDialog} />}
      {dialog?.type === 'privacy' && <PrivacyDialog onClose={closeDialog} />}
      {dialog?.type === 'about' && <AboutDialog onClose={closeDialog} />}
      {dialog?.type === 'page' && (
        <PageSetupDialog
          pageSize={pageSize}
          layout={layout}
          onClose={closeDialog}
          onApply={async (size, asDefault, nextLayout) => {
            setPageSizeState(size);
            setLayout(nextLayout);
            if (asDefault) setPrefs({ pageSize: size });
            try {
              await store.saveDocument(doc.id, { pageSize: size, layout: nextLayout });
            } catch (err) {
              toast(err.message, { kind: 'error' });
            }
          }}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Delete this document?"
          message={`"${title}" will be permanently removed from this browser. This cannot be undone. Download a copy first if you might need it.`}
          confirmLabel="Delete"
          danger
          onCancel={closeDialog}
          onConfirm={deleteDoc}
        />
      )}
      {dialog?.type === 'leave-unsaved' && (
        <ConfirmDialog
          title="Leave without saving?"
          message="The latest changes could not be saved to browser storage. If you leave now they will be lost."
          confirmLabel="Leave anyway"
          danger
          onCancel={closeDialog}
          onConfirm={() => {
            dirty.current = false;
            dialog.go();
          }}
        />
      )}
    </div>
  );
}
