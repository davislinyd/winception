// Test-only real UI/API with inert services and an isolated State. Never imports live State.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WebManagementServer } from '../osdcloud-console/src/webServer.js';
import { ServiceController } from '../osdcloud-console/src/controller/index.js';
import { applyServiceEndpoint } from '../osdcloud-console/src/config.js';
import { BootApprovals } from '../osdcloud-console/src/bootApprovals.js';
import { assertNatSubnetAvailable } from '../osdcloud-console/src/windows/networkOptions.js';
import { validateGatewayInput } from '../osdcloud-console/src/windows/gateway.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-ui-'));
const initial = JSON.parse(fs.readFileSync('config/osdcloud-console.json'));
const config = structuredClone(initial);
Object.assign(config.paths, { repoRoot: process.cwd(), appRoot: process.cwd(), stateRoot: root,
  osdCloudRoot: path.join(root, 'runtime'), logsDir: root });
config.__localPath = path.join(root, 'endpoint.local.json');
config.__localConfigPath = config.__localPath;
config.web.host = '127.0.0.1';
config.deploymentProfiles.profilesRoot = path.join(root, 'profiles');
config.osImage.catalogPath = path.join(root, 'images.json');
for (const key of ['http', 'tftp', 'dhcp']) config[key].logPath = path.join(root, 'preview.log');
let scene;
const image = { id: 'PREVIEW-WIN11', version: 'Windows 11', language: 'zh-tw', edition: 'Pro',
  imageIndex: 1, fileName: 'preview.wim', timeZone: 'Taipei Standard Time', cached: true, bytes: 5e9 };
const profile = { id: 'PREVIEW-PROFILE', name: '隔離驗收模擬設定', softwareIds: [], osImageId: image.id };
const lan = { interfaceAlias: 'Wi-Fi', ipAddress: '10.20.30.5', prefixLength: 24,
  gateway: '10.20.30.1', dnsServers: ['10.20.30.1'] };
const inventory = { adapters: [
  { interfaceAlias: 'Wi-Fi', status: 'Up', ipv4: [{ ipAddress: lan.ipAddress, prefixLength: 24 }], gateway: lan.gateway, dnsServers: lan.dnsServers },
  { interfaceAlias: 'USB Ethernet', status: 'Disconnected', ipv4: [], dnsServers: [] },
], routes: [{ interfaceAlias: 'Wi-Fi', destinationPrefix: '10.20.30.0/24' }],
  suggestedSubnet: '192.168.100.0/24', natNetworks: [], icsRunning: false };
class InertService extends EventEmitter {
  running = false;
  async start() { this.running = true; }
  async stop() { this.running = false; }
  refreshLeasePool() {}
}
const services = Object.fromEntries(['http', 'tftp', 'dhcp'].map((key) => [key, new InertService()]));
services.http.bootApprovals = new BootApprovals();
const controller = new ServiceController({ config, services, dependencies: {
  isElevated: () => true, listIpv4ServiceInterfaces: async () => [lan], readNetworkOptions: async () => inventory,
  readFleetStatus: () => ({ total: ['awaiting-windows', 'windows-running'].includes(scene) ? 1 : 0,
    counts: { running: 0, failed: 0, completed: 0, [scene]: 1 }, runs: [] }),
  readArchivedFleet: () => ({ total: 0, counts: {}, runs: [] }), readStatusEvents: () => [],
  readRecentScreenshotMetadata: () => [], readLatestDiagnostics: () => null, summarizeValidation: () => [],
  summarizeDriverPackCache: () => ({ enabled: false, entries: [] }),
  getDeploymentSecretsStatus: () => ({ ready: scene !== 'empty', missing: scene === 'empty' ? ['windowsUsername'] : [], status: {} }),
  getRuntimeReadiness: () => ({ ready: scene !== 'empty', requiredCount: 5, readyCount: scene === 'empty' ? 0 : 5, missingCount: scene === 'empty' ? 5 : 0, artifacts: [], missing: [], summary: [] }),
  resolveDeploymentProfileState: () => ({ catalog: { software: [] }, profiles: scene === 'empty' ? [] : [profile],
    activeProfile: scene === 'empty' ? null : profile, selectedSoftware: [], customScripts: [], selectedCustomScripts: [], options: {} }),
  resolveOsImageState: () => ({ images: scene === 'empty' ? [] : [image], activeImage: scene === 'empty' ? null : image,
    selectedOs: scene === 'empty' ? null : image, activeImageId: scene === 'empty' ? '' : image.id }),
  evaluateDeploymentProfilePayload: () => ({ ok: scene !== 'empty', name: 'Isolated fixture', checks: [] }),
  readSoftwareTestStatus: () => ({ configuration: { configured: false, ready: false }, latest: null }),
} });
function selectCase(name) {
  if (!['empty', 'ready', 'pairing', 'failure', 'warning', 'partial', 'drift', 'host-progress', 'awaiting-windows', 'windows-running'].includes(name)) throw new Error('Unknown preview case');
  scene = name;
  config.initialization.status = name === 'empty' ? 'unconfigured' : 'configured';
  controller.operation = name === 'host-progress' ? { running: true, label: 'Preparing runtime' } : null;
  controller.endpointDrift = name === 'drift';
  controller.preflightResults = name === 'empty' ? [] : [{ name: '模擬網路檢查', ok: name !== 'failure', warn: name === 'warning', detail: name === 'failure' ? '請重新確認接線' : '隔離驗收' }];
  services.http.bootApprovals.clear();
  for (const [key, service] of Object.entries(services)) service.running = !['empty', 'failure', 'drift', 'warning'].includes(name) && !(name === 'partial' && key !== 'http');
  applyServiceEndpoint(config, { ...lan, dhcpMode: name === 'pairing' ? 'proxy' : 'server' });
  fs.writeFileSync(config.__localPath, JSON.stringify({ adapter: config.adapter, http: config.http, tftp: config.tftp, dhcp: config.dhcp, smb: config.smb }));
  if (name === 'pairing') services.http.bootApprovals.submit({ key: { n: 'preview-key', e: 'AQAB' }, nonce: 'preview-nonce', bootId: 'preview-boot',
    clientId: 'Preview client', clientMac: 'AA-BB-CC-DD-EE-FF', runId: 'preview-run', remoteIp: '10.20.30.80' });
}
controller.changeEndpoint = async (choice) => { applyServiceEndpoint(config, choice); controller.endpointDrift = false; return { preview: true }; };
controller.prepareNetworkGateway = async (input) => { validateGatewayInput(input); assertNatSubnetAvailable(input.internalSubnet, inventory); return { preview: true }; };
controller.runPreflight = async () => controller.preflightResults;
controller.shutdown = async () => {};
controller.getOsDownloadCatalog = async () => [];
selectCase('empty');
const server = new WebManagementServer({ controller, startUpdateCheck: false });
const original = server.handleRequest.bind(server);
server.handleRequest = async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if(url.pathname === '/preview-cleanup' && req.method === 'POST') {
    if(!process.env.WINCEPTION_UI_RUN_ID || req.headers['x-preview-run'] !== process.env.WINCEPTION_UI_RUN_ID){res.writeHead(403);res.end();return;}
    fs.rmSync(root,{recursive:true,force:true});res.writeHead(204);res.end();return;
  }
  if (url.pathname === '/preview-case' && req.method === 'POST') {
    selectCase(url.searchParams.get('name')); res.writeHead(204); res.end(); return;
  }
  return original(req, res);
};
try { await server.start({ host: '127.0.0.1', port: 4173 }); }
catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
