import type {
  ApiError,
  AuthStatus,
  OperationRecord,
  SystemState,
} from '../../../../packages/contracts/src/index.js';

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
  abortSoftwareTest: (runId: string) => result('/api/v2/software-test/abort', { runId }),
  updateTorrentSettings: (seedMinutes: number) => operation('/api/v2/torrent/settings', { seedMinutes }),
  releaseTorrentClient: (runId: string, clientId: string) => operation('/api/v2/torrent/release', { runId, clientId }),
  extendTorrentClient: (runId: string, clientId: string) => operation('/api/v2/torrent/extend', { runId, clientId }),
  downloadOsImage: (imageId: string) => operation('/api/v2/os-images/download', { imageId }),
  reexportOsImage: (imageId: string) => operation('/api/v2/os-images/reexport', { imageId }),
  snapshot: () => result('/api/v2/deployment/snapshot', {}),
  profiles: () => resultGet('/api/v2/profiles'),
  osImages: () => resultGet('/api/v2/os-images'),
  startAllServices: () => operation('/api/v2/services/start-all', {}),
  stopAllServices: () => operation('/api/v2/services/stop-all', {}),
  preflight: () => operation('/api/v2/preflight', {}),
  prepareRuntime: () => operation('/api/v2/runtime/prepare', {}),
  runDiagnostics: () => operation('/api/v2/diagnostics', {}),
  createOfflineIso: () => operation('/api/v2/offline-iso', {}),
  updateProjectRoot: (projectRoot: string) => operation('/api/v2/project-root', { projectRoot }),
  updateEndpoint: (payload: Record<string, unknown>) => operation('/api/v2/endpoint', payload),
  updateBootMode: (mode: 'secureboot' | 'ipxe') => operation('/api/v2/boot-mode', { mode }),
  updateDhcpMode: (mode: 'server' | 'proxy') => operation('/api/v2/dhcp-mode', { mode }),
  publishProfile: (id: string) => operation('/api/v2/profiles/publish', { id }),
  saveSecrets: (windowsUsername: string, windowsPassword: string, pxeinstallPassword: string) => operation('/api/v2/secrets', { windowsUsername, windowsPassword, pxeinstallPassword }),
  evidenceAction: (action: 'delete' | 'archive' | 'restore', ids: string[]) => operation(`/api/v2/status/runs/${action}`, { ids }),
  clearEvidence: () => operation('/api/v2/status/clear', {}),
  stageDiagnosticsBundle: (bundleName: string) => result('/api/v2/diagnostics/bundle', { bundleName }),
  upload: stageAndCommit,
});

async function operation(url: string, body: unknown): Promise<string> {
  const response = await request<{ ok: true; operationId: string }>(url, { method: 'POST', body });
  return response.operationId;
}

async function result(url: string, body: unknown): Promise<unknown> {
  return (await request<{ ok: true; result: unknown }>(url, { method: 'POST', body })).result;
}

async function resultGet(url: string): Promise<unknown> {
  return (await request<{ ok: true; result: unknown }>(url)).result;
}

async function stageAndCommit(kind: 'os-image' | 'software' | 'custom-script', file: File): Promise<string> {
  const stagedResponse = await fetch(`/api/v2/uploads/${kind}`, {
    method: 'POST', credentials: 'same-origin', body: file,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Winception-Requested-With': 'web',
      'X-Winception-File-Name': encodeURIComponent(file.name),
    },
  });
  const stagedPayload = await stagedResponse.json() as { ok?: true; uploadToken?: string } | ApiError;
  if (!stagedResponse.ok || !('uploadToken' in stagedPayload) || typeof stagedPayload.uploadToken !== 'string') {
    throw responseError(stagedPayload as ApiError, stagedResponse.status);
  }
  return operation(`/api/v2/uploads/${kind}/commit`, { uploadToken: stagedPayload.uploadToken });
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
