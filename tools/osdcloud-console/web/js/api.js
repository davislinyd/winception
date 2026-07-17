import { catalogFilterQuery, clearRefineFilters, osCatalogFiltersReady, selectedOsCatalogFilters } from './deploy.js';
import { $ } from './dom.js';
import { showOperationError } from './errorDialog.js';
import { render } from './render.js';
import { state } from './state.js';
import { setControlsDisabled } from './ui.js';

const tokenStorageKey = 'winception-web-token';

export function storedAuthToken() {
  return window.sessionStorage?.getItem(tokenStorageKey) ?? '';
}

export function saveAuthToken(token) {
  const value = String(token ?? '').trim();
  if (value) {
    window.sessionStorage?.setItem(tokenStorageKey, value);
  } else {
    window.sessionStorage?.removeItem(tokenStorageKey);
  }
  state.auth.error = '';
}

export let interfacesLoadPromise = null;
export let refreshPromise = null;
let queuedEvidenceRefresh = false;
export async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = storedAuthToken();
  if (token) {
    headers.set('x-winception-token', token);
  }
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    if (response.status === 401 && payload.required) {
      state.auth.required = true;
      state.auth.hostMode = payload.hostMode ?? 'non-loopback';
      state.auth.error = payload.error || 'Winception Web Console token required.';
    }
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.code = payload.errorCode || '';
    error.action = payload.errorAction || '';
    throw error;
  }
  return payload;
}

export async function loadAuthStatus() {
  const response = await fetch('/api/auth/status');
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.code = payload.errorCode || '';
    error.action = payload.errorAction || '';
    throw error;
  }
  state.auth = {
    checked: true,
    required: payload.required === true,
    hostMode: payload.hostMode ?? 'loopback',
    error: '',
  };
  return state.auth;
}

export function refresh(options = {}) {
  const includeEvidence = options.includeEvidence === true || state.validationEvidenceOpen === true;
  if (refreshPromise) {
    queuedEvidenceRefresh ||= includeEvidence;
    return refreshPromise;
  }
  const query = new URLSearchParams();
  if (state.selectedRunId) {
    query.set('runId', state.selectedRunId);
  }
  if (includeEvidence) {
    query.set('includeEvidence', '1');
  }
  const startedAt = performance.now();
  refreshPromise = api(`/api/state${query.size ? `?${query}` : ''}`)
    .then((payload) => {
      const requestMs = Math.round((performance.now() - startedAt) * 10) / 10;
      payload.state.health = {
        ...(payload.state.health ?? {}),
        stateRequestMs: requestMs,
        lastSuccessfulRefreshAt: new Date().toISOString(),
        warning: requestMs > 2_000 || (payload.state.health?.stateSnapshotMs ?? 0) > 2_000,
      };
      state.current = payload.state;
      state.updateCheckRequestFailed = false;
      state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
      state.refreshError = null;
      state.auth.error = '';
      render();
      return payload.state;
    })
    .catch((error) => {
      state.refreshError = error.message;
      render();
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
      if (queuedEvidenceRefresh) {
        queuedEvidenceRefresh = false;
        void refresh({ includeEvidence: true }).catch(() => {});
      }
    });
  return refreshPromise;
}

export async function loadInterfaces() {
  if (interfacesLoadPromise) {
    return interfacesLoadPromise;
  }
  state.interfacesLoading = true;
  state.interfacesError = null;
  render();
  interfacesLoadPromise = api('/api/interfaces')
    .then((payload) => {
      state.interfaces = payload.interfaces ?? [];
      state.interfacesError = null;
      return state.interfaces;
    })
    .catch((error) => {
      state.interfacesError = error.message;
      return null;
    })
    .finally(() => {
      state.interfacesLoading = false;
      interfacesLoadPromise = null;
      render();
    });
  return interfacesLoadPromise;
}

export async function loadOsDownloadCatalog() {
  if (state.osDownloadCatalogLoading) {
    return;
  }
  const filters = selectedOsCatalogFilters();
  if (!osCatalogFiltersReady(filters).ready) {
    render();
    return;
  }
  state.osDownloadCatalogLoading = true;
  state.osDownloadCatalogError = null;
  state.osDownloadCatalogLoaded = false;
  state.osDownloadCatalog = [];
  state.osDownloadCatalogFilters = filters;
  clearRefineFilters();
  render();
  try {
    const payload = await api(`/api/os-download-catalog?${catalogFilterQuery(filters)}`);
    state.osDownloadCatalog = payload.catalog ?? [];
    state.osDownloadCatalogLoaded = true;
  } catch (error) {
    state.osDownloadCatalogError = error.message;
  } finally {
    state.osDownloadCatalogLoading = false;
    render();
  }
}

export async function mutate(path, body = null, options = {}) {
  if (state.busy) {
    return;
  }
  const alertOnError = options.alertOnError !== false;
  const rethrow = options.rethrow === true;
  state.busy = true;
  setControlsDisabled(true);
  try {
    const payload = await api(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : '',
    });
    state.current = payload.state;
    state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
    render();
    return payload;
  } catch (error) {
    if (alertOnError) {
      showOperationError(error);
    } else if (!rethrow) {
      await refresh();
    }
    if (rethrow) {
      throw error;
    }
    return null;
  } finally {
    state.busy = false;
    setControlsDisabled(false);
    render();
  }
}
