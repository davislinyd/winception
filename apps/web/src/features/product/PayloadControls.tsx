import { useState } from 'react';
import { api } from '../../shared/api.js';

type Runner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export function PayloadControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [softwareFile, setSoftwareFile] = useState<File | null>(null);
  const [softwareId, setSoftwareId] = useState('');
  const [softwareName, setSoftwareName] = useState('');
  const [installerType, setInstallerType] = useState<'exe' | 'msi' | 'msix' | 'zip'>('exe');
  const [silentArgs, setSilentArgs] = useState('');
  const [verifyPath, setVerifyPath] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const [probeHost, setProbeHost] = useState('');
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptId, setScriptId] = useState('');
  const [scriptName, setScriptName] = useState('');
  const [deleteSoftwareId, setDeleteSoftwareId] = useState('');
  const [deleteScriptId, setDeleteScriptId] = useState('');
  const [inspectSoftwareId, setInspectSoftwareId] = useState('');
  const [inspectScriptId, setInspectScriptId] = useState('');
  const [preview, setPreview] = useState('');

  return <article className="action-card"><h3>Software and custom scripts</h3>
    <label>Installer<input type="file" accept=".exe,.msi,.msix,.zip" onChange={(event) => setSoftwareFile(event.target.files?.[0] ?? null)} /></label>
    <label>Software ID<input value={softwareId} onChange={(event) => setSoftwareId(event.target.value)} /></label>
    <label>Display name<input value={softwareName} onChange={(event) => setSoftwareName(event.target.value)} /></label>
    <label>Installer type<select value={installerType} onChange={(event) => setInstallerType(event.target.value as typeof installerType)}><option>exe</option><option>msi</option><option>msix</option><option>zip</option></select></label>
    <label>Silent arguments<input value={silentArgs} onChange={(event) => setSilentArgs(event.target.value)} /></label>
    <label>Verification path<input value={verifyPath} onChange={(event) => setVerifyPath(event.target.value)} /></label>
    <label>Dependencies, comma separated<input value={dependsOn} onChange={(event) => setDependsOn(event.target.value)} /></label>
    <label>Internet probe host (blank = offline)<input value={probeHost} onChange={(event) => setProbeHost(event.target.value)} /></label>
    <button disabled={Boolean(busy) || !softwareFile || !softwareId || !softwareName} onClick={() => { if (softwareFile) void run('Create software package', () => api.createSoftware({
      softwareId: softwareId.trim(), name: softwareName.trim(), scriptMode: 'template', installerType,
      silentArgs, successExitCodes: installerType === 'msi' ? [0, 3010] : [0], verifyPath,
      dependsOn: csv(dependsOn), network: probeHost.trim() ? { requirement: 'client-internet', probeHost: probeHost.trim() } : { requirement: 'offline' },
    }, softwareFile)); }}>Create software</button>
    <label>Delete software ID<input value={deleteSoftwareId} onChange={(event) => setDeleteSoftwareId(event.target.value)} /></label>
    <button className="danger" disabled={Boolean(busy) || !deleteSoftwareId.trim()} onClick={() => { void run('Delete software package', () => api.deleteSoftware(deleteSoftwareId.trim())); }}>Delete software</button>
    <label>Inspect software ID<input value={inspectSoftwareId} onChange={(event) => setInspectSoftwareId(event.target.value)} /></label>
    <div className="button-row">
      <button className="secondary" disabled={Boolean(busy) || !inspectSoftwareId.trim()} onClick={() => { void run('Read software script', async () => { setPreview((await api.readSoftwareScript(inspectSoftwareId.trim())).content); }); }}>Read install script</button>
      <button className="secondary" disabled={Boolean(busy) || !inspectSoftwareId.trim()} onClick={() => { void run('Open software script', () => api.openSoftwareScript(inspectSoftwareId.trim())); }}>Open on host</button>
    </div>
    <hr />
    <label>PowerShell script<input type="file" accept=".ps1" onChange={(event) => setScriptFile(event.target.files?.[0] ?? null)} /></label>
    <label>Script ID<input value={scriptId} onChange={(event) => setScriptId(event.target.value)} /></label>
    <label>Display name<input value={scriptName} onChange={(event) => setScriptName(event.target.value)} /></label>
    <button disabled={Boolean(busy) || !scriptFile || !scriptId || !scriptName} onClick={() => { if (scriptFile) void run('Create custom script', () => api.createCustomScript({ scriptId: scriptId.trim(), name: scriptName.trim() }, scriptFile)); }}>Create script</button>
    <label>Delete script ID<input value={deleteScriptId} onChange={(event) => setDeleteScriptId(event.target.value)} /></label>
    <button className="danger" disabled={Boolean(busy) || !deleteScriptId.trim()} onClick={() => { void run('Delete custom script', () => api.deleteCustomScript(deleteScriptId.trim())); }}>Delete script</button>
    <label>Inspect script ID<input value={inspectScriptId} onChange={(event) => setInspectScriptId(event.target.value)} /></label>
    <button className="secondary" disabled={Boolean(busy) || !inspectScriptId.trim()} onClick={() => { void run('Read custom script', async () => { setPreview((await api.readCustomScript(inspectScriptId.trim())).content); }); }}>Read custom script</button>
    {preview && <pre className="data-preview">{preview}</pre>}
  </article>;
}

function csv(value: string): string[] { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
