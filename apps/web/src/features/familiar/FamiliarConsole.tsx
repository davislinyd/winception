import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DeploymentSnapshotResult, OperationRecord, SystemState } from '../../../../../packages/contracts/src/index.js';
import { api } from '../../shared/api.js';

export type ConsoleView = 'deploy' | 'monitor';
export type ConnectionState = 'connecting' | 'live' | 'reconnecting';
type DrawerKind = 'profile' | 'image' | 'endpoint' | 'setup';

type Runner = (label: string, action: () => Promise<unknown>) => void;

export interface FamiliarConsoleProps {
  state: SystemState | null;
  snapshot: DeploymentSnapshotResult | null;
  operations: OperationRecord[];
  accepted: ReadonlyArray<{ id: string; label: string }>;
  connection: ConnectionState;
  snapshotStatus: string | null;
  configurationControls: ReactNode;
  onRefresh: () => void;
  onRun: Runner;
}

export function FamiliarConsole({ state, snapshot, operations, accepted, connection, snapshotStatus, configurationControls, onRefresh, onRun }: FamiliarConsoleProps): React.JSX.Element {
  const [view, setView] = useState<ConsoleView>('deploy');
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const root = snapshot ?? emptySnapshot();
  const fleet = readFleet(root);
  const runs = fleet.runs;
  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null;

  useEffect(() => {
    if (!selectedRunId && selectedRun?.runId) setSelectedRunId(selectedRun.runId);
  }, [selectedRun?.runId, selectedRunId]);

  function openDrawer(kind: DrawerKind, event: React.MouseEvent<HTMLButtonElement>): void {
    opener.current = event.currentTarget;
    setDrawer(kind);
  }

  function closeDrawer(): void {
    setDrawer(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  function askConfirm(request: ConfirmRequest): void { setConfirm(request); }

  return <div className="familiar-shell">
    <header className="familiar-topbar">
      <div className="familiar-brand"><span className="brand-mark">W</span><span><strong>Winception</strong><small>v2 familiar console</small></span></div>
      <nav className="view-tabs" aria-label="Views">
        <button className={view === 'deploy' ? 'active' : ''} aria-current={view === 'deploy' ? 'page' : undefined} onClick={() => setView('deploy')}>Deploy</button>
        <button className={view === 'monitor' ? 'active' : ''} aria-current={view === 'monitor' ? 'page' : undefined} onClick={() => setView('monitor')}>Monitor</button>
      </nav>
      <div className="topbar-status">
        <span className="endpoint-chip">{endpointLabel(root)}</span>
        <span className={`connection-chip ${connection}`}>{connection === 'live' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting' : 'Connecting'}</span>
        {snapshotStatus && <span className="snapshot-chip" role="status">{snapshotStatus}</span>}
        <button className="icon-button" aria-label="Refresh control plane" title="Refresh" onClick={onRefresh}>↻</button>
        <a href="/manual/" aria-label="Open deployment manual">Manual</a>
      </div>
    </header>

    <main className="familiar-main">
      {view === 'deploy'
        ? <DeployView root={root} state={state} onDrawer={openDrawer} onRun={onRun} onConfirm={askConfirm} onOpenMonitor={() => setView('monitor')} />
        : <MonitorView root={root} selectedRun={selectedRun} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} onEvidence={setEvidenceRunId} onRun={onRun} onConfirm={askConfirm} />}
    </main>

    <ConsoleDock open={consoleOpen} onToggle={() => setConsoleOpen((value) => !value)} operations={operations} accepted={accepted} root={root} />
    {drawer && <ConfigurationDrawer title={drawer === 'profile' ? 'Deployment profiles' : drawer === 'image' ? 'OS images' : drawer === 'endpoint' ? 'Endpoint settings' : 'Setup settings'} onClose={closeDrawer}>{configurationControls}</ConfigurationDrawer>}
    {evidenceRunId && <EvidenceDrawer runId={evidenceRunId} root={root} onClose={() => setEvidenceRunId(null)} onRun={onRun} onConfirm={askConfirm} />}
    {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} onConfirm={() => { setConfirm(null); onRun(confirm.label, confirm.action); }} />}
  </div>;
}

function DeployView({ root, state, onDrawer, onRun, onConfirm, onOpenMonitor }: {
  root: DeploymentSnapshotResult; state: SystemState | null; onDrawer: (kind: DrawerKind, event: React.MouseEvent<HTMLButtonElement>) => void; onRun: Runner; onConfirm: (request: ConfirmRequest) => void; onOpenMonitor: () => void;
}): React.JSX.Element {
  const preflight = list(extra(root, 'preflight')).map(asObject);
  const blockingFailure = preflight.some((check) => check.blocking !== false && check.ok !== true);
  const preflightReady = preflight.length > 0 && !blockingFailure;
  const services = asObject(root.services);
  const initialization = asObject(extra(root, 'initialization'));
  const initSteps = list(initialization.steps).map(asObject);
  return <section className="deploy-layout" aria-labelledby="deploy-title">
    <div className="deploy-main-column">
      <div className="deploy-heading"><div><p className="eyebrow">Deployment control plane</p><h1 id="deploy-title">Deploy</h1><p>Set the profile, image and endpoint; run preflight before starting ingress.</p></div><span className="updated-at">{state ? `Updated ${new Date(state.updatedAt).toLocaleTimeString()}` : 'Snapshot unavailable'}</span></div>
      <div className="deploy-summary" aria-label="Deployment configuration">
        <SummaryButton label="Profile" value={profileLabel(root)} onClick={(event) => onDrawer('profile', event)} />
        <SummaryButton label="OS Image" value={imageLabel(root)} onClick={(event) => onDrawer('image', event)} />
        <SummaryButton label="Endpoint" value={endpointLabel(root)} onClick={(event) => onDrawer('endpoint', event)} />
      </div>
      <div className="dashboard-tiles">
        <StatusTile label="Fleet" value={String(readFleet(root).total)} detail={`${readFleet(root).counts.running} deploying · ${readFleet(root).counts.completed} ready`} />
        <StatusTile label="Ingress" value={state?.services.deploymentIngress ?? serviceState(services.http)} detail="HTTP · TFTP · DHCP" />
        <StatusTile label="Operations" value={String(state?.operations.filter((item) => item.status === 'running').length ?? 0)} detail="v2 resource locks" />
      </div>
      <ServiceCards root={root} preflightReady={preflightReady} onRun={onRun} onConfirm={onConfirm} />
      <div className="readiness-grid">
        <ReadinessCard title="Runtime readiness" text={text(asObject(extra(root, 'runtime')).status, 'Check runtime before ingress.')} actionLabel="Prepare runtime" onAction={() => onRun('Prepare runtime', api.prepareRuntime)} />
        <ReadinessCard title="Preflight summary" text={preflight.length ? `${preflight.filter((check) => check.ok === true).length}/${preflight.length} checks passed${blockingFailure ? ' · blocking action required' : ''}` : 'Not run'} actionLabel="Run preflight" onAction={() => onRun('Run preflight', api.preflight)} />
        <ReadinessCard title="Diagnostics" text={text(asObject(extra(root, 'diagnostics')).headline, 'Generate a safe host or run diagnostic bundle.')} actionLabel="Run diagnostics" onAction={() => onRun('Run diagnostics', api.runDiagnostics)} />
        <ReadinessCard title="Offline ISO" text={text(asObject(extra(root, 'offlineIso')).headline, 'Create an additive host-side snapshot.')} actionLabel="Create ISO" onAction={() => onRun('Create Offline ISO', api.createOfflineIso)} />
      </div>
    </div>
    <GuidedSetupRail initialization={initialization} steps={initSteps} preflightReady={preflightReady} onDrawer={onDrawer} onRun={onRun} onConfirm={onConfirm} onOpenMonitor={onOpenMonitor} />
  </section>;
}

function GuidedSetupRail({ initialization, steps, preflightReady, onDrawer, onRun, onConfirm, onOpenMonitor }: {
  initialization: Record<string, unknown>; steps: Record<string, unknown>[]; preflightReady: boolean; onDrawer: (kind: DrawerKind, event: React.MouseEvent<HTMLButtonElement>) => void; onRun: Runner; onConfirm: (request: ConfirmRequest) => void; onOpenMonitor: () => void;
}): React.JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState('');
  const nextStepId = text(initialization.nextStepId);
  const selected = steps.find((step) => text(step.id) === selectedStepId) ?? steps.find((step) => text(step.id) === nextStepId) ?? steps[0];
  const status = text(initialization.status, initialization.deploymentLive === true ? 'Live' : initialization.deploymentReady === true ? 'Ready' : initialization.initialized === true ? 'Configured' : 'Guided setup');
  const action = text(selected?.action);
  const actionLabel = text(selected?.nextActionText, guidedActionLabel(action));
  const serviceStart = action === 'all-services-toggle';
  const actionDisabled = serviceStart && !preflightReady;

  function runAction(event: React.MouseEvent<HTMLButtonElement>): void {
    if (action === 'project-root' || action === 'secrets') { onDrawer('setup', event); return; }
    if (action === 'interfaces' || action === 'endpoint-sync') { onDrawer('endpoint', event); return; }
    if (action === 'os-images') { onDrawer('image', event); return; }
    if (action === 'profiles') { onDrawer('profile', event); return; }
    if (action === 'prepare-runtime') { onRun('Prepare runtime', api.prepareRuntime); return; }
    if (action === 'preflight') { onRun('Run preflight', api.preflight); return; }
    if (action === 'all-services-toggle') {
      onConfirm({ title: 'Start deployment ingress', message: 'Confirm the real LAN DHCP arrangement is safe before starting HTTP, TFTP and DHCP.', label: 'Start deployment ingress', action: api.startAllServices });
      return;
    }
    if (action === 'dashboard') onOpenMonitor();
  }

  return <aside className="guided-rail" aria-labelledby="guided-title">
    <div className="guided-head"><p className="eyebrow">Guided setup</p><h2 id="guided-title">Set up deployment</h2><span className="status-pill">{status}</span></div>
    {steps.length ? <><ol className="guided-steps">{steps.map((step, index) => {
      const stepId = text(step.id, `step-${index + 1}`);
      const selectedStep = stepId === text(selected?.id);
      return <li key={stepId} className={text(step.status, step.done === true ? 'ready' : 'pending')}><button type="button" className={selectedStep ? 'guided-step selected' : 'guided-step'} aria-current={selectedStep ? 'step' : undefined} onClick={() => setSelectedStepId(stepId)}><strong>{text(step.title, text(step.label, text(step.name, `Step ${index + 1}`)))}</strong><span>{text(step.detail, text(step.status, 'pending'))}</span></button></li>;
    })}</ol>{selected && <section className="guided-step-detail" aria-live="polite"><h3>{text(selected.title, text(selected.label, 'Deployment step'))}</h3><p>{text(selected.objective, text(selected.detail, 'Review this deployment requirement.'))}</p>{text(selected.safetyNote) && <p className="guided-safety">{text(selected.safetyNote)}</p>}{action && action !== 'setup' && <><button disabled={actionDisabled} aria-describedby={actionDisabled ? 'guided-preflight-gate' : undefined} title={actionDisabled ? 'Run preflight and resolve blocking failures first.' : undefined} onClick={runAction}>{actionLabel}</button>{actionDisabled && <p id="guided-preflight-gate" className="guided-gate">Run preflight and resolve blocking failures before starting services.</p>}</>}</section>}</> : <p className="empty-state">Run a snapshot to load the deployment sequence.</p>}
  </aside>;
}

function guidedActionLabel(action: string): string {
  return ({ 'project-root': 'Set project root', secrets: 'Save secrets', 'prepare-runtime': 'Prepare runtime', 'endpoint-sync': 'Sync endpoint', interfaces: 'Select endpoint', 'os-images': 'Open OS images', profiles: 'Publish profile', preflight: 'Run preflight', 'all-services-toggle': 'Start services', dashboard: 'Open Monitor' } as Record<string, string>)[action] ?? 'Open';
}

function ServiceCards({ root, preflightReady, onRun, onConfirm }: { root: DeploymentSnapshotResult; preflightReady: boolean; onRun: Runner; onConfirm: (request: ConfirmRequest) => void }): React.JSX.Element {
  const services = asObject(root.services);
  const start = (name: 'http' | 'tftp' | 'dhcp' | 'torrent'): void => {
    const action: () => Promise<string> = () => api.startService(name);
    if (name === 'dhcp') onConfirm({ title: 'Start DHCP', message: 'Confirm the isolated PXE network has no competing LAN DHCP responder.', label: 'Start DHCP', action });
    else onRun(`Start ${name.toUpperCase()}`, action);
  };
  return <section className="service-section" aria-labelledby="services-title"><div className="section-heading"><div><p className="eyebrow">Ingress control</p><h2 id="services-title">Services</h2></div><div className="button-row"><button className="secondary" onClick={() => onRun('Stop deployment ingress', api.stopAllServices)}>Stop all</button><button disabled={!preflightReady} title={preflightReady ? undefined : 'Run preflight and resolve blocking failures first.'} onClick={() => onConfirm({ title: 'Start deployment ingress', message: 'Confirm the real LAN DHCP arrangement is safe before starting HTTP, TFTP and DHCP.', label: 'Start deployment ingress', action: api.startAllServices })}>Start all</button></div></div>
    {!preflightReady && <div className="service-gate" role="status"><span>Ingress start is gated until preflight reports no blocking failure.</span><button className="secondary" onClick={() => onRun('Run preflight', api.preflight)}>Run preflight</button></div>}
    <div className="service-grid">
      {(['http', 'tftp', 'dhcp'] as const).map((name): React.JSX.Element => <ServiceCard key={name} name={name} service={asObject(services[name])} preflightReady={preflightReady} onStart={() => start(name)} onStop={() => onRun(`Stop ${name.toUpperCase()}`, () => api.stopService(name))} />)}
      <TorrentTracker root={root} onRun={onRun} onConfirm={onConfirm} preflightReady={preflightReady} onStart={() => start('torrent')} onStop={() => onRun('Stop Torrent', () => api.stopService('torrent'))} />
    </div>
  </section>;
}

function ServiceCard({ name, service, preflightReady, onStart, onStop }: { name: 'http' | 'tftp' | 'dhcp'; service: Record<string, unknown>; preflightReady: boolean; onStart: () => void; onStop: () => void }): React.JSX.Element {
  const running = service.running === true;
  const label = name === 'http' ? 'HTTP Server' : name === 'tftp' ? 'TFTP Server' : 'DHCP Server';
  const blocked = !running && !preflightReady;
  return <article className={`service-card ${running ? 'running' : 'stopped'}`}><div className="service-card-head"><h3>{label}</h3><span className="status-pill">{running ? 'Running' : 'Stopped'}</span></div><code>{text(service.address, text(service.url, 'Configured from live endpoint'))}</code><button disabled={blocked} title={blocked ? 'Run preflight and resolve blocking failures first.' : undefined} onClick={running ? onStop : onStart}>{running ? `Stop ${name.toUpperCase()}` : `Start ${name.toUpperCase()}`}</button></article>;
}

function TorrentTracker({ root, onRun, onConfirm, preflightReady, onStart, onStop }: { root: DeploymentSnapshotResult; onRun: Runner; onConfirm: (request: ConfirmRequest) => void; preflightReady: boolean; onStart: () => void; onStop: () => void }): React.JSX.Element {
  const torrent = asObject(asObject(root.services).torrent);
  const distribution = asObject(torrent.distribution);
  const clients = list(distribution.clients).map(asObject);
  const [seedMinutes, setSeedMinutes] = useState(String(number(asObject(asObject(root.config).torrent), 'seedMinutes', 15)));
  const [extensions, setExtensions] = useState<Record<string, string>>({});
  const running = torrent.running === true;
  return <article className={`service-card torrent-card ${running ? 'running' : 'stopped'}`}><div className="service-card-head"><h3>Torrent Tracker</h3><span className="status-pill">{distribution.emergency ? 'Emergency fallback' : running ? 'Running' : 'Stopped'}</span></div><code>{text(torrent.serverIp, 'P2P OS image distribution')}:{number(torrent, 'trackerPort', 6969)} · {torrent.seederRunning ? `seeding ${text(torrent.seeding, '')}` : 'no seed'}</code>
    <div className="torrent-settings"><label>Default seed wait (minutes)<input aria-label="Default seed wait minutes" type="number" min="0" max="1440" value={seedMinutes} onChange={(event) => setSeedMinutes(event.target.value)} /></label><button className="secondary" onClick={() => onRun('Save torrent settings', () => api.updateTorrentSettings(Number(seedMinutes)))}>Save default</button><button className="secondary" disabled={!running && !preflightReady} title={!running && !preflightReady ? 'Run preflight and resolve blocking failures first.' : undefined} onClick={running ? onStop : onStart}>{running ? 'Stop tracker' : 'Start tracker'}</button></div>
    <div className="torrent-summary"><Metric label="Wave / batch" value={distribution.waveId ? `${text(distribution.waveId)} / ${text(distribution.batch, '-')}` : 'Idle'} /><Metric label="Swarm coverage" value={`${number(distribution, 'coveragePercent', 0)}%`} /><Metric label="Clients" value={`↓ ${number(asObject(distribution.phases), 'downloading', 0)} · seed ${number(asObject(distribution.phases), 'seeding', 0)} · wait ${number(asObject(distribution.phases), 'waiting', 0)}`} /></div>
    {Boolean(distribution.emergency) && <p className="torrent-warning">Emergency host fallback: {text(asObject(distribution.emergency).reason, 'active')}</p>}
    {clients.length > 0 && <div className="table-wrap"><table className="torrent-table"><thead><tr><th>Client</th><th>Phase</th><th>Progress</th><th>Sources / receivers</th><th>Seed wait</th><th>Action</th></tr></thead><tbody>{clients.map((client) => {
      const runId = text(client.runId); const clientId = text(client.clientId); const progress = progressPercent(client);
      const extension = extensions[runId] ?? '15';
      return <tr key={runId} className={client.stale ? 'stale' : undefined}><td>{text(client.ip, 'Unknown')} · {clientId || runId}</td><td>{text(client.phase, 'unknown')}{client.stale ? ' (stale)' : ''}</td><td><span>{progress}%</span><span className="progress-track"><span style={{ width: `${progress}%` }} /></span></td><td>{list(client.sources).map((item) => text(item)).join(', ') || '-'} / {list(client.receivers).map((item) => text(item)).join(', ') || '-'}</td><td>{text(client.phase) === 'waiting' ? `${number(client, 'seedSecondsRemaining', 0)}s remaining` : '-'}</td><td>{text(client.phase) === 'waiting' && !client.stale ? <div className="torrent-actions"><input aria-label={`Additional seed minutes for ${runId}`} type="number" min="1" max="1440" value={extension} onChange={(event) => setExtensions((value) => ({ ...value, [runId]: event.target.value }))} /><button className="secondary" onClick={() => onRun('Extend torrent client', () => api.extendTorrentClient(runId, Number(extension), clientId || undefined))}>Extend</button><button onClick={() => onRun('Continue client to reboot', () => api.releaseTorrentClient(runId, clientId || undefined))}>Continue</button></div> : '-'}</td></tr>;
    })}</tbody></table></div>}
    {number(asObject(distribution.phases), 'waiting', 0) > 0 && <button className="secondary" onClick={() => onConfirm({ title: 'Continue all waiting clients', message: 'This stops torrent seeding for every waiting WinPE client and permits reboot.', label: 'Continue all waiting clients', action: api.releaseAllWaitingTorrentClients })}>Continue all waiting clients</button>}
  </article>;
}

function MonitorView({ root, selectedRun, selectedRunId, onSelectRun, onEvidence, onRun, onConfirm }: { root: DeploymentSnapshotResult; selectedRun: FleetRun | null; selectedRunId: string; onSelectRun: (id: string) => void; onEvidence: (id: string) => void; onRun: Runner; onConfirm: (request: ConfirmRequest) => void }): React.JSX.Element {
  const fleet = readFleet(root);
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'failed' | 'stale' | 'archived'>('all');
  const [search, setSearch] = useState('');
  const runs = filterFleet(filter === 'archived' ? readArchivedFleet(root).runs : fleet.runs, filter, search);
  return <section className="monitor-view" aria-labelledby="monitor-title"><div className="section-heading"><div><p className="eyebrow">Fleet and evidence</p><h1 id="monitor-title">Monitor</h1></div><div className="fleet-search"><input aria-label="Search host or run ID" type="search" placeholder="Search host or run ID" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
    <div className="fleet-stat-strip"><Metric label="Total" value={String(fleet.total)} /><Metric label="Deploying" value={String(fleet.counts.running)} /><Metric label="Ready" value={String(fleet.counts.completed)} /><Metric label="Failed" value={String(fleet.counts.failed)} /><Metric label="Stale" value={String(fleet.counts.stale)} /></div>
    <div className="fleet-filter" role="tablist" aria-label="Fleet filters">{(['all', 'active', 'done', 'failed', 'stale', 'archived'] as const).map((value) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
    <div className="fleet-layout"><div className="fleet-cards">{runs.length ? runs.map((run) => <button key={run.runId} className={`fleet-card ${selectedRunId === run.runId ? 'selected' : ''}`} aria-pressed={selectedRunId === run.runId} onClick={() => onSelectRun(run.runId)}><span className={`status-pill ${run.status}`}>{run.status}</span><strong>{run.clientId}</strong><span className="fleet-ring">{run.status === 'completed' ? '✓' : `${run.percent}%`}</span><span>{run.latestStage}</span><small>{run.runId}</small></button>) : <p className="empty-state">No deployment clients match this view.</p>}</div>
      <FleetDetail run={selectedRun} onEvidence={onEvidence} onRun={onRun} onConfirm={onConfirm} />
    </div>
  </section>;
}

function FleetDetail({ run, onEvidence, onRun, onConfirm }: { run: FleetRun | null; onEvidence: (id: string) => void; onRun: Runner; onConfirm: (request: ConfirmRequest) => void }): React.JSX.Element {
  if (!run) return <aside className="fleet-detail empty" aria-live="polite">Select a client to inspect its deployment flow.</aside>;
  const flow = ['PXE / WinPE', 'Apply image', 'SetupComplete', 'Apps and scripts', 'Desktop ready'];
  const reached = Math.min(flow.length - 1, Math.max(0, Math.round(run.percent / 25) - 1));
  return <aside className="fleet-detail" aria-live="polite"><div className="fleet-detail-head"><div><h2>{run.clientId}</h2><p>{run.runId}{run.clientIp ? ` · ${run.clientIp}` : ''}</p></div><span className={`status-pill ${run.status}`}>{run.status}</span></div><div className="detail-progress"><strong>{run.status === 'completed' ? '✓' : `${run.percent}%`}</strong><span>{run.latestStage}</span></div><h3>Execution flow</h3><ol className="execution-flow">{flow.map((label, index) => <li key={label} className={run.status === 'completed' || index < reached ? 'done' : index === reached ? 'current' : 'pending'}>{label}</li>)}</ol><div className="button-row"><button className="secondary" onClick={() => onEvidence(run.runId)}>View evidence</button>{(run.status === 'failed' || run.status === 'stale') && <button className="secondary" onClick={() => onRun('Generate run diagnostics', () => api.runDiagnostics({ scope: 'run', runId: run.runId, trigger: 'fleet-failed' }))}>Generate diagnostics</button>}<button className="secondary" onClick={() => onRun('Archive evidence', () => api.evidenceAction('archive', [run.runId]))}>Archive</button><button className="danger" onClick={() => onConfirm({ title: 'Delete deployment run', message: `Delete evidence for ${run.runId}? This cannot be recovered from the active index.`, label: 'Delete deployment run', action: () => api.evidenceAction('delete', [run.runId]) })}>Delete run</button></div></aside>;
}

function ConfigurationDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  const dialogRef = useDialogFocus(onClose);
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="configuration-drawer" role="dialog" aria-modal="true" aria-label={title}><div className="drawer-head"><div><p className="eyebrow">Configuration</p><h2>{title}</h2></div><button className="secondary" onClick={onClose}>Close</button></div><p className="drawer-intro">These v2 controls remain schema-validated and resource-locked. The v1-style shell changes the workflow, not the privileged boundary.</p>{children}</section></div>;
}

function EvidenceDrawer({ runId, root, onClose, onRun, onConfirm }: { runId: string; root: DeploymentSnapshotResult; onClose: () => void; onRun: Runner; onConfirm: (request: ConfirmRequest) => void }): React.JSX.Element {
  const dialogRef = useDialogFocus(onClose);
  const events = list(extra(root, 'selectedRunEvents')).map(asObject);
  const screenshots = list(extra(root, 'screenshots')).map(asObject);
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="evidence-drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${runId}`}><div className="drawer-head"><div><p className="eyebrow">Validation evidence</p><h2>{runId}</h2></div><button className="secondary" onClick={onClose}>Close</button></div><div className="evidence-summary"><Metric label="Events" value={String(events.length)} /><Metric label="Screenshots" value={String(screenshots.length)} /></div><ol className="evidence-events">{events.length ? events.map((event, index) => <li key={`${text(event.id, 'event')}-${index}`}><strong>{text(event.stage, text(event.type, 'Event'))}</strong><span>{text(event.detail, text(event.message, 'Recorded by deployment client.'))}</span></li>) : <li>No selected-run evidence is currently available.</li>}</ol><div className="button-row"><button className="secondary" onClick={() => onRun('Archive evidence', () => api.evidenceAction('archive', [runId]))}>Archive</button><button className="danger" onClick={() => onConfirm({ title: 'Delete evidence', message: `Delete evidence for ${runId}?`, label: 'Delete evidence', action: () => api.evidenceAction('delete', [runId]) })}>Delete</button></div></section></div>;
}

function ConsoleDock({ open, onToggle, operations, accepted, root }: { open: boolean; onToggle: () => void; operations: OperationRecord[]; accepted: ReadonlyArray<{ id: string; label: string }>; root: DeploymentSnapshotResult }): React.JSX.Element {
  const recentLogs = useMemo(() => flattenLogs(extra(root, 'logs')).slice(-12), [root]);
  const entries: Array<{ id: string; label: string; status: string; errorCode?: string }> = [...accepted.map((item) => ({ ...item, status: 'accepted' })), ...operations.map((item) => ({ id: item.id, label: item.label, status: item.status, errorCode: item.errorCode }))];
  return <section className={`console-dock ${open ? 'open' : ''}`} aria-label="Console output"><button className="console-dock-head" aria-expanded={open} onClick={onToggle}><span>Console</span><span>{operations.find((operation) => operation.status === 'running')?.label ?? accepted.at(0)?.label ?? 'Idle'}</span><span className="status-pill">{operations.find((operation) => operation.status === 'running') ? 'Running' : 'Ready'}</span></button>{open && <div className="console-dock-body"><div className="operation-list">{entries.slice(0, 12).map((item) => <div key={`${item.id}-${item.status}`}><strong>{item.label}</strong><span>{item.status}{item.errorCode ? ` · ${item.errorCode}` : ''}</span></div>)}</div><pre>{recentLogs.join('\n') || 'No safe console entries are available.'}</pre></div>}</section>;
}

function ConfirmDialog({ request, onClose, onConfirm }: { request: ConfirmRequest; onClose: () => void; onConfirm: () => void }): React.JSX.Element {
  const dialogRef = useDialogFocus(onClose);
  return <div className="drawer-backdrop"><section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{request.title}</h2><p>{request.message}</p><div className="button-row"><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onConfirm}>{request.label}</button></div></section></div>;
}

function useDialogFocus(onClose: () => void): React.RefObject<HTMLElement | null> {
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => dialog.current?.focus(), 0);
    const keepFocus = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) { event.preventDefault(); dialog.current.focus(); return; }
      const first = focusable[0] as HTMLElement;
      const last = focusable.at(-1) as HTMLElement;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keepFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', keepFocus); previous?.focus(); };
  }, [onClose]);
  return dialog;
}

function SummaryButton({ label, value, onClick }: { label: string; value: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }): React.JSX.Element { return <button className="deploy-segment" onClick={onClick}><span>{label}</span><strong>{value}</strong><span aria-hidden="true">⌄</span></button>; }
function StatusTile({ label, value, detail }: { label: string; value: string; detail: string }): React.JSX.Element { return <article className="status-tile"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function ReadinessCard({ title, text: detail, actionLabel, onAction }: { title: string; text: string; actionLabel: string; onAction: () => void }): React.JSX.Element { return <article className="readiness-card"><h3>{title}</h3><p>{detail}</p><button className="secondary" onClick={onAction}>{actionLabel}</button></article>; }
function Metric({ label, value }: { label: string; value: string }): React.JSX.Element { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }

interface ConfirmRequest { title: string; message: string; label: string; action: () => Promise<unknown>; }
interface FleetRun { runId: string; clientId: string; clientIp: string; status: string; latestStage: string; percent: number; }
interface FleetData { runs: FleetRun[]; counts: Record<string, number>; total: number; }

function emptySnapshot(): DeploymentSnapshotResult { return { generatedAt: new Date(0).toISOString(), app: {}, config: {}, services: {}, fleet: {} }; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function extra(root: DeploymentSnapshotResult, key: string): unknown { return (root as unknown as Record<string, unknown>)[key]; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' && value.trim() ? value : fallback; }
function number(value: Record<string, unknown>, key: string, fallback = 0): number { const candidate = Number(value[key]); return Number.isFinite(candidate) ? candidate : fallback; }
function serviceState(value: unknown): string { return asObject(value).running === true ? 'running' : 'stopped'; }
function endpointLabel(root: DeploymentSnapshotResult): string { const config = asObject(root.config); const endpoint = asObject(config.endpoint); return text(endpoint.ipAddress, text(endpoint.interfaceAlias, 'Endpoint not selected')); }
function profileLabel(root: DeploymentSnapshotResult): string { const config = asObject(root.config); return text(config.activeProfileName, text(asObject(config.profile).name, 'Select profile')); }
function imageLabel(root: DeploymentSnapshotResult): string { const config = asObject(root.config); return text(config.activeOsLabel, text(asObject(config.osImage).name, 'Select OS image')); }
function readFleet(root: DeploymentSnapshotResult): FleetData { const fleet = asObject(root.fleet); const runs = list(fleet.runs).map(asObject).map((run, index) => ({ runId: text(run.runId, text(run.id, `run-${index}`)), clientId: text(run.clientId, text(run.host, 'Unknown client')), clientIp: text(run.clientIp), status: text(run.status, 'pending'), latestStage: text(run.latestStage, text(run.stage, 'pending')), percent: Math.max(0, Math.min(100, number(run, 'latestPercent', number(run, 'percent', number(run, 'progress', 0))))) })); const counts = asObject(fleet.counts); return { runs, counts: { running: number(counts, 'running'), completed: number(counts, 'completed'), failed: number(counts, 'failed'), stale: number(counts, 'stale') }, total: number(fleet, 'total', runs.length) }; }
function readArchivedFleet(root: DeploymentSnapshotResult): FleetData { const archive = asObject(extra(root, 'archivedFleet')); return readFleet({ ...root, fleet: archive }); }
function filterFleet(runs: FleetRun[], filter: string, search: string): FleetRun[] { const query = search.trim().toLowerCase(); return runs.filter((run) => { const visible = filter === 'all' || filter === 'active' && !['completed', 'failed', 'stale'].includes(run.status) || filter === 'done' && run.status === 'completed' || filter === run.status; return visible && (!query || `${run.clientId} ${run.runId}`.toLowerCase().includes(query)); }); }
function progressPercent(client: Record<string, unknown>): number { const total = number(client, 'totalLength'); return total > 0 ? Math.max(0, Math.min(100, Math.round(number(client, 'completedLength') * 100 / total))) : number(client, 'progress'); }
function flattenLogs(value: unknown): string[] { if (typeof value === 'string') return [value]; if (Array.isArray(value)) return value.flatMap(flattenLogs); if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(flattenLogs); return []; }
