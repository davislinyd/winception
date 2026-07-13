import { useState } from 'react';
import type { DeploymentSnapshotResult, DiagnosticsResult } from '../../../../../packages/contracts/src/index.js';
import { api } from '../../shared/api.js';

export function MonitorPanel({ onCompleted, onError }: { onCompleted: (message: string) => void; onError: (error: unknown) => void }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DeploymentSnapshotResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      const [nextSnapshot, nextDiagnostics] = await Promise.all([api.snapshot(selectedRunId.trim() || undefined), api.diagnostics()]);
      setSnapshot(nextSnapshot);
      setDiagnostics(nextDiagnostics);
      onCompleted('Deployment monitor refreshed.');
    }
    catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  const state = objectValue(snapshot);
  const fleet = objectValue(state.fleet);
  const runs = arrayValue(fleet.runs);
  const preflight = arrayValue(state.preflight);

  return <section aria-labelledby="monitor-title">
    <div className="section-heading"><div><p className="eyebrow">Live read model</p><h2 id="monitor-title">Deploy / Monitor</h2></div>
      <button className="secondary" disabled={busy} onClick={() => { void refresh(); }}>{busy ? 'Refreshing…' : 'Refresh monitor'}</button>
    </div>
    <label className="inline-field">Selected run ID<input value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)} /></label>
    {!snapshot ? <p className="empty-state">Refresh to load live Fleet, preflight, logs, screenshots and diagnostics.</p> : <div className="monitor-grid">
      <article className="action-card"><h3>Active Fleet</h3>{runs.length === 0 ? <p className="empty-state">No deployment runs.</p> : <div className="table-wrap"><table><thead><tr><th>Run</th><th>Status</th><th>Stage</th><th>Progress</th></tr></thead><tbody>{runs.map((row, index) => {
        const run = objectValue(row); return <tr key={text(run.id, `run-${index}`)}><td>{text(run.id, 'unknown')}</td><td>{text(run.status, 'unknown')}</td><td>{text(run.stage, text(run.phase, 'unknown'))}</td><td>{percent(run.percent ?? run.progress)}</td></tr>;
      })}</tbody></table></div>}</article>
      <article className="action-card"><h3>Preflight</h3>{preflight.length === 0 ? <p className="empty-state">No preflight result.</p> : <ul className="check-list">{preflight.map((row, index) => { const check = objectValue(row); return <li key={`${text(check.name, 'check')}-${index}`}><strong>{check.ok === true ? 'PASS' : check.blocking === false ? 'WARN' : 'BLOCK'}</strong> {text(check.name, 'Unnamed check')} — {text(check.detail, '')}</li>; })}</ul>}</article>
      <DataCard title="Selected run and events" value={{ selectedRun: state.selectedRun ?? null, events: state.selectedRunEvents ?? [], screenshots: state.screenshots ?? [] }} />
      <DataCard title="System logs" value={state.logs ?? {}} />
      <DataCard title="Diagnostics" value={diagnostics} />
      <DataCard title="Archived evidence" value={state.archivedFleet ?? {}} />
    </div>}
  </section>;
}

function DataCard({ title, value }: { title: string; value: unknown }): React.JSX.Element {
  return <article className="action-card"><h3>{title}</h3><pre className="data-preview">{JSON.stringify(value, null, 2)}</pre></article>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback: string): string { return typeof value === 'string' && value ? value : fallback; }
function percent(value: unknown): string { const number = Number(value); return Number.isFinite(number) ? `${Math.max(0, Math.min(100, number)).toFixed(0)}%` : '—'; }
