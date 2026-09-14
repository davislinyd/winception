import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollector } from '../../acceptance/collector.mjs';
import { networkPassed } from '../../acceptance/report.mjs';
import { normalizeAcceptance } from '../src/profiles/acceptance.js';
import { dhcpReply } from '../../acceptance/router-dhcp.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('automatic login is an explicit limited test-only opt-in', () => {
  assert.equal(normalizeAcceptance(undefined), null);
  assert.deepEqual(normalizeAcceptance({testOnly:true,autoLogonCount:1}),{testOnly:true,autoLogonCount:1});
  for (const value of [{testOnly:false,autoLogonCount:1},{testOnly:true,autoLogonCount:5},{testOnly:true,autoLogonCount:0}]) assert.throws(()=>normalizeAcceptance(value));
});
test('readonly physical entry emits Blocked JSON and HTML without a site or live listener',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'winception-physical-report-'));
  try {
    const env={...process.env};if(env.PSModulePath)env.PSModulePath=env.PSModulePath.split(';').filter(s=>!/codex-runtimes/i.test(s)).join(';');
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('tools/Invoke-WinceptionAcceptance.ps1'),'-ValidateOnly','-ConfigPath',path.join(root,'missing.local.json'),'-ReportRoot',root],{encoding:'utf8',windowsHide:true,timeout:15000,env});
    assert.equal(result.error,undefined);assert.equal(result.status,1,result.stderr);
    assert.ok(fs.existsSync(path.join(root,'result.json')),result.stdout+result.stderr);
    const report=JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8'));
    assert.equal(report.status,'Blocked');assert.equal(report.reason,'Ignored site configuration missing');
    for(const field of ['deployment','network','cleanup'])assert.equal(report[field],'NotRun');
    assert.ok(fs.readFileSync(path.join(root,'result.html'),'utf8').includes('Blocked'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('collector restricts identity, expiry, replay and report-only access', async () => {
  let now = Date.now();
  const config = { testRunId: 'test', clientMac: 'AA-BB-CC-DD-EE-FF', machineId: 'uuid', ticket: 'test-report-only', expiresAt: new Date(now + 60_000).toISOString(), commandPath: '/nonexistent-command' };
  const { server, reports } = createCollector(config, { now: () => now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: `Bearer ${config.ticket}`, 'content-type': 'application/json' };
  const body = { ...config, phase: 'baseline', runId: 'deployment-run', bootId: 'this-boot', nonce: 'one', password: 'MUST-NOT-PERSIST' };
  try {
    assert.equal((await fetch(`${url}/report`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${url}/report`, { method: 'POST', headers, body: JSON.stringify({...body, machineId:'wrong'}) })).status, 403);
    assert.equal((await fetch(`${url}/api/services/start-all`, { method: 'POST', headers })).status, 404);
    assert.equal((await fetch(`${url}/report`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 200);
    assert.equal(JSON.stringify([...reports.values()]).includes('MUST-NOT-PERSIST'), false);
    assert.equal((await fetch(`${url}/report`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 409);
    assert.equal((await fetch(`${url}/report`, { method: 'POST', headers, body: JSON.stringify({...body, phase:'cleanup', nonce:'two', bootId:'another-boot'}) })).status, 403);
    assert.equal((await fetch(`${url}/report`, { method: 'POST', headers, body: JSON.stringify({...body, phase:'post-stop', nonce:'three'}) })).status, 409);
    now += 60_001;
    assert.equal((await fetch(`${url}/command`, { headers })).status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test('independent router DHCP assigns only its pool and supplies no PXE options', () => {
  const config={serverIp:'192.168.177.254',dnsServers:['1.1.1.1','8.8.8.8']};
  const leases=new Map();
  const packet=Buffer.alloc(244);packet[0]=1;packet[1]=1;packet[2]=6;
  packet.writeUInt32BE(0x63825363,236);packet.set([53,1,1,255],240);
  const offer=dhcpReply(packet,config,leases);
  assert.equal(dhcpReply(Buffer.concat([packet.subarray(0,243),Buffer.from([99])]),config,new Map()),null);
  assert.equal([...offer.subarray(16,20)].join('.'),'192.168.177.100');
  const options=new Map();
  for(let n=240;offer[n]!==255;){const code=offer[n++];const size=offer[n++];options.set(code,offer.subarray(n,n+size));n+=size;}
  assert.equal(options.get(53)[0],2);
  assert.equal([...options.get(3)].join('.'),'192.168.177.254');
  for(const code of [43,60,66,67,93,97]) assert.equal(options.has(code),false);
  const foreign=Buffer.concat([packet.subarray(0,240),Buffer.from([53,1,3,54,4,192,168,177,1,255])]);
  assert.equal(dhcpReply(foreign,config,leases),null);
  for(let index=1;index<50;index++){packet[33]=index;assert.ok(dhcpReply(packet,config,leases));}
  packet[33]=50;assert.equal(dhcpReply(packet,config,leases),null);
  assert.equal([...leases.values()].at(-1),'192.168.177.149');
});
test('network acceptance requires exact DHCP gateway DNS and successful Internet probes', () => {
  const expected = { subnet:'192.168.177.0/24',prefixLength:24,gateway:'192.168.177.254',dhcpServer:'192.168.177.254',dnsServers:['1.1.1.1'] };
  const report = { dns:true,https:true,network:{ip:'192.168.177.101',...expected} };
  assert.equal(networkPassed(report,expected),true);
  for (const changed of [{https:false},{dns:false},{network:{...report.network,gateway:'192.168.177.1'}},{network:{...report.network,ip:'192.168.178.101'}}]) assert.equal(networkPassed({...report,...changed},expected),false);
});
