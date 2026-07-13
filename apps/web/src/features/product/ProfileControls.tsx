import { useState } from 'react';
import type { DeploymentProfile, ProfilesResult } from '../../../../../packages/contracts/src/index.js';
import { api } from '../../shared/api.js';

type Runner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export function ProfileControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [catalog, setCatalog] = useState<ProfilesResult | null>(null);
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [osImageId, setOsImageId] = useState('');
  const [softwareIds, setSoftwareIds] = useState('');
  const [scriptIds, setScriptIds] = useState('');
  const [displayLanguage, setDisplayLanguage] = useState('');
  const [locale, setLocale] = useState('');
  const [inputLanguage, setInputLanguage] = useState('');
  const [timeZone, setTimeZone] = useState('');

  async function load(): Promise<void> {
    const value = await api.profiles();
    setCatalog(value);
    const selected = value.profiles.find((item) => item.id === profileId) ?? value.activeProfile;
    if (selected) select(selected);
  }

  function select(profile: DeploymentProfile): void {
    setProfileId(profile.id); setName(profile.name); setDescription(profile.description); setOsImageId(profile.osImageId ?? '');
    setSoftwareIds(profile.softwareIds.join(', '));
    setScriptIds(profile.installSequence.filter((item) => item.type === 'script').map((item) => item.id).join(', '));
    setDisplayLanguage(profile.displayLanguage ?? ''); setLocale(profile.locale ?? ''); setInputLanguage(profile.inputLanguage ?? ''); setTimeZone(profile.timeZone ?? '');
  }

  const software = csv(softwareIds);
  const scripts = csv(scriptIds);
  const common = {
    name: name.trim(), description: description.trim(), softwareIds: software,
    installSequence: [...software.map((id) => ({ type: 'software' as const, id })), ...scripts.map((id) => ({ type: 'script' as const, id }))],
    ...(osImageId.trim() ? { osImageId: osImageId.trim() } : {}),
    displayLanguage: nullable(displayLanguage), locale: nullable(locale), inputLanguage: nullable(inputLanguage), timeZone: nullable(timeZone),
  };

  return <article className="action-card"><h3>Deployment profiles</h3>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Load profile catalog', load); }}>Load catalog</button>
    {catalog && <label>Profile<select value={profileId} onChange={(event) => { const item = catalog.profiles.find((row) => row.id === event.target.value); if (item) select(item); }}>
      {catalog.profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
    </select></label>}
    <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>OS image ID<input value={osImageId} onChange={(event) => setOsImageId(event.target.value)} /></label>
    <label>Software IDs, comma separated<input value={softwareIds} onChange={(event) => setSoftwareIds(event.target.value)} /></label>
    <label>Custom script IDs, comma separated<input value={scriptIds} onChange={(event) => setScriptIds(event.target.value)} /></label>
    <details><summary>International settings</summary>
      <label>Display language<input value={displayLanguage} onChange={(event) => setDisplayLanguage(event.target.value)} /></label>
      <label>Locale<input value={locale} onChange={(event) => setLocale(event.target.value)} /></label>
      <label>Input language<input value={inputLanguage} onChange={(event) => setInputLanguage(event.target.value)} /></label>
      <label>Windows time zone<input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></label>
    </details>
    <div className="button-row">
      <button disabled={Boolean(busy) || !name.trim()} onClick={() => { void run('Create profile', () => api.createProfile(common)); }}>Create</button>
      <button disabled={Boolean(busy) || !profileId || !name.trim()} onClick={() => { void run('Update profile', () => api.updateProfile({ profileId, ...common })); }}>Update</button>
      <button className="secondary" disabled={Boolean(busy) || !profileId} onClick={() => { void run('Publish profile', () => api.publishProfile(profileId)); }}>Publish</button>
      <button className="danger" disabled={Boolean(busy) || !profileId || profileId === catalog?.activeProfile.id} onClick={() => { void run('Delete profile', () => api.deleteProfile(profileId)); }}>Delete inactive</button>
    </div>
  </article>;
}

function csv(value: string): string[] { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
function nullable(value: string): string | null { return value.trim() || null; }
