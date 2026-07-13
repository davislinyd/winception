import { useCallback, useEffect, useState } from 'react';
import { WINCEPTION_V2_VERSION, type OperationRecord, type SystemState } from '../../../packages/contracts/src/index.js';
import { ActionPanel } from './features/actions/ActionPanel.js';
import { Operations } from './features/operations/Operations.js';
import { Overview } from './features/overview/Overview.js';
import { ProductControls } from './features/product/ProductControls.js';
import { MonitorPanel } from './features/monitor/MonitorPanel.js';
import { api, ApiRequestError } from './shared/api.js';

export function App(): React.JSX.Element {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [state, setState] = useState<SystemState | null>(null);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextState, nextOperations] = await Promise.all([api.state(), api.operations()]);
      setState(nextState);
      setOperations(nextOperations);
      setAuthenticated(true);
      setError(null);
    }
    catch (caught) {
      const normalized = normalizeError(caught);
      if (normalized.status === 401) setAuthenticated(false);
      else setError(normalized);
    }
  }, []);

  useEffect(() => { void api.authStatus().then((status) => {
    setAuthenticated(status.authenticated);
    if (status.authenticated) void refresh();
  }).catch((caught) => setError(normalizeError(caught))); }, [refresh]);

  useEffect(() => {
    if (!authenticated) return undefined;
    const source = new EventSource('/api/v2/events', { withCredentials: true });
    const update = (): void => { void refresh(); };
    source.addEventListener('state.changed', update);
    source.addEventListener('operation.changed', update);
    source.onerror = () => { void refresh(); };
    return () => source.close();
  }, [authenticated, refresh]);

  if (authenticated === null) return <main className="centered"><p>Connecting to Winception…</p></main>;
  if (!authenticated) return <Login onSuccess={() => { setAuthenticated(true); void refresh(); }} onError={(caught) => setError(normalizeError(caught))} error={error} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><span className="brand-mark">W</span><div><strong>Winception</strong><small>{WINCEPTION_V2_VERSION}</small></div></div>
        <button className="secondary compact" onClick={() => { void api.logout().finally(() => setAuthenticated(false)); }}>Sign out</button>
      </header>
      <main>
        <div className="hero"><p className="eyebrow">Windows 11 zero-touch deployment</p><h1>Deployment control plane</h1><p>Every mutation is schema-validated, resource-locked, and delegated to the privileged Agent.</p></div>
        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
        {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
        {state ? <Overview state={state} /> : <p className="empty-state">State is temporarily unavailable.</p>}
        <MonitorPanel onCompleted={(message) => setNotice(message)} onError={(caught) => setError(normalizeError(caught))} />
        <ProductControls onCompleted={(message) => { setNotice(message); void refresh(); }} onError={(caught) => setError(normalizeError(caught))} />
        <ActionPanel onCompleted={(message) => { setNotice(message); void refresh(); }} onError={(caught) => setError(normalizeError(caught))} />
        <Operations operations={operations} />
      </main>
      <ProductLegalNotice />
    </div>
  );
}

function Login({ onSuccess, onError, error }: { onSuccess: () => void; onError: (error: unknown) => void; error: ApiRequestError | null }): React.JSX.Element {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try { await api.login(token); onSuccess(); }
    catch (caught) { onError(caught); }
    finally { setBusy(false); }
  }
  return (
    <main className="login-shell">
      <div className="login-stack">
        <form className="login-card" onSubmit={(event) => { void submit(event); }}>
          <span className="brand-mark large">W</span><p className="eyebrow">Local management</p><h1>Open Winception</h1>
          <p>Enter the setup code created by the signed installer.</p>
          {error && <ErrorBanner error={error} onClose={() => undefined} />}
          <label>Setup code<input type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} /></label>
          <button type="submit" disabled={busy || token.length < 32}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <ProductLegalNotice />
      </div>
    </main>
  );
}

function ProductLegalNotice(): React.JSX.Element {
  const releaseTag = `v${WINCEPTION_V2_VERSION}`;
  return (
    <footer className="legal-footer">
      <span>Copyright © 2026 Winception contributors · No warranty</span>
      <a href="/manual/">Documentation</a>
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL-3.0-only</a>
      <a href={`https://github.com/davislinyd/winception/tree/${releaseTag}`} target="_blank" rel="noreferrer">Release source</a>
    </footer>
  );
}

function ErrorBanner({ error, onClose }: { error: ApiRequestError; onClose: () => void }): React.JSX.Element {
  return <div className="error-banner" role="alert"><div><strong>{error.message}</strong>{error.correctiveAction && <p>{error.correctiveAction}</p>}<small>Code {error.code}{error.correlationId ? ` · ${error.correlationId}` : ''}</small></div><button aria-label="Dismiss error" onClick={onClose}>×</button></div>;
}

function normalizeError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError('CLIENT_ERROR', 'The management request failed.', undefined, undefined, 0);
}
