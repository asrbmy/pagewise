import { Component, useEffect, useState } from 'react';
import { store } from '../storage/documents.js';
import { useTheme } from '../settings/theme.js';
import { ToastProvider, useToast } from '../components/Toasts.jsx';
import { usePwaState } from '../pwa/register.js';
import Logo from '../components/Logo.jsx';
import HomePage from './HomePage.jsx';
import EditorPage from './EditorPage.jsx';

/**
 * Hash routing (#/ and #/d/<id>) keeps the app a single static page: refreshing or deep-linking
 * never needs server rewrites, so it works from any GitHub Pages sub-path.
 */
export function parseRoute(hash) {
  const m = /^#\/d\/([^/?#]+)/.exec(hash || '');
  return m ? { name: 'editor', id: decodeURIComponent(m[1]) } : { name: 'home' };
}

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-state" role="alert">
        <Logo size={48} />
        <h1>Something went wrong</h1>
        <p>Pagewise hit an unexpected error. Documents that were already saved are still in this browser's storage.</p>
        <pre className="error-detail">{String(this.state.error.message || this.state.error)}</pre>
        <button type="button" className="btn btn-primary" onClick={() => { window.location.hash = '#/'; window.location.reload(); }}>
          Reload Pagewise
        </button>
      </div>
    );
  }
}

function Shell() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [ready, setReady] = useState(false);
  const toast = useToast();
  const pwa = usePwaState();
  useTheme();

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    store.init().then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (pwa.justReady) toast('Pagewise is cached and ready to work offline.', { kind: 'success' });
  }, [pwa.justReady, toast]);

  const skip = () => document.getElementById('main')?.focus();

  return (
    <>
      <button type="button" className="skip-link" onClick={skip}>
        Skip to content
      </button>
      {!ready ? (
        <div className="center-state" role="status">
          <Logo size={48} />
          <p>Opening your documents…</p>
        </div>
      ) : route.name === 'editor' ? (
        <EditorPage key={route.id} docId={route.id} />
      ) : (
        <HomePage />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </ErrorBoundary>
  );
}
