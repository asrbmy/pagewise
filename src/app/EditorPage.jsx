import { useT } from '../i18n/index.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { buildExtensions } from '../editor/extensions/index.js';
import { cleanPastedHtml } from '../editor/pasteClean.js';
import { fileToImageDataUrl, isImageFile } from '../editor/images.js';
import { PAGE_SIZES, PAGE_MARGIN, ZOOM_LEVELS } from '../editor/constants.js';
import { normalizeLayout, pageMarginRules, pageGeometry } from '../editor/layout.js';
import { normalizeStyles, stylesCss } from '../editor/styles.js';
import StylesDialog from '../components/StylesDialog.jsx';
import { normalizeComments, newCommentId, resolvedCss } from '../editor/comments.js';
import CommentsPanel from '../components/CommentsPanel.jsx';
import ChangesPanel from '../components/ChangesPanel.jsx';
import { trackKey } from '../editor/extensions/trackChanges.js';
import TemplateDialog from '../components/TemplateDialog.jsx';
import { store, AUTO_VERSION_INTERVAL } from '../storage/documents.js';
import CropDialog from '../components/CropDialog.jsx';
import DrawingDialog from '../components/DrawingDialog.jsx';
import VersionDialog from '../components/VersionDialog.jsx';
import { buildDiagnostics } from './diagnostics.js';
import OutlinePanel from '../components/OutlinePanel.jsx';
import BookmarkDialog from '../components/BookmarkDialog.jsx';
import SpecialCharsDialog from '../components/SpecialCharsDialog.jsx';
import LockDialog, { UnlockScreen } from '../components/LockDialog.jsx';
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
import { LinkDialog, ImageDialog, TableDialog, FindReplacePanel, PageSetupDialog, WordCountDialog, ShortcutsDialog, EquationDialog, FootnoteDialog, CommentDialog, atSelection } from '../components/EditorDialogs.jsx';
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

  if (state.status === 'ready' && state.doc.locked && !state.doc.unlocked) {
    return (
      <UnlockScreen
        doc={state.doc}
        onBack={goHome}
        onUnlock={async (pw) => {
          const doc = await store.unlockDocument(docId, pw);
          setState({ status: 'ready', doc });
        }}
      />
    );
  }
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
  const t = useT();
  const [locked, setLocked] = useState(!!doc.locked);
  const [focusMode, setFocusMode] = useState(false);
  const [pageSize, setPageSizeState] = useState(doc.pageSize || 'letter');
  const [layout, setLayout] = useState(() => normalizeLayout(doc.layout));
  const [docStyles, setDocStyles] = useState(() => normalizeStyles(doc.styles));
  const [comments, setCommentsState] = useState(() => normalizeComments(doc.comments));
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const commentsRef = useRef(comments);
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
        const saved = await store.saveDocument(doc.id, { html: editor.getHTML(), comments: commentsRef.current });
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

  const setComments = useCallback(
    (next) => {
      commentsRef.current = next;
      setCommentsState(next);
      markDirty();
    },
    [markDirty],
  );

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
    extensions: useMemo(() => buildExtensions({ placeholder: t('Start typing, or paste text from Word or a web page…') }), []),
    content: doc.html,
    editorProps: {
      attributes: {
        class: 'pw-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Document body',
        spellcheck: String(prefs.spellcheck),
      },
      handleDOMEvents: {
        click(_view, event) {
          const a = event.target instanceof Element ? event.target.closest('a[href^="#h-"], a[href^="#bm-"]') : null;
          if (!a) return false;
          event.preventDefault();
          const ref = a.getAttribute('href').slice(1);
          const target = ref.startsWith('bm-') ? document.querySelector(`[data-bookmark="${CSS.escape(ref.slice(3))}"]`) : document.getElementById(ref);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return true;
        },
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
  const page = pageGeometry(pageSize, layout);
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'pw-page-style';
    style.textContent = `@page { size: ${page.css}; margin: 1in; ${pageMarginRules(layout)} }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [page.css, layout]);
  const multiColumn = page.columns > 1;
  const suggesting = !!(editor && !editor.isDestroyed && trackKey.getState(editor.state)?.suggesting);

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
  const pageFurniture = prefs.pagination && !reflow && !multiColumn && (layout.header || layout.footer || layout.pageNumbers !== 'none');
  const sheetHeight = reflow ? Math.max(contentHeight, 480) : pages * page.height;

  // Tell the pagination plugin the page geometry; it is off in the phone reflow view.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setPagination({ enabled: prefs.pagination && !reflow && !multiColumn, pageHeight: page.height, margin: PAGE_MARGIN });
  }, [editor, prefs.pagination, reflow, multiColumn, page.height]);

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

  const lockNow = () =>
    leaveTo(() => {
      store.forgetKey(doc.id);
      goHome();
    });

  // Focus mode hides the chrome; Escape leaves it.
  useEffect(() => {
    document.body.classList.toggle('focus-mode', focusMode);
    if (!focusMode) return undefined;
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.dialog') && setFocusMode(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('focus-mode');
    };
  }, [focusMode]);

  // A locked document closes itself after a period without typing, clicking or touching.
  useEffect(() => {
    const minutes = prefs.autoLockMinutes;
    if (!locked || !minutes) return undefined;
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lockNow(), minutes * 60 * 1000);
    };
    const events = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, arm));
    };
  }, [locked, prefs.autoLockMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportAs = async (format) => {
    if (!editor || busyExport) return;
    setBusyExport(true);
    await save();
    const label = EXPORTERS[format].label;
    const pending = toast(`Preparing ${label}…`, { duration: 0 });
    try {
      const result = await exportAndDownload(format, { title, html: editor.getHTML(), pageSize, layout, styles: docStyles });
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
    const node = editor.state.selection.node;
    const math = type === 'equation' && node && node.type.name === 'math' ? node.attrs : null;
    const footnote = type === 'footnote' && node && node.type.name === 'footnote' ? node.attrs.note : null;
    const excerpt = type === 'comment' ? editor.state.doc.textBetween(from, to, ' ') : '';
    setDialog({ type, range: { from, to }, href: type === 'link' ? editor.getAttributes('link').href || '' : '', math, footnote, excerpt });
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
          label: t('File'),
          items: [
            { label: t('New document'), onSelect: newDocument },
            { label: t('New from template…'), onSelect: () => setDialog({ type: 'templates' }) },
            { label: t('All documents'), onSelect: () => leaveTo(goHome) },
            { label: t('Import file as new document…'), onSelect: () => importRef.current?.click() },
            { separator: true },
            { label: t('Make a copy'), onSelect: makeCopy },
            { label: t('Rename'), onSelect: () => titleRef.current?.focus() },
            ...(locked ? [] : [{ label: t('Version history…'), onSelect: () => setDialog({ type: 'versions' }) }]),
            ...(locked
              ? [
                  { label: t('Lock now'), onSelect: lockNow },
                  { label: `${t('Auto-lock after idle')}: ${prefs.autoLockMinutes ? t('{n} min', { n: prefs.autoLockMinutes }) : t('Off')}`, onSelect: () => setPrefs({ autoLockMinutes: ({ 0: 5, 5: 15, 15: 30, 30: 0 })[prefs.autoLockMinutes] ?? 15 }) },
                  { label: t('Remove password…'), onSelect: () => setDialog({ type: 'unlock' }) },
                ]
              : [{ label: t('Lock with password…'), onSelect: () => setDialog({ type: 'lock' }) }]),
            { label: t('Save now'), shortcut: `${MOD}S`, onSelect: () => saveNow(true) },
            { separator: true },
            { heading: t('Download as') },
            ...Object.entries(EXPORTERS).map(([id, ex]) => ({ label: ex.label, onSelect: () => exportAs(id), disabled: busyExport })),
            { separator: true },
            { label: t('Print / Save as PDF (selectable text)'), shortcut: `${MOD}P`, onSelect: () => window.print() },
            { label: t('Back up all documents…'), onSelect: async () => {
              try {
                const n = await downloadBackup(store);
                toast(`Backed up ${n} document${n === 1 ? '' : 's'}.`, { kind: 'success' });
              } catch (err) {
                toast(err.message, { kind: 'error' });
              }
            } },
            { separator: true },
            { label: t('Document styles…'), onSelect: () => setDialog({ type: 'styles' }) },
            { label: t('Page setup…'), onSelect: () => setDialog({ type: 'page' }) },
            { label: t('Delete document…'), onSelect: () => setDialog({ type: 'delete' }) },
          ],
        },
        {
          label: t('Edit'),
          items: [
            { label: t('Undo'), shortcut: `${MOD}Z`, onSelect: run('undo'), disabled: !editor.can().undo() },
            { label: t('Redo'), shortcut: `${MOD}Shift+Z`, onSelect: run('redo'), disabled: !editor.can().redo() },
            { separator: true },
            { label: t('Cut'), shortcut: `${MOD}X`, onSelect: () => { editor.commands.focus(); document.execCommand('cut'); } },
            { label: t('Copy'), shortcut: `${MOD}C`, onSelect: () => { editor.commands.focus(); document.execCommand('copy'); } },
            { label: t('Select all'), shortcut: `${MOD}A`, onSelect: run('selectAll') },
            { separator: true },
            { label: t('Find and replace…'), shortcut: `${MOD}F`, onSelect: openFind },
            { separator: true },
            { label: t('Suggesting mode'), checked: suggesting, onSelect: () => editor.commands.setSuggesting(!suggesting) },
            { label: t('Tracked changes panel'), checked: changesOpen, onSelect: () => { setChangesOpen(!changesOpen); setCommentsOpen(false); } },
            { label: t('Accept all changes'), onSelect: () => chain().resolveAllChanges(true).run() },
            { label: t('Reject all changes'), onSelect: () => chain().resolveAllChanges(false).run() },
            { separator: true },
            { label: t('Clear formatting'), shortcut: `${MOD}\\`, onSelect: () => chain().unsetAllMarks().unsetTextAlign().run() },
          ],
        },
        {
          label: t('View'),
          items: [
            { label: t('Zoom in'), onSelect: () => zoomStep(1) },
            { label: t('Zoom out'), onSelect: () => zoomStep(-1) },
            { label: t('Zoom to 100%'), onSelect: () => setZoomClamped(1) },
            { label: t('Fit to width'), checked: zoom === 'fit', onSelect: () => setZoomClamped('fit') },
            { separator: true },
            { heading: t('Theme') },
            { label: t('Light'), checked: prefs.theme === 'light', onSelect: () => setPrefs({ theme: 'light' }) },
            { label: t('Dark'), checked: prefs.theme === 'dark', onSelect: () => setPrefs({ theme: 'dark' }) },
            { label: t('Match system'), checked: prefs.theme === 'system', onSelect: () => setPrefs({ theme: 'system' }) },
            { separator: true },
            { label: t('Show page gaps (text never crosses a page edge)'), checked: prefs.pagination, onSelect: () => setPrefs({ pagination: !prefs.pagination }) },
            { label: t('Outline'), checked: outlineOpen, onSelect: () => setOutlineOpen(!outlineOpen) },
            { label: t('Comments panel'), checked: commentsOpen, onSelect: () => { setCommentsOpen(!commentsOpen); setChangesOpen(false); } },
            { label: t('Show status bar'), checked: prefs.showStatusBar, onSelect: () => setPrefs({ showStatusBar: !prefs.showStatusBar }) },
            { label: t('Focus mode (Esc to exit)'), onSelect: () => setFocusMode(true) },
            { label: t('Full screen'), onSelect: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) },
          ],
        },
        {
          label: t('Insert'),
          items: [
            { label: t('Link…'), shortcut: `${MOD}K`, onSelect: () => openInsertDialog('link') },
            { label: t('Image…'), onSelect: () => openInsertDialog('image') },
            { label: t('Caption (figure or table)'), onSelect: act(() => chain().insertCaption({ figure: t('Figure'), table: t('Table') }).run()) },
            { label: t('Table…'), onSelect: () => openInsertDialog('table') },
            { label: t('Equation…'), onSelect: () => openInsertDialog('equation') },
            { label: t('Edit selected equation…'), disabled: !(editor.state.selection.node && editor.state.selection.node.type.name === 'math'), onSelect: () => openInsertDialog('equation') },
            { label: t('Drawing…'), onSelect: () => openInsertDialog('drawing') },
            { label: t('Footnote…'), onSelect: () => openInsertDialog('footnote') },
            { label: t('Edit selected footnote…'), disabled: !(editor.state.selection.node && editor.state.selection.node.type.name === 'footnote'), onSelect: () => openInsertDialog('footnote') },
            { label: t('Comment…'), disabled: editor.state.selection.empty, onSelect: () => openInsertDialog('comment') },
            { separator: true },
            { label: t('Horizontal line'), onSelect: run('setHorizontalRule') },
            { label: t('Page break'), shortcut: `${MOD}Enter`, onSelect: run('setPageBreak') },
            { label: t('Bookmark…'), onSelect: () => openInsertDialog('bookmark') },
            { label: t('Special characters…'), onSelect: () => openInsertDialog('chars') },
            {
              label: t('Table of contents'),
              onSelect: () => {
                run('insertTableOfContents')();
                // the new contents block shifts later headings, so refresh the page numbers once laid out
                if (prefs.pagination) setTimeout(() => editor?.commands.updateTableOfContents(), 800);
              },
            },
            { label: t('Update table of contents'), onSelect: run('updateTableOfContents') },
            { label: t('Block quote'), checked: editor.isActive('blockquote'), onSelect: run('toggleBlockquote') },
          ],
        },
        {
          label: t('Format'),
          items: [
            { heading: t('Text') },
            { label: t('Bold'), shortcut: `${MOD}B`, checked: editor.isActive('bold'), onSelect: run('toggleBold') },
            { label: t('Italic'), shortcut: `${MOD}I`, checked: editor.isActive('italic'), onSelect: run('toggleItalic') },
            { label: t('Underline'), shortcut: `${MOD}U`, checked: editor.isActive('underline'), onSelect: run('toggleUnderline') },
            { label: t('Strikethrough'), shortcut: `${MOD}Shift+X`, checked: editor.isActive('strike'), onSelect: run('toggleStrike') },
            { label: t('Superscript'), checked: editor.isActive('superscript'), onSelect: run('toggleSuperscript') },
            { label: t('Subscript'), checked: editor.isActive('subscript'), onSelect: run('toggleSubscript') },
            { label: t('Code'), checked: editor.isActive('code'), onSelect: run('toggleCode') },
            { separator: true },
            { heading: t('Paragraph style') },
            { label: t('Normal text'), shortcut: `${MOD}Alt+0`, checked: !editor.isActive('heading'), onSelect: run('setParagraph') },
            ...[1, 2, 3, 4, 5, 6].map((l) => ({
              label: `Heading ${l}`,
              shortcut: `${MOD}Alt+${l}`,
              checked: editor.isActive('heading', { level: l }),
              onSelect: () => chain().setHeading({ level: l }).run(),
            })),
            { separator: true },
            { heading: t('Align') },
            ...['left', 'center', 'right', 'justify'].map((a) => ({
              label: `Align ${a}`,
              checked: editor.isActive({ textAlign: a }),
              onSelect: () => chain().setTextAlign(a).run(),
            })),
            { separator: true },
            { heading: t('Text direction') },
            {
              label: t('Left-to-right'),
              checked: editor.isActive({ dir: 'ltr' }),
              onSelect: () => chain().setTextDirection('ltr').run(),
            },
            {
              label: t('Right-to-left'),
              checked: editor.isActive({ dir: 'rtl' }),
              onSelect: () => chain().setTextDirection('rtl').run(),
            },
            { separator: true },
            { heading: t('Line spacing') },
            ...[['Single', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['Double', '2']].map(([label, v]) => ({
              label: `Line spacing: ${label}`,
              checked: paraAttrs.lineHeight === v,
              onSelect: () => chain().setLineHeight(v).run(),
            })),
            { label: t('Add space before paragraph'), onSelect: () => chain().setParagraphSpacing({ before: 12 }).run() },
            { label: t('Add space after paragraph'), onSelect: () => chain().setParagraphSpacing({ after: 12 }).run() },
            { label: t('Remove paragraph spacing'), onSelect: () => chain().setParagraphSpacing({ before: 0, after: 0 }).run() },
            { separator: true },
            { heading: t('Lists and indentation') },
            { label: t('Bulleted list'), shortcut: `${MOD}Shift+8`, checked: editor.isActive('bulletList'), onSelect: run('toggleBulletList') },
            { label: t('Numbered list'), shortcut: `${MOD}Shift+7`, checked: editor.isActive('orderedList'), onSelect: run('toggleOrderedList') },
            { label: t('Increase indent'), shortcut: `${MOD}]`, onSelect: run('indent') },
            { label: t('Decrease indent'), shortcut: `${MOD}[`, onSelect: run('outdent') },
            ...(isImageSelected
              ? [
                  { separator: true },
                  { heading: t('Selected image') },
                  ...['25%', '50%', '75%', '100%'].map((w) => ({ label: `Image width ${w}`, checked: imageWidth === w, onSelect: () => chain().updateAttributes('image', { width: w }).run() })),
                  ...(/^data:image\/(png|jpe?g|gif|webp)/i.test(editor?.getAttributes('image').src || '') ? [{ label: t('Image: crop…'), onSelect: () => setDialog({ type: 'crop', src: editor.getAttributes('image').src }) }] : []),
                  { label: t('Image: original size'), checked: !imageWidth, onSelect: () => chain().updateAttributes('image', { width: null }).run() },
                ]
              : []),
          ],
        },
        {
          label: t('Tools'),
          items: [
            { label: t('Word count…'), onSelect: () => setDialog({ type: 'count' }) },
            { label: t('Find and replace…'), shortcut: `${MOD}F`, onSelect: openFind },
            { separator: true },
            { label: t('Browser spell check'), checked: prefs.spellcheck, onSelect: () => setPrefs({ spellcheck: !prefs.spellcheck }) },
            { label: t('Page setup…'), onSelect: () => setDialog({ type: 'page' }) },
          ],
        },
        {
          label: t('Help'),
          items: [
            { label: t('Keyboard shortcuts'), onSelect: () => setDialog({ type: 'shortcuts' }) },
            { label: t('Privacy and storage'), onSelect: () => setDialog({ type: 'privacy' }) },
            { label: t('Install Pagewise as an app'), onSelect: promptInstall, disabled: !pwa.canInstall },
            { separator: true },
            {
              label: t('Copy diagnostics'),
              onSelect: async () => {
                try {
                  await navigator.clipboard.writeText(await buildDiagnostics());
                  toast(t('Diagnostics copied. They contain no document text or titles.'), { kind: 'success' });
                } catch {
                  toast(t('Could not copy to the clipboard.'), { kind: 'error' });
                }
              },
            },
            { label: t('About Pagewise'), onSelect: () => setDialog({ type: 'about' }) },
          ],
        },
      ];

  // ---------------------------------------------------------------- render

  const closeDialog = () => {
    setDialog(null);
    editor?.commands.focus();
  };

  const statusText = {
    saved: store.persistent ? t('Saved in this browser') : t('Not saved: session only'),
    dirty: t('Unsaved changes…'),
    saving: t('Saving…'),
    error: 'Could not save',
  }[saveState];
  const statusIcon = { saved: store.persistent ? 'cloudCheck' : 'cloudOff', dirty: 'pencil', saving: 'loader', error: 'alert' }[saveState];

  const cc = editor?.storage.characterCount;
  const sel = editor ? editor.state.selection : null;
  const selText = sel && sel.from !== sel.to ? editor.state.doc.textBetween(sel.from, sel.to, ' ') : '';
  const selWords = selText.trim() ? selText.trim().split(/\s+/).length : 0;

  return (
    <div className={`app-shell editor-shell ${reflow ? 'reflow' : ''}`} style={{ '--page-w': `${pageW}px`, '--page-h': `${page.height}px`, '--page-pad': reflow ? '20px' : '96px' }}>
      {focusMode && (
        <button type="button" className="btn btn-small focus-exit" onClick={() => setFocusMode(false)}>
          {t('Exit focus mode')}
        </button>
      )}
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
            <div className={`save-status save-${saveState}`} role="status" aria-live="polite" title={t('Last edited {when}', { when: formatFull(updatedAt) })}>
              <Icon name={statusIcon} size={16} />
              <span>{statusText}</span>
              {saveState === 'error' && (
                <button type="button" className="link-btn" onClick={() => saveNow(true)}>
                  Retry
                </button>
              )}
              <span className="last-edit">· {t('Last edit {when}', { when: formatModified(updatedAt) })}</span>
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
              data-columns={multiColumn && !reflow ? page.columns : undefined}
              style={{ minHeight: sheetHeight }}
              onMouseDown={(e) => {
                // clicking the margin / empty area below the text should still focus the document
                if (e.target === e.currentTarget) {
                  e.preventDefault();
                  editor?.commands.focus('end');
                }
              }}
            >
              {!pageFurniture && layout.header && <div className="sheet-furniture sheet-header" aria-hidden="true">{layout.header}</div>}
              <EditorContent editor={editor} />
              {!pageFurniture && layout.footer && <div className="sheet-furniture sheet-footer" aria-hidden="true">{layout.footer}</div>}
              {pageFurniture &&
                Array.from({ length: pages }, (_, i) => {
                  const n = `${t('Page')} ${i + 1}`;
                  const pos = layout.pageNumbers;
                  const merged = layout.footer && pos === 'center';
                  return (
                    <div key={i} className="page-furniture" aria-hidden="true" style={{ top: i * page.height, height: page.height }}>
                      {layout.header && <div className="pf-header">{layout.header}</div>}
                      <div className="pf-footer">
                        <span className="pf-left">{pos === 'left' ? n : ''}</span>
                        <span className="pf-center">{merged ? `${layout.footer} · ${n}` : layout.footer}</span>
                        <span className="pf-right">{pos === 'right' ? n : ''}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </main>

      {outlineOpen && editor && <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />}
      {changesOpen && editor && <ChangesPanel editor={editor} suggesting={suggesting} onToggleSuggesting={(on) => editor.commands.setSuggesting(on)} onClose={() => setChangesOpen(false)} />}
      {commentsOpen && editor && <CommentsPanel editor={editor} comments={comments} onChange={setComments} onClose={() => setCommentsOpen(false)} />}
      <style>{resolvedCss(comments)}</style>
      <style>{stylesCss(docStyles)}</style>

      {prefs.showStatusBar && (
        <footer className="statusbar" aria-label={t('Document status')}>
          <span>
            {selText ? t('{n} of {total} words selected', { n: selWords.toLocaleString(), total: (cc?.words() || 0).toLocaleString() }) : (cc?.words() || 0) === 1 ? t('{n} word', { n: 1 }) : t('{n} words', { n: (cc?.words() || 0).toLocaleString() })}
          </span>
          <span>{t('{n} characters', { n: (cc?.characters() || 0).toLocaleString() })}</span>
          <span>{reflow ? t('Reflow view') : `${pages === 1 ? t('{n} page', { n: 1 }) : t('{n} pages', { n: pages })} · ${pageSize === 'a4' ? 'A4' : 'Letter'}${page.landscape ? ` · ${t('landscape')}` : ''}${multiColumn ? ` · ${t('{n} columns', { n: page.columns })}` : ''}`}</span>
          {suggesting && <span className="suggesting-badge" role="status">{t('Suggesting')}</span>}
          <span className="spacer" />
          <span className="hide-small">{prefs.spellcheck ? t('Spell check on') : t('Spell check off')}</span>
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
      {dialog?.type === 'equation' && editor && <EquationDialog editor={editor} range={dialog.range} initial={dialog.math} editing={!!dialog.math} onClose={closeDialog} />}
      {dialog?.type === 'crop' && (
        <CropDialog
          src={dialog.src}
          onClose={closeDialog}
          onApply={(url) => {
            chain().updateAttributes('image', { src: url }).run();
            closeDialog();
          }}
        />
      )}
      {dialog?.type === 'styles' && (
        <StylesDialog
          styles={docStyles}
          onClose={closeDialog}
          onApply={async (next) => {
            setDocStyles(next);
            closeDialog();
            try {
              await store.saveDocument(doc.id, { styles: next });
            } catch (err) {
              toast(err.message, { kind: 'error' });
            }
          }}
        />
      )}
      {dialog?.type === 'bookmark' && editor && <BookmarkDialog editor={editor} range={dialog.range} onClose={closeDialog} />}
      {dialog?.type === 'chars' && editor && <SpecialCharsDialog editor={editor} range={dialog.range} onClose={closeDialog} />}
      {dialog?.type === 'footnote' && editor && <FootnoteDialog editor={editor} range={dialog.range} initial={dialog.footnote} editing={dialog.footnote !== null} onClose={closeDialog} />}
      {dialog?.type === 'comment' && editor && (
        <CommentDialog
          excerpt={dialog.excerpt}
          onClose={closeDialog}
          onSubmit={(text) => {
            const id = newCommentId();
            editor.chain().focus().setTextSelection(dialog.range).addCommentMark(id).run();
            setComments([...commentsRef.current, { id, text: text.trim(), createdAt: Date.now(), resolved: false }]);
            setCommentsOpen(true);
            closeDialog();
          }}
        />
      )}
      {dialog?.type === 'drawing' && editor && (
        <DrawingDialog
          onClose={closeDialog}
          onInsert={(src, alt) => {
            atSelection(editor, dialog.range).setImage({ src, alt }).run();
            closeDialog();
          }}
        />
      )}
      {dialog?.type === 'count' && editor && <WordCountDialog editor={editor} pages={pages} onClose={closeDialog} />}
      {dialog?.type === 'templates' && <TemplateDialog onPick={(id) => { closeDialog(); newFromTemplate(id); }} onClose={closeDialog} />}
      {dialog?.type === 'lock' && (
        <LockDialog
          onCancel={closeDialog}
          onSubmit={async (pw) => {
            if (!(await save())) throw new Error('Could not save the document before locking it.');
            await store.lockDocument(doc.id, pw);
            setLocked(true);
            closeDialog();
            toast('Document locked. It stays open until you close it or use File → Lock now.', { kind: 'success' });
          }}
        />
      )}
      {dialog?.type === 'unlock' && (
        <LockDialog
          mode="remove"
          onCancel={closeDialog}
          onSubmit={async (pw) => {
            await store.unlockDocument(doc.id, pw); // verifies the password
            await store.removeLock(doc.id);
            setLocked(false);
            closeDialog();
            toast('Password removed.', { kind: 'success' });
          }}
        />
      )}
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
