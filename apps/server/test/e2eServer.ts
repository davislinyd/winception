import type { AgentCommandName, DeploymentProfile, OperationRecord, OsImage, SystemState } from '../../../packages/contracts/src/index.js';
import { CONTRACT_VERSION, WINCEPTION_V2_VERSION } from '../../../packages/contracts/src/index.js';
import { OperationConflictError, ValidationError } from '../../../packages/domain/src/errors.js';
import { UploadStore } from '../../../packages/infrastructure/src/uploadStore.js';
import { createWebApp } from '../src/app.js';
import type { AgentClientPort } from '../src/ports.js';

const operations: OperationRecord[] = [];

class E2eAgent implements AgentClientPort {
  async request<T>(command: AgentCommandName, payload: unknown): Promise<T> {
    if (command === 'system.state') return state() as T;
    if (command === 'operations.list') return operations as T;
    if (command === 'deployment.snapshot') return snapshot() as T;
    if (command === 'interfaces.list') return interfaces as T;
    if (command === 'network.inspect') return { topology: 'dual-nic-nat', ready: true, detail: 'Gateway ready' } as T;
    if (command === 'profiles.list') return { activeProfile: profile, profiles: [profile], softwareCatalog: [], customScriptCatalog: [], selectedSoftware: [], selectedSoftwareText: '', selectedScripts: [] } as T;
    if (command === 'os-images.list') return images() as T;
    if (command === 'os-images.catalog') return [image] as T;
    if (command === 'diagnostics.latest') return null as T;
    if (command === 'software.script.read') return { softwareId: 'demo-app', filePath: 'install.ps1', content: "Write-Output 'software'" } as T;
    if (command === 'custom-script.read') return { scriptId: 'demo-script', filePath: 'demo.ps1', content: "Write-Output 'script'" } as T;
    if (command === 'diagnostics.run') throw new ValidationError('The diagnostic action is unavailable in this safe E2E fixture.', 'Refresh the snapshot and inspect the recorded evidence.');
    if (command === 'service.start' && active('torrent.settings.update')) throw new OperationConflictError([{ operationId: operations[0]?.id ?? 'e2e-lock', label: 'torrent.settings.update', resources: ['runtime-control'] }]);
    const operationId = `e2e-${operations.length + 1}`;
    operations.unshift({ id: operationId, label: command, resources: ['runtime-control'], status: 'running', startedAt: new Date().toISOString() });
    setTimeout(() => {
      const operation = operations.find((candidate) => candidate.id === operationId);
      if (operation) { operation.status = 'succeeded'; operation.finishedAt = new Date().toISOString(); }
    }, 800).unref();
    return { operationId, payload } as T;
  }
}

const app = await createWebApp({ agent: new E2eAgent(), managementToken: 'winception-e2e-management-token-0000000000000000', secureCookie: false, staticRoot: 'dist/v2/web', uploadStore: new UploadStore('.tmp-v2-e2e-uploads') });
await app.listen({ host: '127.0.0.1', port: 18080 });

function active(label: string): boolean { return operations.some((operation) => operation.label === label && operation.status === 'running'); }
function state(): SystemState { return { app: { version: WINCEPTION_V2_VERSION, contractVersion: CONTRACT_VERSION }, services: { agent: 'connected', deploymentIngress: 'running' }, fleet: { activeRuns: 1 }, operations: operations.filter((operation) => operation.status === 'running'), updatedAt: new Date().toISOString() }; }
function snapshot(): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(), app: { version: WINCEPTION_V2_VERSION },
    config: { endpoint: { interfaceAlias: 'PXE', ipAddress: '192.168.100.1' }, activeProfileName: 'Windows 11', activeOsLabel: 'Windows 11 Pro', torrent: { seedMinutes: 15 } },
    services: {
      http: { running: true, url: 'http://192.168.100.1:8080' }, tftp: { running: false, address: '192.168.100.1:69' }, dhcp: { running: false, address: '192.168.100.1:67' },
      torrent: { running: true, serverIp: '192.168.100.1', trackerPort: 6969, seederRunning: true, seeding: 'install.wim', distribution: { waveId: 'wave-1', batch: 1, coveragePercent: 82, phases: { downloading: 1, seeding: 1, waiting: 1 }, clients: [{ runId: 'run-1', clientId: 'client-01', ip: '192.168.100.101', phase: 'waiting', completedLength: 820, totalLength: 1000, sources: ['192.168.100.102'], receivers: ['192.168.100.103'], seedSecondsRemaining: 540 }, { runId: 'run-2', clientId: 'client-02', ip: '192.168.100.102', phase: 'seeding', completedLength: 1000, totalLength: 1000, sources: [], receivers: ['192.168.100.101'] }] } },
    },
    fleet: { total: 2, counts: { running: 1, completed: 0, failed: 1, stale: 0 }, runs: [{ runId: 'run-1', clientId: 'client-01', clientIp: '192.168.100.101', status: 'running', latestStage: 'windows', latestPercent: 72 }, { runId: 'run-failed', clientId: 'client-failed', clientIp: '192.168.100.104', status: 'failed', latestStage: 'winpe', latestPercent: 18 }] },
    archivedFleet: { total: 0, counts: {}, runs: [] }, preflight: [{ name: 'Runtime', ok: true, blocking: true, detail: 'Ready' }], runtime: { status: 'Ready' }, diagnostics: { headline: 'No diagnostics bundle has been generated.' }, offlineIso: { headline: 'Create a host-side ISO snapshot.' },
    initialization: { status: 'Ready', steps: [{ id: 'endpoint', title: 'Endpoint', detail: 'PXE endpoint selected', status: 'ready' }, { id: 'profile', title: 'Profile', detail: 'Windows 11 published', status: 'ready' }] },
    selectedRunEvents: [{ id: 'event-1', stage: 'windows-start', detail: 'Windows setup started.' }], screenshots: [{ id: 'shot-1' }], logs: { system: ['[SAFE] deployment snapshot loaded', '[SAFE] tracker is serving peers'] },
  };
}

const interfaces = [
  { interfaceAlias: 'Ethernet', interfaceIndex: 1, interfaceDescription: 'WAN', status: 'Up', macAddress: '00-00-00-00-00-01', linkSpeed: '1 Gbps', ipAddress: '10.0.0.10', prefixLength: 24, gateway: '10.0.0.1' },
  { interfaceAlias: 'PXE', interfaceIndex: 2, interfaceDescription: 'Deployment', status: 'Up', macAddress: '00-00-00-00-00-02', linkSpeed: '1 Gbps', ipAddress: '192.168.100.1', prefixLength: 24, gateway: '' },
];
const profile: DeploymentProfile = { id: 'profile-1', name: 'Windows 11', description: 'E2E profile', softwareIds: [], execution: { defaultTimeoutSeconds: 3600 }, installSequence: [], osImageId: 'windows-11' };
const image: OsImage = { id: 'windows-11', name: 'Windows 11 Pro', version: '24H2', releaseId: '24H2', build: '26100', architecture: 'x64', language: 'en-us', locale: 'en-US', timeZone: 'UTC', edition: 'Pro', editionId: 'Professional', activation: 'Retail', imageIndex: 1, fileName: 'install.wim', osFamily: 'win11', size: 1024, sha256: 'a'.repeat(64), sha1: '', url: '', sourceType: 'official', sourceFileName: 'install.esd', sourceContainerType: 'esd', sourceImageIndex: 1, sourceSize: 2048, sourceSha256: 'b'.repeat(64), filePath: 'cache\\install.wim', cached: true, exists: true, bytes: 1024, sizeMatches: true, usedByProfiles: [{ id: profile.id, name: profile.name }] };
function images(): Record<string, unknown> { return { activeImage: image, activeImageId: image.id, activeLabel: image.name, catalogPath: 'catalog.json', downloadSourcesPath: 'sources.json', cacheRoot: 'cache', downloadStagingRoot: 'staging', selectedOsPath: 'selected.json', cacheLogPath: 'cache.log', selectedOs: null, images: [image], cachedFiles: ['install.wim'] }; }
async function stop(): Promise<void> { await app.close(); }
process.once('SIGINT', () => { void stop().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().finally(() => process.exit(0)); });
