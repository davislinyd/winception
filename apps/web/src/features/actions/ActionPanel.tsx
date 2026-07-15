import { useState } from 'react';
import { api } from '../../shared/api.js';

export function ActionPanel({ onCompleted, onError }: { onCompleted: (message: string) => void; onError: (error: unknown) => void }): React.JSX.Element {
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
    <section aria-labelledby="actions-title">
      <div className="section-heading">
        <div><p className="eyebrow">Resource-locked commands</p><h2 id="actions-title">Safe actions</h2></div>
      </div>
      <div className="action-grid">
        <SoftwareTest busy={busy} run={run} />
        <OsImage busy={busy} run={run} />
        <Torrent busy={busy} run={run} />
      </div>
    </section>
  );
}

type Runner = (label: string, action: () => Promise<unknown>) => Promise<void>;

function SoftwareTest({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [profileId, setProfileId] = useState('');
  const [runId, setRunId] = useState('');
  const [vmName, setVmName] = useState('winception-software-test-01');
  const [checkpointName, setCheckpointName] = useState('Winception-SoftwareTest-Clean');
  const [targetUser, setTargetUser] = useState('');
  const [status, setStatus] = useState('');
  return (
    <article className="action-card">
      <h3>Software Test VM</h3>
      <p>Requires stopped HTTP, TFTP, DHCP and an empty active fleet.</p>
      <label>VM name<input value={vmName} onChange={(event) => setVmName(event.target.value)} /></label>
      <label>Clean checkpoint<input value={checkpointName} onChange={(event) => setCheckpointName(event.target.value)} /></label>
      <label>Target Windows user<input value={targetUser} onChange={(event) => setTargetUser(event.target.value)} /></label>
      <button className="secondary" disabled={Boolean(busy) || !vmName || !checkpointName || !targetUser} onClick={() => { void run('Configure software test', () => api.configureSoftwareTest({ vmName, checkpointName, targetUser })); }}>Save VM configuration</button>
      <label>Profile ID<input value={profileId} onChange={(event) => setProfileId(event.target.value)} /></label>
      <button disabled={Boolean(busy) || !profileId.trim()} onClick={() => { void run('Software test', () => api.startSoftwareTest(profileId.trim())); }}>Start test</button>
      <label>Active run ID<input value={runId} onChange={(event) => setRunId(event.target.value)} /></label>
      <button className="secondary" disabled={Boolean(busy) || !runId.trim()} onClick={() => { void run('Abort software test', () => api.abortSoftwareTest(runId.trim())); }}>Stop test</button>
      <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Load software test status', async () => { setStatus(JSON.stringify(await api.softwareTestStatus(), null, 2)); }); }}>Load status</button>
      {status && <pre className="data-preview">{status}</pre>}
    </article>
  );
}

function OsImage({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [imageId, setImageId] = useState('');
  return (
    <article className="action-card">
      <h3>OS Image Cache</h3>
      <p>Download and re-export share the isolated OS cache resource.</p>
      <label>Image or catalog ID<input value={imageId} onChange={(event) => setImageId(event.target.value)} /></label>
      <div className="button-row">
        <button disabled={Boolean(busy) || !imageId.trim()} onClick={() => { void run('OS image download', () => api.downloadOsImage(imageId.trim())); }}>Download</button>
        <button className="secondary" disabled={Boolean(busy) || !imageId.trim()} onClick={() => { void run('OS image re-export', () => api.reexportOsImage(imageId.trim())); }}>Re-export</button>
      </div>
    </article>
  );
}

function Torrent({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [seedMinutes, setSeedMinutes] = useState('15');
  const [runId, setRunId] = useState('');
  const [additionalMinutes, setAdditionalMinutes] = useState('15');
  return (
    <article className="action-card">
      <h3>Torrent controls</h3>
      <label>Seed minutes<input type="number" min="0" max="1440" value={seedMinutes} onChange={(event) => setSeedMinutes(event.target.value)} /></label>
      <button disabled={Boolean(busy)} onClick={() => { void run('Torrent settings', () => api.updateTorrentSettings(Number(seedMinutes))); }}>Save settings</button>
      <label>Run ID<input value={runId} onChange={(event) => setRunId(event.target.value)} /></label>
      <label>Additional seed minutes<input type="number" min="1" max="1440" value={additionalMinutes} onChange={(event) => setAdditionalMinutes(event.target.value)} /></label>
      <div className="button-row">
        <button className="secondary" disabled={Boolean(busy) || !runId.trim()} onClick={() => { void run('Extend client', () => api.extendTorrentClient(runId.trim(), Number(additionalMinutes))); }}>Extend</button>
        <button className="danger" disabled={Boolean(busy) || !runId.trim()} onClick={() => { void run('Release client', () => api.releaseTorrentClient(runId.trim())); }}>Release</button>
      </div>
    </article>
  );
}
