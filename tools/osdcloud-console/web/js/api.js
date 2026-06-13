import { catalogFilterQuery, clearRefineFilters, osCatalogFiltersReady, selectedOsCatalogFilters } from './deploy.js';
import { $ } from './dom.js';
import { render } from './render.js';
import { state } from './state.js';
import { setControlsDisabled } from './ui.js';

export let interfacesLoadPromise = null;
export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function refresh() {
  const query = state.selectedRunId ? `?runId=${encodeURIComponent(state.selectedRunId)}` : '';
  try {
    const payload = await api(`/api/state${query}`);
    state.current = payload.state;
    state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
    state.refreshError = null;
    render();
  } catch (error) {
    state.refreshError = error.message;
    render();
    throw error;
  }
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
      window.alert(error.message);
    } else {
      await refresh();
    }
    return null;
  } finally {
    state.busy = false;
    setControlsDisabled(false);
    render();
  }
}
