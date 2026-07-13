import { useState } from 'react';
import type { OsImage } from '../../../../../packages/contracts/src/index.js';
import { api } from '../../shared/api.js';

type Runner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export function OsImageControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<OsImage[]>([]);
  const [catalog, setCatalog] = useState<OsImage[]>([]);
  const [language, setLanguage] = useState('en-us');
  const [releaseId, setReleaseId] = useState('24H2');
  const [deleteId, setDeleteId] = useState('');

  return <article className="action-card"><h3>OS image catalog</h3>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Load OS image cache', async () => { setImages((await api.osImages()).images); }); }}>Load cache</button>
    {images.length > 0 && <label>Cached image<select value={deleteId} onChange={(event) => setDeleteId(event.target.value)}><option value="">Select image</option>{images.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>}
    <button className="danger" disabled={Boolean(busy) || !deleteId} onClick={() => { void run('Delete OS image', () => api.deleteOsImage(deleteId)); }}>Delete cached image</button>
    <label>Catalog language<input value={language} onChange={(event) => setLanguage(event.target.value)} /></label>
    <label>Windows release<input value={releaseId} onChange={(event) => setReleaseId(event.target.value)} /></label>
    <button className="secondary" disabled={Boolean(busy) || !language || !releaseId} onClick={() => { void run('Query Microsoft catalog', async () => { setCatalog(await api.osCatalog({ osFamily: ['win11'], edition: ['Pro'], activation: ['Retail'], language: [language], releaseId: [releaseId], sourceType: ['official'] })); }); }}>Query catalog</button>
    {catalog.length > 0 && <pre className="data-preview">{catalog.map((item) => `${item.id} · ${item.name}`).join('\n')}</pre>}
    <label>Offline OS image<input type="file" accept=".iso,.esd,.wim" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <button disabled={Boolean(busy) || !file} onClick={() => { if (file) void run('Import OS image', () => api.upload('os-image', file)); }}>Stage and import</button>
  </article>;
}
