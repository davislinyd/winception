import type {
  ApiError,
  AuthStatus,
  CustomScriptCreatePayload,
  DeploymentSnapshotResult,
  DiagnosticsResult,
  EndpointPayload,
  GatewayResult,
  NetworkInterface,
  OperationRecord,
  OsCatalogPayload,
  OsImage,
  OsImagesResult,
  ProfileCreatePayload,
  ProfilesResult,
  ProfileUpdatePayload,
  ScriptContentResult,
  ServicePayload,
  SoftwareCreatePayload,
  SoftwareTestRun,
  SoftwareTestConfigurePayload,
  SoftwareTestStatusResult,
  StagedFileResult,
  SystemState,
  UploadStagedSchema,
} from '../../../../packages/contracts/src/index.js';
import type { Static } from '@sinclair/typebox';

type UploadStaged = Static<typeof UploadStagedSchema>;

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly correctiveAction: string | undefined,
    readonly correlationId: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export const api = Object.freeze({
  authStatus: () => request<AuthStatus>('/api/v2/auth/status'),
  login: (token: string) => request<{ ok: true }>('/api/v2/auth/session', { method: 'POST', body: { token } }),
  logout: () => request<{ ok: true }>('/api/v2/auth/session', { method: 'DELETE' }),
  state: () => request<SystemState>('/api/v2/state'),
  operations: async () => (await request<{ ok: true; result: OperationRecord[] }>('/api/v2/operations')).result,
  startSoftwareTest: (profileId: string) => operation('/api/v2/software-test/start', { profileId }),
  abortSoftwareTest: (runId: string) => result<SoftwareTestRun>('/api/v2/software-test/abort', { runId }),
  configureSoftwareTest: (payload: SoftwareTestConfigurePayload) => operation('/api/v2/software-test/configure', payload),
  softwareTestStatus: () => resultGet<SoftwareTestStatusResult>('/api/v2/software-test/status'),
  updateTorrentSettings: (seedMinutes: number) => operation('/api/v2/torrent/settings', { seedMinutes }),
  releaseTorrentClient: (runId: string, clientId: string) => operation('/api/v2/torrent/release', { runId, clientId }),
  extendTorrentClient: (runId: string, clientId: string) => operation('/api/v2/torrent/extend', { runId, clientId }),
  downloadOsImage: (imageId: string) => operation('/api/v2/os-images/download', { imageId }),
  reexportOsImage: (imageId: string) => operation('/api/v2/os-images/reexport', { imageId }),
  snapshot: (selectedRunId?: string) => result<DeploymentSnapshotResult>('/api/v2/deployment/snapshot', selectedRunId ? { selectedRunId, includeEvidence: true } : { includeEvidence: true }),
  network: () => resultGet<GatewayResult>('/api/v2/network'),
  interfaces: () => resultGet<NetworkInterface[]>('/api/v2/interfaces'),
  profiles: () => resultGet<ProfilesResult>('/api/v2/profiles'),
  osImages: () => resultGet<OsImagesResult>('/api/v2/os-images'),
  osCatalog: (payload: OsCatalogPayload) => result<OsImage[]>('/api/v2/os-images/catalog/query', payload),
  startAllServices: () => operation('/api/v2/services/start-all', {}),
  stopAllServices: () => operation('/api/v2/services/stop-all', {}),
  startService: (name: ServicePayload['name']) => operation('/api/v2/services/start', { name }),
  stopService: (name: ServicePayload['name']) => operation('/api/v2/services/stop', { name }),
  preflight: () => operation('/api/v2/preflight', {}),
  prepareRuntime: () => operation('/api/v2/runtime/prepare', {}),
  runDiagnostics: () => operation('/api/v2/diagnostics', {}),
  createOfflineIso: () => operation('/api/v2/offline-iso', {}),
  updateProjectRoot: (projectRoot: string) => operation('/api/v2/project-root', { projectRoot }),
  updateEndpoint: (payload: EndpointPayload) => operation('/api/v2/endpoint', payload),
  prepareNetwork: (wanInterfaceAlias: string, pxeInterfaceAlias: string, internalSubnet = '192.168.100.0/24') => operation('/api/v2/network/prepare', { wanInterfaceAlias, pxeInterfaceAlias, internalSubnet }),
  removeNetwork: () => operation('/api/v2/network/remove', {}),
  updateBootMode: (mode: 'secureboot' | 'ipxe') => operation('/api/v2/boot-mode', { mode }),
  updateDhcpMode: (mode: 'server' | 'proxy') => operation('/api/v2/dhcp-mode', { mode }),
  publishProfile: (id: string) => operation('/api/v2/profiles/publish', { id }),
  createProfile: (payload: ProfileCreatePayload) => operation('/api/v2/profiles/create', payload),
  updateProfile: (payload: ProfileUpdatePayload) => operation('/api/v2/profiles/update', payload),
  deleteProfile: (id: string) => operation('/api/v2/profiles/delete', { id }),
  deleteOsImage: (id: string) => operation('/api/v2/os-images/delete', { id }),
  createSoftware: async (payload: Omit<SoftwareCreatePayload, 'uploadToken'>, file: File) => {
    const staged = await stageUpload('software', file);
    return operation('/api/v2/software/create', { ...payload, uploadToken: staged.uploadToken });
  },
  deleteSoftware: (id: string) => operation('/api/v2/software/delete', { id }),
  readSoftwareScript: (id: string) => resultGet<ScriptContentResult>(`/api/v2/software/script?id=${encodeURIComponent(id)}`),
  openSoftwareScript: (id: string) => operation('/api/v2/software/script/open', { id }),
  createCustomScript: async (payload: Omit<CustomScriptCreatePayload, 'uploadToken'>, file: File) => {
    const staged = await stageUpload('custom-script', file);
    return operation('/api/v2/custom-scripts/create', { ...payload, uploadToken: staged.uploadToken });
  },
  deleteCustomScript: (id: string) => operation('/api/v2/custom-scripts/delete', { id }),
  readCustomScript: (id: string) => resultGet<ScriptContentResult>(`/api/v2/custom-scripts/content?id=${encodeURIComponent(id)}`),
  saveSecrets: (windowsUsername: string, windowsPassword: string, pxeinstallPassword: string) => operation('/api/v2/secrets', { windowsUsername, windowsPassword, pxeinstallPassword }),
  evidenceAction: (action: 'delete' | 'archive' | 'restore', ids: string[]) => operation(`/api/v2/status/runs/${action}`, { ids }),
  deleteArchivedEvidence: (ids: string[]) => operation('/api/v2/status/archive/delete', { ids }),
  clearEvidence: () => operation('/api/v2/status/clear', {}),
  diagnostics: () => resultGet<DiagnosticsResult>('/api/v2/diagnostics/latest'),
  stageDiagnosticsBundle: (bundleName: string) => result<StagedFileResult>('/api/v2/diagnostics/bundle', { bundleName }),
  upload: stageAndCommit,
});

async function operation(url: string, body: unknown): Promise<string> {
  const response = await request<{ ok: true; operationId: string }>(url, { method: 'POST', body });
  return response.operationId;
}

async function result<T>(url: string, body: unknown): Promise<T> {
  return (await request<{ ok: true; result: T }>(url, { method: 'POST', body })).result;
}

async function resultGet<T>(url: string): Promise<T> {
  return (await request<{ ok: true; result: T }>(url)).result;
}

async function stageAndCommit(kind: 'os-image' | 'software' | 'custom-script', file: File): Promise<string> {
  const staged = await stageUpload(kind, file);
  return operation(`/api/v2/uploads/${kind}/commit`, { uploadToken: staged.uploadToken });
}

async function stageUpload(kind: 'os-image' | 'software' | 'custom-script', file: File): Promise<UploadStaged> {
  const stagedResponse = await fetch(`/api/v2/uploads/${kind}`, {
    method: 'POST', credentials: 'same-origin', body: file,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Winception-Requested-With': 'web',
      'X-Winception-File-Name': encodeURIComponent(file.name),
    },
  });
  const stagedPayload = await stagedResponse.json() as UploadStaged | ApiError;
  if (!stagedResponse.ok || !('uploadToken' in stagedPayload) || typeof stagedPayload.uploadToken !== 'string') {
    throw responseError(stagedPayload as ApiError, stagedResponse.status);
  }
  return stagedPayload;
}

async function request<T>(url: string, options: { method?: 'POST' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  const mutation = options.method !== undefined;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(mutation ? { 'X-Winception-Requested-With': 'web' } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json() as T | ApiError;
  if (!response.ok) {
    throw responseError(payload as ApiError, response.status);
  }
  return payload as T;
}

function responseError(payload: ApiError, status: number): ApiRequestError {
  const detail = payload.error;
  return new ApiRequestError(
    detail?.code ?? 'REQUEST_FAILED',
    detail?.message ?? 'The request failed.',
    detail?.correctiveAction,
    detail?.correlationId,
    status,
  );
}
