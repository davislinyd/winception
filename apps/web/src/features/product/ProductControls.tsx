import { useState } from 'react';
import { api } from '../../shared/api.js';

type Runner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export function ProductControls({ onCompleted, onError }: { onCompleted: (message: string) => void; onError: (error: unknown) => void }): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(label: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(label);
    try {
      const value = await action();
      onCompleted(typeof value === 'string' ? `${label} accepted as ${value}.` : `${label} completed.`);
    }
    catch (error) { onError(error); }
    finally { setBusy(null); }
  }
  return (
    <section aria-labelledby="product-controls-title">
      <div className="section-heading"><div><p className="eyebrow">Setup · Deploy · Monitor</p><h2 id="product-controls-title">Product controls</h2></div></div>
      <div className="product-grid">
        <RuntimeControls busy={busy} run={run} />
        <ConfigurationControls busy={busy} run={run} />
        <ProfileControls busy={busy} run={run} />
        <UploadControls busy={busy} run={run} />
        <SecretControls busy={busy} run={run} />
        <EvidenceControls busy={busy} run={run} />
      </div>
    </section>
  );
}

function RuntimeControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  return <article className="action-card"><h3>Runtime and services</h3><p>Preflight blocks only on blocking failures; warnings remain visible and do not prevent deployment.</p><div className="button-row">
    <Action label="Prepare runtime" busy={busy} run={run} action={api.prepareRuntime} />
    <Action label="Run preflight" busy={busy} run={run} action={api.preflight} secondary />
    <Action label="Start deployment ingress" busy={busy} run={run} action={api.startAllServices} />
    <Action label="Stop deployment ingress" busy={busy} run={run} action={api.stopAllServices} danger />
    <Action label="Run diagnostics" busy={busy} run={run} action={api.runDiagnostics} secondary />
    <Action label="Create Offline ISO" busy={busy} run={run} action={api.createOfflineIso} secondary />
  </div></article>;
}

function ConfigurationControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [projectRoot, setProjectRoot] = useState('C:\\OSDCloud');
  const [serverIp, setServerIp] = useState('');
  const [bootMode, setBootMode] = useState<'secureboot' | 'ipxe'>('secureboot');
  const [dhcpMode, setDhcpMode] = useState<'server' | 'proxy'>('server');
  return <article className="action-card"><h3>Endpoint and boot</h3>
    <label>Deployment project root<input value={projectRoot} onChange={(event) => setProjectRoot(event.target.value)} /></label>
    <button disabled={Boolean(busy) || !projectRoot} onClick={() => { void run('Project root update', () => api.updateProjectRoot(projectRoot)); }}>Save project root</button>
    <label>Web-selected service IPv4<input placeholder="192.168.1.20" value={serverIp} onChange={(event) => setServerIp(event.target.value)} /></label>
    <button disabled={Boolean(busy) || !serverIp} onClick={() => { void run('Endpoint update', () => api.updateEndpoint({ serverIp })); }}>Save endpoint</button>
    <label>Client boot mode<select value={bootMode} onChange={(event) => setBootMode(event.target.value as 'secureboot' | 'ipxe')}><option value="secureboot">Secure Boot</option><option value="ipxe">iPXE</option></select></label>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Boot mode update', () => api.updateBootMode(bootMode)); }}>Save boot mode</button>
    <label>DHCP mode<select value={dhcpMode} onChange={(event) => setDhcpMode(event.target.value as 'server' | 'proxy')}><option value="server">DHCP Server</option><option value="proxy">Proxy DHCP</option></select></label>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('DHCP mode update', () => api.updateDhcpMode(dhcpMode)); }}>Save DHCP mode</button>
  </article>;
}

function ProfileControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [profileId, setProfileId] = useState('');
  const [preview, setPreview] = useState('');
  return <article className="action-card"><h3>Deployment profile</h3><p>Publishing is isolated from OS cache and active ingress mutations.</p>
    <label>Profile ID<input value={profileId} onChange={(event) => setProfileId(event.target.value)} /></label>
    <button disabled={Boolean(busy) || !profileId} onClick={() => { void run('Profile publish', () => api.publishProfile(profileId)); }}>Publish profile</button>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Load profiles', async () => { setPreview(JSON.stringify(await api.profiles(), null, 2)); }); }}>Inspect profiles</button>
    {preview && <pre className="data-preview">{preview}</pre>}
  </article>;
}

function UploadControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  return <article className="action-card"><h3>Signed payload staging</h3><p>Files remain untrusted until the Agent rechecks type, size and SHA-256.</p>
    <Upload kind="os-image" label="OS image" accept=".iso,.esd,.wim" busy={busy} run={run} />
    <Upload kind="software" label="Software installer" accept=".exe,.msi,.msix,.zip" busy={busy} run={run} />
    <Upload kind="custom-script" label="Custom script" accept=".ps1" busy={busy} run={run} />
  </article>;
}

function Upload({ kind, label, accept, busy, run }: { kind: 'os-image' | 'software' | 'custom-script'; label: string; accept: string; busy: string | null; run: Runner }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  return <div className="upload-row"><label>{label}<input type="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <button className="secondary" disabled={Boolean(busy) || !file} onClick={() => { if (file) void run(`${label} import`, () => api.upload(kind, file)); }}>Stage and import</button></div>;
}

function SecretControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pxePassword, setPxePassword] = useState('');
  return <article className="action-card"><h3>Deployment secrets</h3><p>Values are sent only to the Agent and stored using Windows DPAPI.</p>
    <label>Windows username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>Windows password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label>PXE install password<input type="password" autoComplete="new-password" value={pxePassword} onChange={(event) => setPxePassword(event.target.value)} /></label>
    <button disabled={Boolean(busy) || !username || !password || !pxePassword} onClick={() => { void run('Deployment secrets', () => api.saveSecrets(username, password, pxePassword)); }}>Protect and save</button>
  </article>;
}

function EvidenceControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [ids, setIds] = useState('');
  const runIds = ids.split(',').map((id) => id.trim()).filter(Boolean);
  return <article className="action-card"><h3>Evidence and retention</h3><p>Read-only evidence stays available while archive and deletion actions take the evidence resource lock.</p>
    <label>Run IDs, comma separated<input value={ids} onChange={(event) => setIds(event.target.value)} /></label><div className="button-row">
      <button className="secondary" disabled={Boolean(busy) || runIds.length === 0} onClick={() => { void run('Archive evidence', () => api.evidenceAction('archive', runIds)); }}>Archive</button>
      <button className="secondary" disabled={Boolean(busy) || runIds.length === 0} onClick={() => { void run('Restore evidence', () => api.evidenceAction('restore', runIds)); }}>Restore</button>
      <button className="danger" disabled={Boolean(busy) || runIds.length === 0} onClick={() => { void run('Delete evidence', () => api.evidenceAction('delete', runIds)); }}>Delete</button>
    </div>
  </article>;
}

function Action({ label, busy, run, action, secondary, danger }: { label: string; busy: string | null; run: Runner; action: () => Promise<unknown>; secondary?: boolean; danger?: boolean }): React.JSX.Element {
  return <button className={danger ? 'danger' : secondary ? 'secondary' : undefined} disabled={Boolean(busy)} onClick={() => { void run(label, action); }}>{label}</button>;
}
