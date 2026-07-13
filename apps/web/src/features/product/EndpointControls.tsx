import { useState } from 'react';
import type { NetworkInterface } from '../../../../../packages/contracts/src/index.js';
import { api } from '../../shared/api.js';

type Runner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export function EndpointControls({ busy, run }: { busy: string | null; run: Runner }): React.JSX.Element {
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [selected, setSelected] = useState('');
  const [wan, setWan] = useState('');
  const [pxe, setPxe] = useState('');
  const [subnet, setSubnet] = useState('192.168.100.0/24');
  const [gateway, setGateway] = useState('');
  const choice = interfaces.find((item) => key(item) === selected);

  async function load(): Promise<void> {
    const rows = await api.interfaces();
    setInterfaces(rows);
    if (!selected && rows[0]) setSelected(key(rows[0]));
    if (!wan && rows[0]) setWan(rows[0].interfaceAlias);
    if (!pxe && rows[1]) setPxe(rows[1].interfaceAlias);
  }

  return <article className="action-card"><h3>Endpoint and network</h3>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Load interfaces', load); }}>Load live interfaces</button>
    <button className="secondary" disabled={Boolean(busy)} onClick={() => { void run('Inspect network gateway', async () => { const value = await api.network(); setGateway(`${value.topology} · ${value.ready ? 'ready' : 'not ready'} · ${value.detail}`); }); }}>Inspect gateway</button>
    {gateway && <p className="data-preview">{gateway}</p>}
    <label>Deployment interface<select value={selected} onChange={(event) => setSelected(event.target.value)}>
      <option value="">Select an enabled IPv4 interface</option>
      {interfaces.map((item) => <option key={key(item)} value={key(item)}>{item.interfaceAlias} · {item.ipAddress}/{item.prefixLength}</option>)}
    </select></label>
    <button disabled={Boolean(busy) || !choice} onClick={() => { if (choice) void run('Endpoint update', () => api.updateEndpoint({
      interfaceAlias: choice.interfaceAlias,
      ipAddress: choice.ipAddress,
      prefixLength: choice.prefixLength,
      ...(choice.gateway ? { gateway: choice.gateway } : {}),
    })); }}>Sync selected endpoint</button>
    <hr />
    <label>WAN interface<select value={wan} onChange={(event) => setWan(event.target.value)}><option value="">Select WAN</option>{aliases(interfaces).map((name) => <option key={name}>{name}</option>)}</select></label>
    <label>PXE interface<select value={pxe} onChange={(event) => setPxe(event.target.value)}><option value="">Select PXE</option>{aliases(interfaces).map((name) => <option key={name}>{name}</option>)}</select></label>
    <label>Internal subnet<input value={subnet} onChange={(event) => setSubnet(event.target.value)} /></label>
    <div className="button-row">
      <button disabled={Boolean(busy) || !wan || !pxe || wan === pxe} onClick={() => { void run('Prepare NAT gateway', () => api.prepareNetwork(wan, pxe, subnet)); }}>Prepare NAT</button>
      <button className="danger" disabled={Boolean(busy)} onClick={() => { void run('Remove NAT gateway', api.removeNetwork); }}>Remove NAT</button>
    </div>
  </article>;
}

function key(item: NetworkInterface): string {
  return `${item.interfaceIndex}:${item.ipAddress}`;
}

function aliases(rows: NetworkInterface[]): string[] {
  return [...new Set(rows.map((item) => item.interfaceAlias))];
}
