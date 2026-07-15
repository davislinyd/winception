import { useCallback, useEffect, useState } from 'react';
import { WINCEPTION_V2_VERSION, type DeploymentSnapshotResult, type OperationRecord, type SystemState } from '../../../packages/contracts/src/index.js';
import { FamiliarConsole, type ConnectionState } from './features/familiar/FamiliarConsole.js';
import { ActionPanel } from './features/actions/ActionPanel.js';
import { ProductControls } from './features/product/ProductControls.js';
import { api, ApiRequestError } from './shared/api.js';

export function App(): React.JSX.Element {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [state, setState] = useState<SystemState | null>(null);
  const [snapshot, setSnapshot] = useState<DeploymentSnapshotResult | null>(null);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [accepted, setAccepted] = useState<Array<{ id: string; label: string }>>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const refresh = useCallback(async (reason?: 'deployment-change'): Promise<void> => {
    try {
      const [nextState, nextOperations, nextSnapshot] = await Promise.all([api.state(), api.operations(), api.snapshot()]);
      setState(nextState);
      setOperations(nextOperations);
      setSnapshot(nextSnapshot);
      setAccepted((current) => current.filter((item) => !nextOperations.some((operation) => operation.id === item.id)));
      if (reason === 'deployment-change') setSnapshotStatus('Snapshot refreshed');
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
    const deploymentUpdate = (): void => { void refresh('deployment-change'); };
    source.onopen = () => setConnection('live');
    source.addEventListener('state.changed', update);
    source.addEventListener('operation.changed', update);
    source.addEventListener('deployment.changed', deploymentUpdate);
    source.onerror = () => { setConnection('reconnecting'); void refresh(); };
    return () => source.close();
  }, [authenticated, refresh]);

  if (authenticated === null) return <main className="centered"><p>Connecting to Winception…</p></main>;
  if (!authenticated) return <Login onSuccess={() => { setAuthenticated(true); void refresh(); }} onError={(caught) => setError(normalizeError(caught))} error={error} />;

  function run(label: string, action: () => Promise<unknown>): void {
    void action().then((value) => {
      if (typeof value === 'string') {
        setAccepted((current) => [{ id: value, label }, ...current.filter((item) => item.id !== value)]);
        setNotice(`${label} accepted as ${value}.`);
      } else setNotice(`${label} completed.`);
      void refresh();
    }).catch((caught) => setError(normalizeError(caught)));
  }

  return <div className="app-shell">
    {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
    {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
    <FamiliarConsole state={state} snapshot={snapshot} operations={operations} accepted={accepted} connection={connection} snapshotStatus={snapshotStatus} configurationControls={<><ProductControls onCompleted={(message) => { setNotice(message); void refresh(); }} onError={(caught) => setError(normalizeError(caught))} /><ActionPanel onCompleted={(message) => { setNotice(message); void refresh(); }} onError={(caught) => setError(normalizeError(caught))} /></>} onRefresh={() => { setConnection('connecting'); void refresh(); }} onRun={run} />
    <button className="sign-out-button secondary compact" onClick={() => { void api.logout().finally(() => setAuthenticated(false)); }}>Sign out</button>
    <ProductLegalNotice />
  </div>;
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
  return <div className="error-banner" role="alert"><div><strong>{error.message}</strong>{error.correctiveAction && <p>{error.correctiveAction}</p>}{error.conflicts.length > 0 && <p>Conflicting operations: {error.conflicts.map((conflict) => `${conflict.operationId}: ${conflict.label} (${conflict.resources.join(', ')})`).join('; ')}</p>}<small>Code {error.code}{error.correlationId ? ` · ${error.correlationId}` : ''}</small></div><button aria-label="Dismiss error" onClick={onClose}>×</button></div>;
}

function normalizeError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError('CLIENT_ERROR', 'The management request failed.', undefined, undefined, 0, []);
}
