const state = {
  current: null,
  selectedRunId: null,
  pendingInterface: null,
  interfaces: [],
  interfacesLoading: false,
  interfacesError: null,
  osDownloadCatalog: [],
  osDownloadCatalogLoaded: false,
  osDownloadCatalogLoading: false,
  osDownloadCatalogError: null,
  osDownloadCatalogFilters: null,
  osDownloadStarting: false,
  osImportInspection: null,
  busy: false,
  clientFleetSignature: '',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let suppressBackdropClickUntil = 0;
let interfacesLoadPromise = null;

const elements = {
  endpointLine: $('#endpoint-line'),
  appVersion: $('#app-version'),
  operationBadge: $('#operation-badge'),
  refreshButton: $('#refresh-button'),
  updatedAt: $('#updated-at'),
  endpointSummary: $('#endpoint-summary'),
  servicesGrid: $('#services-grid'),
  activeProfileDetails: $('#active-profile-details'),
  activeOsDetails: $('#active-os-details'),
  preflightStatusBadge: $('#preflight-status-badge'),
  preflightList: $('#preflight-list'),
  clientsBody: $('#clients-body'),
  fleetCounts: $('#fleet-counts'),
  logs: $('#logs'),
  interfacesBody: $('#interfaces-body'),
  pendingInterfaceLabel: $('#pending-interface-label'),
  profilesBody: $('#profiles-body'),
  payloadSummary: $('#payload-summary'),
  payloadChecks: $('#payload-checks'),
  syncTarget: $('#sync-target'),
  syncChecklist: $('#sync-checklist'),
  syncProgressSubtitle: $('#sync-progress-subtitle'),
  syncProgressTarget: $('#sync-progress-target'),
  syncProgressSteps: $('#sync-progress-steps'),
  syncActionItems: $('#sync-action-items'),
  syncOutput: $('#sync-output'),
  endpointSettingsDialog: $('#endpoint-settings-dialog'),
  deploymentProfilesDialog: $('#deployment-profiles-dialog'),
  osImagesDialog: $('#os-images-dialog'),
  osActiveLabel: $('#os-active-label'),
  osCacheRoot: $('#os-cache-root'),
  osImagesBody: $('#os-images-body'),
  osDownloadCatalogSection: $('#os-download-catalog-section'),
  osDownloadCatalogButton: $('#os-load-catalog-button'),
  osDownloadCatalogBody: $('#os-download-catalog-body'),
  osDownloadStatus: $('#os-download-status'),
  osFilterRelease: $('#os-filter-release'),
  osFilterLanguage: $('#os-filter-language'),
  osUploadFile: $('#os-upload-file'),
  osImportLanguage: $('#os-import-language'),
  osImportRelease: $('#os-import-release'),
  osImportTimeZone: $('#os-import-timezone'),
  osImportEdition: $('#os-import-edition'),
  osImportActivation: $('#os-import-activation'),
  osImportStatus: $('#os-import-status'),
  osImportIndexesBody: $('#os-import-indexes-body'),
  validationEvidenceDialog: $('#validation-evidence-dialog'),
  validationRunId: $('#validation-run-id'),
  validationRunSummary: $('#validation-run-summary'),
  targetEvidence: $('#target-evidence'),
  runTiming: $('#run-timing'),
  screenshotEvidence: $('#screenshot-evidence'),
  ipxeEvidence: $('#ipxe-evidence'),
  httpEvidence: $('#http-evidence'),
  eventTimeline: $('#event-timeline'),
  validationList: $('#validation-list'),
  pickerDialog: $('#picker-dialog'),
  pickerTitle: $('#picker-title'),
  pickerList: $('#picker-list'),
  profileDialog: $('#profile-dialog'),
  profileForm: $('#profile-form'),
  profileName: $('#profile-name'),
  profileDescription: $('#profile-description'),
  profileIdPreview: $('#profile-id-preview'),
  profileSoftwareBaseline: $('#profile-software-baseline'),
  profileCancel: $('#profile-cancel'),
  profileCancelSecondary: $('#profile-cancel-secondary'),
  profileError: $('#profile-error'),
  softwareDialog: $('#software-dialog'),
  softwareForm: $('#software-form'),
  softwareCancel: $('#software-cancel'),
  softwareCancelSecondary: $('#software-cancel-secondary'),
  softwareProfileSummary: $('#software-profile-summary'),
  softwareProfileId: $('#software-profile-id'),
  softwareProfileName: $('#software-profile-name'),
  softwareProfileDescription: $('#software-profile-description'),
  softwareSelectAll: $('#software-select-all'),
  softwareSelectNone: $('#software-select-none'),
  softwareList: $('#software-list'),
  softwareError: $('#software-error'),
  confirmDialog: $('#confirm-dialog'),
  confirmTitle: $('#confirm-title'),
  confirmMessage: $('#confirm-message'),
  confirmDetails: $('#confirm-details'),
  confirmSubmit: $('#confirm-submit'),
};

const syncSteps = [
  ['Stop running services', ['stopped running services'], ['selected']],
  ['Persist config/osdcloud-tui.json', ['saved'], ['updating config']],
  ['Recalculate DHCP pool and subnet guard', ['saved'], ['updating config', 'dhcp']],
  ['Update live boot.ipxe', ['endpoint files synced'], ['syncing boot.ipxe']],
  ['Update WinPE endpoint files', ['endpoint files synced'], ['syncing boot.ipxe']],
  ['Update SMB firewall for selected service subnet', ['endpoint files synced'], ['smb firewall']],
  ['Commit endpoint into boot.wim', ['endpoint files synced'], ['boot.wim']],
  ['Verify published boot.wim', ['published boot.wim verified'], ['boot.wim']],
  ['Refresh osdcloud-assets', ['endpoint files synced'], ['osdcloud-assets']],
  ['Rerun preflight', ['preflight passed', 'preflight completed'], ['running preflight']],
];

const osFamilyLabels = new Map([
  ['win11', 'Windows 11'],
]);

function text(value, fallback = '-') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function percent(value) {
  return Number.isFinite(value) ? `${value}%` : '-';
}

function bytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = number;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function osImageLabel(image) {
  if (!image) {
    return '-';
  }
  const version = image.version || image.releaseId || image.build || 'Windows';
  return `${version} ${text(image.language)} ${text(image.edition)} index ${text(image.imageIndex)}`;
}

function elapsed(seconds) {
  if (!Number.isFinite(seconds)) {
    return '-';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function twoDigit(value) {
  return String(value).padStart(2, '0');
}

function localTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function localCompactDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return [
    `${date.getFullYear()}/${twoDigit(date.getMonth() + 1)}/${twoDigit(date.getDate())}`,
    `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}`,
  ].join(' ');
}

function localDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function endpointLabel(config) {
  const adapter = config?.adapter ?? {};
  return `${text(adapter.interfaceAlias)} ${text(adapter.serverIp)}/${text(adapter.prefixLength)}`;
}

function dhcpRange(config) {
  return `${text(config?.dhcp?.leaseStartIp)} - ${text(config?.dhcp?.leaseEndIp)}`;
}

async function api(path, options = {}) {
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

async function refresh() {
  const query = state.selectedRunId ? `?runId=${encodeURIComponent(state.selectedRunId)}` : '';
  const payload = await api(`/api/state${query}`);
  state.current = payload.state;
  state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
  render();
}

async function loadInterfaces() {
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

async function loadOsDownloadCatalog() {
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

async function mutate(path, body = null) {
  if (state.busy) {
    return;
  }
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
    window.alert(error.message);
    return null;
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

function setControlsDisabled(disabled) {
  $$('button[data-action], dialog button, dialog input, dialog textarea').forEach((control) => {
    control.disabled = disabled;
  });
}

function openDialog(dialog) {
  if (!dialog.open) {
    dialog.showModal();
  }
}

function closeDialog(dialog, returnValue = '') {
  if (dialog.open) {
    dialog.close(returnValue);
  }
}

function cancelDialog(dialog) {
  if (!dialog.open) {
    return;
  }
  const cancelEvent = new Event('cancel', { cancelable: true });
  const shouldClose = dialog.dispatchEvent(cancelEvent);
  if (shouldClose && dialog.open) {
    closeDialog(dialog, 'cancel');
  }
}

function enableBackdropClose(dialog) {
  dialog.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target !== dialog) {
      return;
    }
    event.preventDefault();
    suppressBackdropClickUntil = performance.now() + 500;
    cancelDialog(dialog);
  });
}

function enableBackdropCloseForDialogs() {
  $$('dialog').forEach((dialog) => enableBackdropClose(dialog));
}

function suppressBackdropCloseClickThrough(event) {
  if (performance.now() > suppressBackdropClickUntil) {
    return;
  }
  suppressBackdropClickUntil = 0;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function setDefinitionList(element, rows) {
  element.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = text(value);
    element.append(dt, dd);
  }
}

function makeStatusPill(label, status = 'neutral') {
  const pill = document.createElement('span');
  pill.className = `status-pill ${status}`;
  pill.textContent = label;
  return pill;
}

function makeIcon(name, className = '') {
  const icon = document.createElement('span');
  icon.className = `material-symbols-outlined ${className}`.trim();
  icon.textContent = name;
  return icon;
}

function renderEndpointSummary(appState) {
  const config = appState.config;
  const cards = [
    ['lan', 'LAN', endpointLabel(config)],
    ['http', 'HTTP', `http://${text(config.http.host)}${Number(config.http.port) === 80 ? '' : `:${config.http.port}`}/osdcloud`],
    ['folder_shared', 'SMB', config.smb?.share],
    ['router', 'DHCP Pool', dhcpRange(config)],
    ['dns', 'DNS', config.dhcp?.dnsServers?.join(', ')],
  ];
  elements.endpointSummary.replaceChildren();
  for (const [iconName, label, value] of cards) {
    const card = document.createElement('article');
    card.className = 'summary-card';
    card.append(makeIcon(iconName, 'card-icon'));
    const title = document.createElement('span');
    title.textContent = `${label}:`;
    const body = document.createElement('strong');
    body.className = 'mono';
    body.textContent = text(value);
    card.append(title, body);
    elements.endpointSummary.append(card);
  }
}

function renderOperation(appState) {
  const operation = appState.operation;
  elements.operationBadge.className = 'badge neutral';
  if (!operation) {
    elements.operationBadge.textContent = 'Idle';
    return;
  }
  elements.operationBadge.textContent = operation.running ? operation.label : `${operation.status}: ${operation.label}`;
  if (operation.running) {
    elements.operationBadge.className = 'badge running';
  } else if (operation.status === 'failed') {
    elements.operationBadge.className = 'badge failed';
  }
}

function serviceAddress(service) {
  if (service.port !== undefined && service.host !== undefined) {
    return `${service.host}:${service.port}`;
  }
  if (service.port !== undefined && service.listenIp !== undefined) {
    return `${service.listenIp}:${service.port}`;
  }
  if (service.listenPort !== undefined && service.listenIp !== undefined) {
    return `${service.listenIp}:${service.listenPort}`;
  }
  return '-';
}

function renderServices(appState) {
  const rows = [
    ['http', 'HTTP Server', appState.services.http, 'http-toggle', 'HTTP'],
    ['upload_file', 'TFTP Server', appState.services.tftp, 'tftp-toggle', 'TFTP'],
    ['router', 'DHCP Server', appState.services.dhcp, 'dhcp-toggle', 'DHCP'],
  ];
  elements.servicesGrid.replaceChildren();
  for (const [iconName, name, service, action, actionName] of rows) {
    const row = document.createElement('div');
    const actionLabel = `${service.running ? 'Stop' : 'Start'} ${actionName}`;
    row.className = 'service-card service-row service-card-action';
    row.dataset.action = action;
    row.dataset.serviceState = service.running ? 'running' : 'stopped';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', actionLabel);
    row.title = actionLabel;
    const head = document.createElement('div');
    head.className = 'service-row-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'service-title';
    titleWrap.append(makeIcon(iconName, 'service-icon'));
    const title = document.createElement('strong');
    title.textContent = name;
    titleWrap.append(title);
    head.append(titleWrap, makeStatusPill(service.running ? 'Running' : 'Stopped', service.running ? 'ok' : 'neutral'));
    const address = document.createElement('code');
    address.className = 'service-address';
    address.textContent = serviceAddress(service);
    const footer = document.createElement('div');
    footer.className = 'service-card-footer';
    const cardAction = document.createElement('span');
    cardAction.className = `service-card-cta${action === 'dhcp-toggle' && !service.running ? ' danger' : ''}`;
    cardAction.dataset.icon = service.running ? 'stop' : 'play_arrow';
    cardAction.textContent = actionLabel;
    const switchVisual = document.createElement('div');
    switchVisual.className = `service-switch${service.running ? ' running' : ''}`;
    footer.append(cardAction, switchVisual);
    row.append(head, address, footer);
    elements.servicesGrid.append(row);
  }

  setActionLabel('http-toggle', `${appState.services.http.running ? 'Stop' : 'Start'} HTTP`);
  setActionLabel('tftp-toggle', `${appState.services.tftp.running ? 'Stop' : 'Start'} TFTP`);
  setActionLabel('dhcp-toggle', `${appState.services.dhcp.running ? 'Stop' : 'Start'} DHCP`);
  setActionRunning('http-toggle', appState.services.http.running);
  setActionRunning('tftp-toggle', appState.services.tftp.running);
  setActionRunning('dhcp-toggle', appState.services.dhcp.running);
  setActionDanger('dhcp-toggle', !appState.services.dhcp.running);
  const allServicesRunning = ['http', 'tftp', 'dhcp'].every((name) => appState.services[name]?.running);
  setActionLabel('all-services-toggle', allServicesRunning ? 'Stop all services' : 'Start all services');
  setActionIcon('all-services-toggle', allServicesRunning ? 'stop' : 'play_arrow');
  setActionRunning('all-services-toggle', allServicesRunning);
  setActionDanger('all-services-toggle', !allServicesRunning);
}

function actionButtons(action) {
  return $$(`button[data-action="${action}"]`);
}

function setActionLabel(action, label) {
  actionButtons(action).forEach((button) => {
    button.textContent = label;
  });
}

function setActionIcon(action, icon) {
  actionButtons(action).forEach((button) => {
    button.dataset.icon = icon;
  });
}

function setActionRunning(action, running) {
  actionButtons(action).forEach((button) => {
    button.classList.toggle('is-running', running);
    button.dataset.running = running ? 'true' : 'false';
  });
}

function setActionDanger(action, danger) {
  actionButtons(action).forEach((button) => {
    button.classList.toggle('danger', danger);
  });
}

function renderProfileSummary(appState) {
  elements.activeProfileDetails.replaceChildren();
  if (appState.profile?.error) {
    const error = document.createElement('div');
    error.className = 'check-row fail';
    error.textContent = appState.profile.error;
    elements.activeProfileDetails.append(error);
    return;
  }
  const active = appState.profile?.activeProfile;
  const name = document.createElement('div');
  name.className = 'profile-name';
  name.textContent = active ? `${active.id} / ${active.name}` : '-';
  const description = document.createElement('div');
  description.className = 'profile-meta';
  description.textContent = active?.description || 'No profile description.';
  const software = document.createElement('div');
  software.className = 'profile-software';
  const selectedSoftware = appState.profile?.selectedSoftware ?? [];
  if (selectedSoftware.length) {
    const list = document.createElement('ul');
    selectedSoftware.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item.name ?? item.id;
      list.append(li);
    });
    software.append(list);
  } else {
    software.textContent = 'No client software selected.';
  }
  elements.activeProfileDetails.append(name, description, software);
}

function appendTextCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text(value);
  if (className) {
    cell.className = className;
  }
  row.append(cell);
  return cell;
}

function appendFleetLastSeenCell(row, value) {
  const cell = document.createElement('td');
  cell.className = 'fleet-last-seen-cell';
  cell.textContent = localCompactDateTime(value);
  row.append(cell);
  return cell;
}

function checkedValues(name) {
  return $$(`input[name="${name}"]:checked`).map((input) => input.value);
}

function selectedOsCatalogFilters() {
  return {
    osFamily: ['win11'],
    edition: ['Pro'],
    activation: ['Retail'],
    language: checkedValues('os-catalog-language'),
    releaseId: checkedValues('os-catalog-release'),
  };
}

function osCatalogFiltersReady(filters = selectedOsCatalogFilters()) {
  const missing = [];
  if (!filters.language.length) {
    missing.push('language');
  }
  if (!filters.releaseId.length) {
    missing.push('release');
  }
  return {
    ready: missing.length === 0,
    missing,
  };
}

function catalogReadinessMessage(readiness) {
  const missing = readiness?.missing ?? [];
  if (missing.includes('language') && missing.includes('release')) {
    return 'Select language and at least one release before loading the catalog.';
  }
  if (missing.includes('release')) {
    return 'Select at least one release before loading the catalog.';
  }
  if (missing.includes('language')) {
    return 'Select language before loading the catalog.';
  }
  return '';
}

function catalogFilterQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(filters)) {
    if (values.length) {
      params.set(key, values.join(','));
    }
  }
  return params.toString();
}

function clearRefineFilters() {
  [
    elements.osFilterRelease,
    elements.osFilterLanguage,
  ].forEach((select) => {
    if (select) {
      select.value = '';
    }
  });
}

function formatOsFamily(value) {
  return osFamilyLabels.get(String(value ?? '').toLowerCase()) ?? text(value);
}

function formatCatalogFilterSummary(filters = state.osDownloadCatalogFilters) {
  if (!filters) {
    return '';
  }
  const parts = [
    'Windows 11 Pro Retail',
    ...filters.language,
    ...filters.releaseId,
  ];
  return parts.join(', ');
}

function renderOsImageSummary(appState) {
  elements.activeOsDetails.replaceChildren();
  const osState = appState.osImage;
  if (osState?.error) {
    const error = document.createElement('div');
    error.className = 'check-row fail';
    error.textContent = osState.error;
    elements.activeOsDetails.append(error);
    return;
  }
  const active = osState?.activeImage;
  const title = document.createElement('div');
  title.className = 'profile-name';
  title.textContent = active ? active.id : '-';
  const meta = document.createElement('div');
  meta.className = 'profile-meta';
  meta.textContent = active ? osImageLabel(active) : 'No active OS image.';
  const cache = document.createElement('div');
  cache.className = 'profile-software active-os-cache-line';
  cache.append(makeStatusPill(active?.cached ? 'Cached' : 'Missing', active?.cached ? 'ok' : 'fail'));
  const file = document.createElement('code');
  file.className = 'service-address active-os-cache-file';
  file.textContent = active?.fileName ?? '-';
  cache.append(file);
  elements.activeOsDetails.append(title, meta, cache);
}

function renderOsDownloadStatus(appState) {
  const readiness = osCatalogFiltersReady();
  if (elements.osDownloadCatalogSection) {
    elements.osDownloadCatalogSection.setAttribute('aria-busy', state.osDownloadCatalogLoading ? 'true' : 'false');
  }
  if (elements.osDownloadCatalogButton) {
    elements.osDownloadCatalogButton.disabled = state.osDownloadCatalogLoading || state.busy || !readiness.ready;
    elements.osDownloadCatalogButton.dataset.icon = state.osDownloadCatalogLoading ? 'hourglass_top' : 'download';
    elements.osDownloadCatalogButton.textContent = state.osDownloadCatalogLoading ? 'Loading catalog...' : 'Load download catalog';
  }
  if (state.osDownloadCatalogLoading) {
    elements.osDownloadStatus.textContent = 'Loading Microsoft official Windows image catalog...';
    return;
  }
  if (state.osDownloadCatalogError) {
    elements.osDownloadStatus.textContent = `Catalog load failed: ${state.osDownloadCatalogError}`;
    return;
  }
  const status = appState.osDownloadStatus;
  if (status) {
    const total = status.totalBytes ? ` / ${bytes(status.totalBytes)}` : '';
    elements.osDownloadStatus.textContent = `${text(status.status)} ${text(status.fileName ?? status.catalogId)} ${bytes(status.bytes)}${total}`;
    return;
  }
  if (!readiness.ready) {
    elements.osDownloadStatus.textContent = catalogReadinessMessage(readiness);
    return;
  }
  const summary = formatCatalogFilterSummary();
  elements.osDownloadStatus.textContent = state.osDownloadCatalogLoaded
    ? `${state.osDownloadCatalog.length} downloadable row(s) loaded${summary ? ` for ${summary}` : ''}.`
    : 'Host-side downloads only.';
}

function selectOptions(select, values, emptyLabel) {
  const current = select.value;
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = emptyLabel;
  select.append(empty);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = values.includes(current) ? current : '';
}

function renderOsCatalogFilters() {
  if (!state.osDownloadCatalogLoaded) {
    selectOptions(elements.osFilterRelease, [], 'All loaded releases');
    selectOptions(elements.osFilterLanguage, [], 'All loaded languages');
    [
      elements.osFilterRelease,
      elements.osFilterLanguage,
    ].forEach((select) => { select.disabled = true; });
    return;
  }
  const unique = (field) => [...new Set(state.osDownloadCatalog.map((image) => image[field]).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }));
  selectOptions(elements.osFilterRelease, unique('releaseId'), 'All loaded releases');
  selectOptions(elements.osFilterLanguage, unique('language'), 'All loaded languages');
  [
    elements.osFilterRelease,
    elements.osFilterLanguage,
  ].forEach((select) => { select.disabled = state.osDownloadCatalog.length === 0; });
}

function filteredOsDownloadCatalog() {
  const release = elements.osFilterRelease.value;
  const language = elements.osFilterLanguage.value;
  return state.osDownloadCatalog.filter((image) => (
    (!release || image.releaseId === release)
    && (!language || image.language === language)
  ));
}

function renderOsImportStatus(appState) {
  const status = appState.osImportStatus;
  if (status) {
    elements.osImportStatus.textContent = `${text(status.status)} ${text(status.fileName ?? status.sourcePath)} ${bytes(status.bytes)}`;
    return;
  }
  if (state.osImportInspection) {
    const source = `upload ${state.osImportInspection.originalFileName ?? state.osImportInspection.uploadId}`;
    elements.osImportStatus.textContent = `${state.osImportInspection.indexes?.length ?? 0} image index(es) found in ${source}`;
    return;
  }
  elements.osImportStatus.textContent = 'Upload local ISO/ESD/WIM only.';
}

function importMetadataFromInputs(suggested = {}) {
  return {
    ...suggested,
    language: elements.osImportLanguage.value.trim() || suggested.language,
    releaseId: elements.osImportRelease.value.trim() || suggested.releaseId,
    timeZone: elements.osImportTimeZone.value.trim() || suggested.timeZone,
    edition: elements.osImportEdition.value.trim() || suggested.edition,
    activation: elements.osImportActivation.value.trim() || suggested.activation,
  };
}

function fillImportMetadataDefaults(suggested = {}) {
  elements.osImportLanguage.value = suggested.language ?? '';
  elements.osImportRelease.value = suggested.releaseId ?? '';
  elements.osImportTimeZone.value = suggested.timeZone ?? '';
  elements.osImportEdition.value = suggested.edition ?? '';
  elements.osImportActivation.value = suggested.activation ?? '';
}

function renderOsImportIndexes(appState) {
  elements.osImportIndexesBody.replaceChildren();
  renderOsImportStatus(appState);
  const indexes = state.osImportInspection?.indexes ?? [];
  if (!indexes.length) {
    const tr = document.createElement('tr');
    const td = appendTextCell(tr, 'Upload a local ISO/ESD/WIM source before importing.');
    td.colSpan = 6;
    elements.osImportIndexesBody.append(tr);
    return;
  }
  for (const row of indexes) {
    const image = row.suggested ?? {};
    const tr = document.createElement('tr');
    appendTextCell(tr, row.imageIndex);
    appendTextCell(tr, row.name || image.name || '-');
    appendTextCell(tr, image.language);
    appendTextCell(tr, image.releaseId || image.build || '-');
    appendTextCell(tr, image.fileName);
    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Import';
    button.className = 'warning';
    button.dataset.icon = 'file_upload';
    button.dataset.osImportAction = 'import';
    button.dataset.osImportIndex = String(row.imageIndex);
    actionCell.append(button);
    tr.append(actionCell);
    elements.osImportIndexesBody.append(tr);
  }
}

function renderOsImages(appState) {
  const osState = appState.osImage;
  elements.osImagesBody.replaceChildren();
  elements.osDownloadCatalogBody.replaceChildren();
  elements.osActiveLabel.textContent = osState?.error ? osState.error : osState?.activeLabel ?? '-';
  elements.osCacheRoot.textContent = osState?.cacheRoot ?? '';
  renderOsDownloadStatus(appState);
  renderOsCatalogFilters();
  renderOsImportIndexes(appState);

  if (osState?.error) {
    const tr = document.createElement('tr');
    const td = appendTextCell(tr, osState.error);
    td.colSpan = 7;
    elements.osImagesBody.append(tr);
  } else {
    const activeId = osState?.activeImageId;
    for (const image of osState?.images ?? []) {
      const tr = document.createElement('tr');
      const active = image.id === activeId;
      if (active) {
        tr.classList.add('selected');
      }
      const statusCell = document.createElement('td');
      statusCell.append(makeStatusPill(active ? 'Active' : 'Available', active ? 'ok' : 'neutral'));
      tr.append(statusCell);
      appendTextCell(tr, `${image.id} / ${image.name}`);
      appendTextCell(tr, image.language);
      appendTextCell(tr, image.edition);
      appendTextCell(tr, image.imageIndex);
      appendTextCell(tr, image.cached ? `${bytes(image.bytes)} cached` : 'missing');
      const actionCell = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = active ? 'Active' : 'Set active';
      button.className = active ? '' : 'warning';
      button.dataset.icon = active ? 'check' : 'published_with_changes';
      button.dataset.osImageAction = 'select';
      button.dataset.osImageId = image.id;
      button.disabled = active || !image.cached;
      actionCell.append(button);
      if (!active) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'danger';
        deleteButton.textContent = 'Delete';
        deleteButton.dataset.icon = 'delete';
        deleteButton.dataset.osImageAction = 'delete';
        deleteButton.dataset.osImageId = image.id;
        actionCell.append(' ', deleteButton);
      }
      tr.append(actionCell);
      elements.osImagesBody.append(tr);
    }
    if (!(osState?.images ?? []).length) {
      const tr = document.createElement('tr');
      const td = appendTextCell(tr, 'No OS images are defined in the catalog.');
      td.colSpan = 7;
      elements.osImagesBody.append(tr);
    }
  }

  if (!state.osDownloadCatalogLoaded) {
    const tr = document.createElement('tr');
    const td = appendTextCell(
      tr,
      state.osDownloadCatalogLoading
        ? 'Loading Microsoft official Windows image catalog...'
          : state.osDownloadCatalogError
            ? `Catalog load failed: ${state.osDownloadCatalogError}`
            : 'Select language and release, then load the Microsoft official OSD module catalog.',
      state.osDownloadCatalogLoading ? 'catalog-loading-cell' : state.osDownloadCatalogError ? 'catalog-error-cell' : '',
    );
    td.colSpan = 7;
    elements.osDownloadCatalogBody.append(tr);
    return;
  }
  if (state.osDownloadCatalogLoading || state.osDownloadCatalogError) {
    const tr = document.createElement('tr');
    const td = appendTextCell(
      tr,
      state.osDownloadCatalogLoading
        ? 'Loading Microsoft official Windows image catalog...'
        : `Catalog load failed: ${state.osDownloadCatalogError}`,
      state.osDownloadCatalogLoading ? 'catalog-loading-cell' : 'catalog-error-cell',
    );
    td.colSpan = 7;
    elements.osDownloadCatalogBody.append(tr);
    return;
  }
  const catalogRows = filteredOsDownloadCatalog();
  const downloadStatus = appState.osDownloadStatus;
  const downloadRunning = Boolean(downloadStatus?.running) || state.osDownloadStarting;
  for (const image of catalogRows) {
    const tr = document.createElement('tr');
    appendTextCell(tr, formatOsFamily(image.osFamily));
    appendTextCell(tr, `${image.id} / ${image.name}`);
    appendTextCell(tr, image.language);
    appendTextCell(tr, image.edition);
    appendTextCell(tr, image.imageIndex);
    appendTextCell(tr, image.fileName);
    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Download';
    button.className = 'warning';
    button.dataset.icon = 'download';
    button.dataset.osDownloadAction = 'download';
    button.dataset.osDownloadId = image.id;
    if (downloadRunning) {
      button.disabled = true;
      if (downloadStatus?.catalogId === image.id) {
        const total = downloadStatus.totalBytes ? ` / ${bytes(downloadStatus.totalBytes)}` : '';
        button.textContent = downloadStatus.status === 'starting'
          ? 'Starting...'
          : `Downloading ${bytes(downloadStatus.bytes)}${total}`;
        button.dataset.icon = 'hourglass_top';
      }
    }
    actionCell.append(button);
    tr.append(actionCell);
    elements.osDownloadCatalogBody.append(tr);
  }
  if (!catalogRows.length) {
    const tr = document.createElement('tr');
    const td = appendTextCell(tr, state.osDownloadCatalog.length === 0
      ? 'No catalog rows matched the selected filters.'
      : 'No downloadable Windows images match the current refine filters.');
    td.colSpan = 7;
    elements.osDownloadCatalogBody.append(tr);
  }
}

function showValidationEvidence(runId) {
  if (!runId) {
    return;
  }
  state.selectedRunId = runId;
  openDialog(elements.validationEvidenceDialog);
  refresh().catch((error) => window.alert(error.message));
}

function openValidationEvidenceFromTarget(target) {
  const origin = target instanceof Element ? target : target?.parentElement;
  if (!origin) {
    return false;
  }
  const evidenceTarget = origin.closest('[data-run-action="evidence"]');
  if (!evidenceTarget) {
    return false;
  }
  const runId = evidenceTarget.dataset.runId ?? evidenceTarget.closest('[data-run-id]')?.dataset.runId;
  if (!runId) {
    return false;
  }
  showValidationEvidence(runId);
  return true;
}

function renderClients(appState) {
  const counts = appState.fleet?.counts ?? {};
  elements.fleetCounts.textContent = `total=${appState.fleet?.total ?? 0} running=${counts.running ?? 0} completed=${counts.completed ?? 0} failed=${counts.failed ?? 0}`;
  const runs = appState.fleet?.runs ?? [];
  const fleetSignature = JSON.stringify({
    selectedRunId: state.selectedRunId,
    runs: runs.map((run) => [
      run.status,
      run.clientId,
      run.runId,
      run.latestStage,
      run.latestPercent,
      run.lastReceivedAt,
      run.elapsedSeconds,
    ]),
  });
  if (state.clientFleetSignature === fleetSignature && elements.clientsBody.childElementCount) {
    return;
  }
  state.clientFleetSignature = fleetSignature;
  elements.clientsBody.replaceChildren();
  for (const run of runs) {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.dataset.action = 'run-evidence';
    tr.dataset.runAction = 'evidence';
    tr.dataset.runId = run.runId;
    tr.title = `Open validation evidence for ${run.runId}`;
    if (run.runId === state.selectedRunId) {
      tr.classList.add('selected');
    }

    const statusCell = document.createElement('td');
    statusCell.className = 'status-evidence-cell';
    statusCell.append(makeStatusPill(text(run.status), run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'fail' : 'working'));
    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.textContent = 'View';
    viewButton.dataset.action = 'run-evidence';
    viewButton.dataset.icon = 'fact_check';
    viewButton.dataset.runAction = 'evidence';
    viewButton.dataset.runId = run.runId;
    statusCell.append(viewButton);
    tr.append(statusCell);
    for (const value of [
      run.clientId,
      run.runId,
      run.latestStage,
      percent(run.latestPercent),
    ]) {
      appendTextCell(tr, value);
    }
    appendFleetLastSeenCell(tr, run.lastReceivedAt);
    appendTextCell(tr, elapsed(run.elapsedSeconds));
    elements.clientsBody.append(tr);
  }
  if (!runs.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.textContent = 'No deployment clients have reported status yet.';
    tr.append(td);
    elements.clientsBody.append(tr);
  }
}

function renderChecks(element, checks, emptyText = 'No data observed yet.') {
  element.replaceChildren();
  if (!checks?.length) {
    const empty = document.createElement('div');
    empty.className = 'check-row unknown';
    empty.textContent = emptyText;
    element.append(empty);
    return;
  }
  for (const check of checks) {
    const row = document.createElement('div');
    const status = check.ok === true ? 'ok' : check.ok === false ? 'fail' : 'unknown';
    row.className = `check-row ${status}`;
    const name = document.createElement('strong');
    name.textContent = `${check.ok === true ? 'PASS' : check.ok === false ? 'FAIL' : 'UNKNOWN'} ${check.name}`;
    const detail = document.createElement('span');
    const detailText = check.detail ?? '';
    detail.textContent = detailText;
    detail.title = detailText;
    row.title = `${name.textContent}${detailText ? `\n${detailText}` : ''}`;
    row.append(name, detail);
    element.append(row);
  }
}

function preflightStatus(checks) {
  if (!checks?.length) {
    return ['Not run', 'neutral'];
  }
  if (checks.some((check) => check.ok === false)) {
    return ['Blocked', 'fail'];
  }
  if (checks.every((check) => check.ok === true)) {
    return ['Ready', 'ok'];
  }
  return ['Review', 'working'];
}

function renderPreflightSummary(checks) {
  elements.preflightList.replaceChildren();
  const [label, status] = preflightStatus(checks);
  elements.preflightStatusBadge.textContent = label;
  elements.preflightStatusBadge.className = `status-pill ${status}`;
  if (!checks?.length) {
    const empty = document.createElement('div');
    empty.className = 'preflight-empty';
    empty.textContent = 'Run preflight to show endpoint readiness.';
    elements.preflightList.append(empty);
    return;
  }

  const issues = checks
    .filter((check) => check.ok !== true)
    .sort((a, b) => {
      if (a.ok === false && b.ok !== false) {
        return -1;
      }
      if (a.ok !== false && b.ok === false) {
        return 1;
      }
      return 0;
    });
  const passedCount = checks.filter((check) => check.ok === true).length;
  const rows = issues.length ? issues : [];

  for (const check of rows) {
    const statusName = check.ok === true ? 'ok' : check.ok === false ? 'fail' : 'unknown';
    const row = document.createElement('div');
    row.className = `preflight-row ${statusName}`;
    const dot = document.createElement('span');
    dot.className = `preflight-dot ${statusName}`;
    dot.title = check.ok === true ? 'PASS' : check.ok === false ? 'FAIL' : 'REVIEW';
    const name = document.createElement('strong');
    name.textContent = text(check.name);
    const detail = document.createElement('span');
    const detailText = text(check.detail);
    detail.textContent = detailText;
    detail.title = detailText;
    row.title = `${dot.title} ${name.textContent}${detailText ? `\n${detailText}` : ''}`;
    row.append(dot, name, detail);
    elements.preflightList.append(row);
  }

  if (passedCount > 0 || !issues.length) {
    const summary = document.createElement('div');
    summary.className = 'preflight-row summary ok';
    const dot = document.createElement('span');
    dot.className = 'preflight-dot ok';
    dot.title = 'PASS';
    const detail = document.createElement('span');
    detail.textContent = issues.length ? `${passedCount} checks passed` : `All ${passedCount} checks passed`;
    summary.append(dot, detail);
    elements.preflightList.append(summary);
  }
}

function roleForInterface(item) {
  const alias = String(item.interfaceAlias ?? '').toLowerCase();
  const ip = String(item.ipAddress ?? '');
  if (alias === 'lan' || ip.startsWith('192.168.88.')) {
    return 'physical-client path';
  }
  if (alias === 'wan') {
    return 'host internet path, not PXE service';
  }
  if (alias.includes('vethernet') || ip.startsWith('192.168.100.')) {
    return 'VM regression only';
  }
  return 'service candidate';
}

function isActiveInterface(item, config) {
  return item.interfaceAlias === config.adapter.interfaceAlias
    && item.ipAddress === config.adapter.serverIp
    && Number(item.prefixLength) === Number(config.adapter.prefixLength);
}

function isPendingInterface(item) {
  return state.pendingInterface
    && item.interfaceAlias === state.pendingInterface.interfaceAlias
    && item.ipAddress === state.pendingInterface.ipAddress
    && Number(item.prefixLength) === Number(state.pendingInterface.prefixLength);
}

function currentInterfaceChoice() {
  const config = state.current?.config;
  if (!config) {
    return null;
  }
  const active = state.interfaces.find((item) => isActiveInterface(item, config));
  return active ?? {
    interfaceAlias: config.adapter.interfaceAlias,
    ipAddress: config.adapter.serverIp,
    prefixLength: config.adapter.prefixLength,
  };
}

function appendInterfaceStatusRow(message, className = '') {
  const tr = document.createElement('tr');
  if (className) {
    tr.className = className;
  }
  const td = document.createElement('td');
  td.colSpan = 5;
  td.textContent = message;
  tr.append(td);
  elements.interfacesBody.append(tr);
}

function renderInterfaces(appState) {
  elements.interfacesBody.replaceChildren();
  let pendingLabel = 'No pending endpoint target';
  if (state.pendingInterface) {
    pendingLabel = `Selected: ${state.pendingInterface.interfaceAlias} ${state.pendingInterface.ipAddress}/${state.pendingInterface.prefixLength}`;
  } else if (state.interfacesLoading) {
    pendingLabel = 'Refreshing endpoints...';
  }
  elements.pendingInterfaceLabel.textContent = pendingLabel;
  if (state.interfacesLoading) {
    appendInterfaceStatusRow(state.interfaces.length ? 'Refreshing endpoints...' : 'Loading endpoints...', 'status-row');
  } else if (state.interfacesError) {
    appendInterfaceStatusRow(
      state.interfaces.length
        ? `Endpoint refresh failed: ${state.interfacesError}. Showing last loaded interface data.`
        : `Endpoint load failed: ${state.interfacesError}. Use Refresh endpoints to retry.`,
      'status-row failed',
    );
  }
  if (!state.interfaces.length) {
    if (!state.interfacesLoading && !state.interfacesError) {
      appendInterfaceStatusRow('No interface data loaded. Use Refresh endpoints.', 'status-row');
    }
    return;
  }
  state.interfaces.forEach((item, index) => {
    const tr = document.createElement('tr');
    if (isActiveInterface(item, appState.config)) {
      tr.classList.add('selected');
    }
    if (isPendingInterface(item)) {
      tr.classList.add('pending');
    }
    const values = [
      `${item.interfaceAlias}${isActiveInterface(item, appState.config) ? ' (active)' : ''}`,
      `${item.ipAddress}/${item.prefixLength}`,
      roleForInterface(item),
      item.gateway || '-',
    ];
    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    const actionCell = document.createElement('td');
    const select = document.createElement('button');
    select.type = 'button';
    select.textContent = 'Select';
    select.dataset.icon = 'check_circle';
    select.dataset.interfaceAction = 'select';
    select.dataset.interfaceIndex = String(index);
    select.disabled = state.interfacesLoading;
    const sync = document.createElement('button');
    sync.type = 'button';
    sync.textContent = 'Sync';
    sync.className = 'warning';
    sync.dataset.icon = 'sync';
    sync.dataset.interfaceAction = 'sync';
    sync.dataset.interfaceIndex = String(index);
    sync.disabled = state.interfacesLoading;
    actionCell.append(select, ' ', sync);
    tr.append(actionCell);
    elements.interfacesBody.append(tr);
  });
}

function renderProfiles(appState) {
  elements.profilesBody.replaceChildren();
  const profileState = appState.profile;
  if (profileState?.error) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = profileState.error;
    tr.append(td);
    elements.profilesBody.append(tr);
    return;
  }
  const activeId = profileState?.activeProfile?.id;
  for (const profile of profileState?.profiles ?? []) {
    const tr = document.createElement('tr');
    const active = profile.id === activeId;
    if (active) {
      tr.classList.add('selected');
    }
    const status = document.createElement('td');
    status.append(makeStatusPill(active ? 'Active' : 'Inactive', active ? 'ok' : 'neutral'));
    tr.append(status);
    for (const value of [
      profile.id,
      profile.name,
      profile.softwareIds?.length ? profile.softwareIds.join(', ') : 'none',
    ]) {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    }
    const action = document.createElement('td');
    if (active) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.dataset.icon = 'edit';
      edit.dataset.profileAction = 'edit';
      edit.dataset.profileId = profile.id;
      action.append(edit);
    } else {
      const select = document.createElement('button');
      select.type = 'button';
      select.textContent = 'Set active';
      select.className = 'warning';
      select.dataset.icon = 'done';
      select.dataset.profileAction = 'select';
      select.dataset.profileId = profile.id;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Delete';
      del.dataset.icon = 'delete';
      del.dataset.profileAction = 'delete';
      del.dataset.profileId = profile.id;
      action.append(select, ' ', del);
    }
    tr.append(action);
    elements.profilesBody.append(tr);
  }
}

function payloadChecks(appState) {
  return (appState.preflight ?? []).filter((check) => (
    /apps|payload|profile|smb|os image/i.test(check.name ?? '') || /apps|payload|profile|smb|os image/i.test(check.detail ?? '')
  ));
}

function renderPayload(appState) {
  const active = appState.profile?.activeProfile;
  const activeOs = appState.osImage?.activeImage;
  setDefinitionList(elements.payloadSummary, [
    ['Active profile', active ? `${active.id} / ${active.name}` : '-'],
    ['Software', appState.profile?.selectedSoftwareText || 'none'],
    ['Active OS', activeOs ? osImageLabel(activeOs) : appState.osImage?.error ?? '-'],
    ['SMB share', appState.config.smb?.share],
    ['Image path', appState.config.smb?.imagePath],
  ]);
  renderChecks(elements.payloadChecks, payloadChecks(appState), 'No payload-specific preflight result yet.');
}

function endpointStatusText(appState) {
  return (appState.endpointUpdateStatus ?? []).join('\n').toLowerCase();
}

function syncStepState(appState, doneKeywords, workingKeywords) {
  const textValue = endpointStatusText(appState);
  const operation = appState.operation;
  if (operation?.status === 'failed') {
    return 'failed';
  }
  if (doneKeywords.some((keyword) => textValue.includes(keyword))) {
    return 'done';
  }
  if (operation?.running && workingKeywords.some((keyword) => textValue.includes(keyword))) {
    return 'working';
  }
  return 'pending';
}

function renderStepList(element, appState) {
  element.replaceChildren();
  for (const [label, doneKeywords, workingKeywords] of syncSteps) {
    const stateName = syncStepState(appState, doneKeywords, workingKeywords);
    const row = document.createElement('div');
    row.className = `step-row ${stateName}`;
    const title = document.createElement('strong');
    title.textContent = label;
    const status = document.createElement('span');
    status.textContent = stateName;
    row.append(title, status);
    element.append(row);
  }
}

function renderSync(appState) {
  const config = appState.config;
  const targetRows = [
    ['Interface', config.adapter.interfaceAlias],
    ['Service IP', `${config.adapter.serverIp}/${config.adapter.prefixLength}`],
    ['DHCP Pool', dhcpRange(config)],
    ['HTTP Base', `http://${config.http.host}${Number(config.http.port) === 80 ? '' : `:${config.http.port}`}/osdcloud`],
    ['SMB', config.smb?.share],
  ];
  setDefinitionList(elements.syncTarget, targetRows);
  setDefinitionList(elements.syncProgressTarget, targetRows);
  renderStepList(elements.syncChecklist, appState);
  renderStepList(elements.syncProgressSteps, appState);
  elements.syncProgressSubtitle.textContent = `Target: ${endpointLabel(config)}`;

  renderChecks(elements.syncActionItems, [
    { name: 'Services stopped before sync', ok: endpointStatusText(appState).includes('stopped running services') || null },
    { name: 'Assets refreshed', ok: endpointStatusText(appState).includes('endpoint files synced') || null },
    { name: 'Preflight queued or completed', ok: endpointStatusText(appState).includes('preflight') || null },
  ], 'No endpoint sync has run in this browser session.');

  const output = [
    ...(appState.endpointUpdateStatus ?? []),
    ...(appState.operation?.lines ?? []),
  ];
  elements.syncOutput.textContent = output.length ? output.join('\n') : 'No endpoint sync output yet.';
}

function normalizedKey(value) {
  return String(value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function flattenEntries(value, prefix = '') {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return flattenEntries(entry, nextKey);
    }
    if (Array.isArray(entry)) {
      return [[nextKey, entry.join(', ')]];
    }
    return [[nextKey, entry]];
  });
}

function runEvents(appState) {
  const runId = appState.selectedRun?.runId;
  const events = appState.statusEvents ?? [];
  return runId ? events.filter((event) => event.runId === runId) : events;
}

function evidenceValue(appState, keys) {
  const normalized = keys.map(normalizedKey);
  const events = [...runEvents(appState)].reverse();
  for (const event of events) {
    for (const [key, value] of flattenEntries(event)) {
      const keyNorm = normalizedKey(key);
      if (normalized.some((needle) => keyNorm.endsWith(needle) || keyNorm.includes(needle))) {
        return text(value, 'Unknown');
      }
    }
    const message = String(event.message ?? '');
    for (const key of keys) {
      const match = message.match(new RegExp(`${key}\\s*[:=]\\s*([^;\\n]+)`, 'i'));
      if (match) {
        return match[1].trim();
      }
    }
  }
  return 'Unknown';
}

function validationCheck(appState, matcher) {
  return (appState.validation ?? []).find((check) => matcher.test(check.name ?? ''));
}

function renderValidation(appState) {
  const run = appState.selectedRun;
  elements.validationRunId.textContent = run?.runId ?? '-';
  if (!run) {
    setDefinitionList(elements.validationRunSummary, [['Status', 'No client run selected']]);
    setDefinitionList(elements.targetEvidence, [['Evidence', 'No selected run']]);
    setDefinitionList(elements.runTiming, [['Timing', 'No selected run']]);
    setDefinitionList(elements.screenshotEvidence, [['Screenshot', 'No selected run']]);
    setDefinitionList(elements.ipxeEvidence, [['iPXE', 'No selected run']]);
    renderChecks(elements.httpEvidence, [], 'No selected run.');
    renderTimeline(appState);
    renderChecks(elements.validationList, appState.validation);
    return;
  }

  setDefinitionList(elements.validationRunSummary, [
    ['Run ID', run.runId],
    ['Client', run.clientId],
    ['Status', run.status],
    ['Progress', percent(run.latestPercent)],
    ['Final Stage', run.completedStage ?? run.latestStage],
    ['Message', run.staleReason ? `${run.staleReason}; ${run.latestMessage ?? ''}` : run.latestMessage],
  ]);

  setDefinitionList(elements.targetEvidence, [
    ['ExplorerRunning', evidenceValue(appState, ['ExplorerRunning', 'explorerRunning'])],
    ['DesktopReadyFile', evidenceValue(appState, ['DesktopReadyFile', 'desktopReadyFile'])],
    ['OobeProcesses', evidenceValue(appState, ['OobeProcesses', 'oobeProcesses'])],
    ['DisplayVersion', evidenceValue(appState, ['DisplayVersion', 'displayVersion'])],
    ['CurrentBuild', evidenceValue(appState, ['CurrentBuild', 'currentBuild'])],
    ['EditionID', evidenceValue(appState, ['EditionID', 'editionId'])],
    ['Culture', evidenceValue(appState, ['Culture', 'culture'])],
    ['TimeZone', evidenceValue(appState, ['TimeZone', 'timeZone'])],
  ]);

  setDefinitionList(elements.runTiming, [
    ['Started', localDateTime(run.startedAt)],
    ['WinPE End', localDateTime(run.winpeEndedAt)],
    ['Windows Start', localDateTime(run.windowsStartedAt)],
    ['Completed', localDateTime(run.completedAt)],
    ['Failed', localDateTime(run.failedAt)],
    ['Elapsed', elapsed(run.elapsedSeconds)],
  ]);

  const screenshotPattern = `${appState.config.http.statusRoot}\\screenshots\\${run.runId}\\*.png`;
  setDefinitionList(elements.screenshotEvidence, [
    ['Latest file', appState.selectedScreenshot?.filePath],
    ['Expected path', screenshotPattern],
    ['Captured at', localDateTime(appState.selectedScreenshot?.receivedAt ?? appState.selectedScreenshot?.timestamp)],
  ]);

  setDefinitionList(elements.ipxeEvidence, [
    ['ImageFileUrl', evidenceValue(appState, ['ImageFileUrl'])],
    ['ImageFileDestination', evidenceValue(appState, ['ImageFileDestination'])],
    ['ImageFileDestinationDisplayRoot', evidenceValue(appState, ['ImageFileDestinationDisplayRoot', 'DisplayRoot'])],
    ['OSImageIndex', evidenceValue(appState, ['OSImageIndex'])],
    ['Selected OS', evidenceValue(appState, ['selectedOs.id', 'selectedOsId', 'osImageId'])],
    ['OS language', evidenceValue(appState, ['selectedOs.language', 'osLanguage'])],
    ['OS edition', evidenceValue(appState, ['selectedOs.editionId', 'osEditionId'])],
  ]);

  const bootIpxe = validationCheck(appState, /HTTP boot\.ipxe/i);
  const wimboot = validationCheck(appState, /HTTP wimboot/i);
  const bootWim = validationCheck(appState, /HTTP boot\.wim/i);
  const noEsd = validationCheck(appState, /No HTTP ESD transfer/i);
  renderChecks(elements.httpEvidence, [
    { name: 'boot.ipxe requested', ok: bootIpxe?.ok ?? null, detail: bootIpxe?.detail ?? '' },
    { name: 'wimboot requested', ok: wimboot?.ok ?? null, detail: wimboot?.detail ?? '' },
    { name: 'boot.wim requested', ok: bootWim?.ok ?? null, detail: bootWim?.detail ?? '' },
    { name: 'zh-TW ESD HEAD/GET', ok: noEsd?.ok ?? null, detail: noEsd ? (noEsd.ok ? '0 observed' : 'HTTP ESD transfer observed') : 'not observed' },
  ]);

  renderTimeline(appState);
  renderChecks(elements.validationList, appState.validation);
}

function renderTimeline(appState) {
  elements.eventTimeline.replaceChildren();
  const events = runEvents(appState);
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'check-row unknown';
    empty.textContent = 'No status events observed for the selected run.';
    elements.eventTimeline.append(empty);
    return;
  }
  for (const event of events) {
    const row = document.createElement('div');
    row.className = 'timeline-row';
    const when = document.createElement('strong');
    when.textContent = event.receivedAt ?? event.timestamp ?? '-';
    const detail = document.createElement('span');
    detail.textContent = `[${text(event.stage, 'event')}] ${text(event.message, '')}`;
    row.append(when, detail);
    elements.eventTimeline.append(row);
  }
}

function renderLogs(appState) {
  elements.logs.textContent = (appState.logs ?? []).length ? appState.logs.join('\n') : 'No operation logs observed yet.';
}

function render() {
  const appState = state.current;
  if (!appState) {
    return;
  }
  elements.appVersion.textContent = appState.app?.version ? `v${appState.app.version}` : '';
  elements.endpointLine.textContent = endpointLabel(appState.config);
  elements.updatedAt.textContent = `Updated ${localTime(appState.generatedAt)}`;
  renderOperation(appState);
  renderEndpointSummary(appState);
  renderServices(appState);
  renderProfileSummary(appState);
  renderOsImageSummary(appState);
  renderPreflightSummary(appState.preflight);
  renderClients(appState);
  renderInterfaces(appState);
  renderProfiles(appState);
  renderOsImages(appState);
  renderPayload(appState);
  renderSync(appState);
  renderValidation(appState);
  renderLogs(appState);
}

function validateProfileInput(name) {
  if (!name) {
    return 'Display name is required.';
  }
  return '';
}

function renderSoftwareBaseline(element, softwareIds, catalog) {
  element.replaceChildren();
  const names = (softwareIds ?? []).map((id) => catalog.find((item) => item.id === id)?.name ?? id);
  if (!names.length) {
    const item = document.createElement('div');
    item.className = 'readonly-item';
    item.textContent = 'No client software selected.';
    element.append(item);
    return;
  }
  for (const name of names) {
    const item = document.createElement('div');
    item.className = 'readonly-item';
    item.textContent = name;
    element.append(item);
  }
}

function showAddProfileDialog(profile) {
  return new Promise((resolve) => {
    elements.profileForm.reset();
    elements.profileError.textContent = '';
    elements.profileIdPreview.value = 'Generated by server on create';
    renderSoftwareBaseline(
      elements.profileSoftwareBaseline,
      profile.activeProfile?.softwareIds ?? [],
      profile.softwareCatalog ?? [],
    );

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      elements.profileForm.removeEventListener('submit', submit);
      elements.profileCancel.removeEventListener('click', cancel);
      elements.profileCancelSecondary.removeEventListener('click', cancel);
      elements.profileDialog.removeEventListener('cancel', cancel);
      if (elements.profileDialog.open) {
        elements.profileDialog.close();
      }
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault();
      done(null);
    };
    const submit = (event) => {
      event.preventDefault();
      const name = elements.profileName.value.trim();
      const error = validateProfileInput(name);
      if (error) {
        elements.profileError.textContent = error;
        return;
      }
      done({
        name,
        description: elements.profileDescription.value.trim(),
      });
    };

    elements.profileForm.addEventListener('submit', submit);
    elements.profileCancel.addEventListener('click', cancel);
    elements.profileCancelSecondary.addEventListener('click', cancel);
    elements.profileDialog.addEventListener('cancel', cancel);
    elements.profileDialog.showModal();
    elements.profileName.focus();
  });
}

function setSoftwareCheckboxes(checked) {
  elements.softwareList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
  });
}

function showSoftwareDialog(profile) {
  return new Promise((resolve) => {
    const activeProfile = profile.activeProfile;
    const software = profile.softwareCatalog ?? [];
    const selectedIds = new Set(activeProfile?.softwareIds ?? []);
    elements.softwareError.textContent = '';
    elements.softwareProfileSummary.textContent = 'Save stops running services, republishes the live Apps payload, and reruns preflight.';
    elements.softwareProfileId.value = activeProfile?.id ?? '';
    elements.softwareProfileName.value = activeProfile?.name ?? '';
    elements.softwareProfileDescription.value = activeProfile?.description ?? '';
    elements.softwareList.replaceChildren();

    for (const item of software) {
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.checked = selectedIds.has(item.id);
      const span = document.createElement('span');
      span.textContent = item.name ?? item.id;
      label.append(input, span);
      elements.softwareList.append(label);
    }

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      elements.softwareForm.removeEventListener('submit', submit);
      elements.softwareCancel.removeEventListener('click', cancel);
      elements.softwareCancelSecondary.removeEventListener('click', cancel);
      elements.softwareDialog.removeEventListener('cancel', cancel);
      elements.softwareSelectAll.removeEventListener('click', selectAll);
      elements.softwareSelectNone.removeEventListener('click', selectNone);
      if (elements.softwareDialog.open) {
        elements.softwareDialog.close();
      }
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault();
      done(null);
    };
    const submit = (event) => {
      event.preventDefault();
      const name = elements.softwareProfileName.value.trim();
      if (!name) {
        elements.softwareError.textContent = 'Profile name is required.';
        return;
      }
      const checked = new Set([...elements.softwareList.querySelectorAll('input:checked')].map((input) => input.value));
      done({
        name,
        description: elements.softwareProfileDescription.value.trim(),
        softwareIds: software.map((item) => item.id).filter((id) => checked.has(id)),
      });
    };
    const selectAll = () => setSoftwareCheckboxes(true);
    const selectNone = () => setSoftwareCheckboxes(false);

    elements.softwareForm.addEventListener('submit', submit);
    elements.softwareCancel.addEventListener('click', cancel);
    elements.softwareCancelSecondary.addEventListener('click', cancel);
    elements.softwareDialog.addEventListener('cancel', cancel);
    elements.softwareSelectAll.addEventListener('click', selectAll);
    elements.softwareSelectNone.addEventListener('click', selectNone);
    elements.softwareDialog.showModal();
    elements.softwareProfileName.focus();
  });
}

function confirmAction({ title, message, details = [], confirmLabel = 'Continue', danger = false, severity = null }) {
  return new Promise((resolve) => {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmSubmit.textContent = confirmLabel;
    const resolvedSeverity = severity ?? (danger ? 'danger' : 'neutral');
    elements.confirmSubmit.classList.toggle('danger', resolvedSeverity === 'danger');
    elements.confirmSubmit.classList.toggle('warning', resolvedSeverity === 'warning');
    elements.confirmDetails.replaceChildren();
    for (const detail of details) {
      const item = document.createElement('li');
      item.textContent = detail;
      elements.confirmDetails.append(item);
    }
    const close = () => {
      elements.confirmDialog.removeEventListener('close', onClose);
      resolve(elements.confirmDialog.returnValue === 'ok');
    };
    const onClose = () => close();
    elements.confirmDialog.addEventListener('close', onClose);
    elements.confirmDialog.showModal();
  });
}

async function showPicker(title, rows, onPick, buttonLabel = 'Select') {
  elements.pickerTitle.textContent = title;
  elements.pickerList.replaceChildren();
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'picker-item';
    const body = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = row.title;
    const span = document.createElement('span');
    span.textContent = row.detail;
    body.append(strong, span);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonLabel;
    button.className = buttonLabel.toLowerCase() === 'delete' ? 'danger' : '';
    button.dataset.icon = buttonLabel.toLowerCase() === 'delete' ? 'delete' : 'check';
    button.addEventListener('click', () => {
      elements.pickerDialog.close();
      onPick(row.value);
    });
    item.append(body, button);
    elements.pickerList.append(item);
  }
  elements.pickerDialog.showModal();
}

async function confirmEndpointSync(choice) {
  const ok = await confirmAction({
    title: 'Sync endpoint',
    message: 'This will stop services, persist config, update boot files, commit WinPE changes, refresh osdcloud-assets, and rerun preflight.',
    details: [`Target: ${choice.interfaceAlias} ${choice.ipAddress}/${choice.prefixLength}`],
    confirmLabel: 'Sync endpoint',
    severity: 'warning',
  });
  if (!ok) {
    return;
  }
  state.pendingInterface = choice;
  closeDialog(elements.endpointSettingsDialog);
  await mutate('/api/endpoint', choice);
}

async function handleProfileDelete(profile) {
  const ok = await confirmAction({
    title: 'Delete inactive profile',
    message: 'This removes only an inactive deployment profile JSON file. Active profiles cannot be deleted.',
    details: [`Profile: ${profile.name} (${profile.id})`],
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) {
    await mutate('/api/profiles/delete', { profileId: profile.id });
  }
}

async function handleProfileSelect(profile) {
  const ok = await confirmAction({
    title: 'Select deployment profile',
    message: 'This stops services, writes the active profile, replaces the live Apps payload, and reruns preflight.',
    details: [`Profile: ${profile.name} (${profile.id})`, `Software: ${profile.softwareIds?.join(', ') || 'none'}`],
    confirmLabel: 'Set active',
    severity: 'warning',
  });
  if (ok) {
    await mutate('/api/profile', { profileId: profile.id });
  }
}

async function handleOsImageSelect(image) {
  const ok = await confirmAction({
    title: 'Set active OS image',
    message: 'This stops services, publishes selected-os.json, updates the SMB image path, saves config, and reruns preflight.',
    details: [`OS: ${osImageLabel(image)}`, `File: ${image.fileName}`],
    confirmLabel: 'Set active',
    severity: 'warning',
  });
  if (ok) {
    await mutate('/api/os-image', { imageId: image.id });
  }
}

async function handleOsImageDelete(image) {
  const ok = await confirmAction({
    title: 'Delete cached OS image',
    message: 'This removes the OS image from the host cache catalog and deletes the ESD/WIM file when no other cached row uses it. It does not change the active deployment image.',
    details: [`OS: ${osImageLabel(image)}`, `File: ${image.fileName}`],
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) {
    await mutate('/api/os-image-delete', { imageId: image.id });
  }
}

async function handleOsImageDownload(image) {
  const ok = await confirmAction({
    title: 'Download OS image',
    message: 'This downloads on the host into a staging file and will not replace the active deployment image unless validation succeeds.',
    details: [`OS: ${osImageLabel(image)}`, `File: ${image.fileName}`],
    confirmLabel: 'Download',
    severity: 'warning',
  });
  if (ok) {
    if (state.osDownloadStarting || state.current?.osDownloadStatus?.running) {
      return;
    }
    state.osDownloadStarting = true;
    render();
    try {
      const payload = await api('/api/os-download', {
        method: 'POST',
        body: JSON.stringify({ catalogId: image.id }),
      });
      state.current = payload.state;
      state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
      render();
    } catch (error) {
      window.alert(error.message);
    } finally {
      state.osDownloadStarting = false;
      render();
    }
  }
}

async function handleOsImageUploadInspect() {
  const file = elements.osUploadFile.files?.[0] ?? null;
  if (!file) {
    window.alert('Choose a local ISO/ESD/WIM file first.');
    return;
  }
  if (state.busy) {
    return;
  }
  state.busy = true;
  setControlsDisabled(true);
  try {
    const payload = await api(`/api/os-image-upload?fileName=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    state.current = payload.state;
    state.osImportInspection = payload.result;
    fillImportMetadataDefaults(payload.result?.indexes?.[0]?.suggested ?? {});
    render();
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

async function handleOsImageImport(row) {
  const uploadId = state.osImportInspection?.uploadId;
  if (!uploadId) {
    window.alert('Upload and inspect a local ISO/ESD/WIM file first.');
    return;
  }
  const metadata = importMetadataFromInputs(row.suggested ?? {});
  const ok = await confirmAction({
    title: 'Import OS image',
    message: 'This copies the selected uploaded ISO/ESD/WIM image into the host OS cache. It does not change the active deployment image.',
    details: [
      `Source: ${state.osImportInspection.originalFileName ?? uploadId}`,
      `Index: ${row.imageIndex}`,
      `Language: ${metadata.language}`,
      `Release: ${metadata.releaseId || '-'}`,
      `Edition: ${metadata.edition}`,
      `File: ${metadata.fileName}`,
    ],
    confirmLabel: 'Import to cache',
    severity: 'warning',
  });
  if (ok) {
    const payload = await mutate('/api/os-image-upload-import', {
      uploadId,
      imageIndex: row.imageIndex,
      metadata,
    });
    if (payload?.state) {
      state.osImportInspection = null;
      render();
    }
  }
}

async function handleAction(action, source = null) {
  const services = state.current?.services ?? {};
  if (action === 'run-evidence') {
    const runId = source?.dataset?.runId ?? source?.closest?.('[data-run-id]')?.dataset?.runId;
    showValidationEvidence(runId);
  } else if (action === 'preflight') {
    await mutate('/api/preflight');
  } else if (action === 'interfaces') {
    openDialog(elements.endpointSettingsDialog);
    void loadInterfaces();
  } else if (action === 'reload-endpoints') {
    await Promise.all([refresh(), loadInterfaces()]);
  } else if (action === 'endpoint-sync') {
    if (state.interfaces.length === 0) {
      await loadInterfaces();
    }
    const choice = state.pendingInterface ?? currentInterfaceChoice();
    if (!choice) {
      window.alert('Select a service interface before syncing the endpoint.');
      openDialog(elements.endpointSettingsDialog);
      return;
    }
    await confirmEndpointSync(choice);
  } else if (action === 'profiles') {
    openDialog(elements.deploymentProfilesDialog);
  } else if (action === 'os-images') {
    openDialog(elements.osImagesDialog);
  } else if (action === 'reload-os-download-catalog') {
    await loadOsDownloadCatalog();
  } else if (action === 'os-upload-inspect') {
    await handleOsImageUploadInspect();
  } else if (action === 'profile-add') {
    const payload = await api('/api/profiles');
    const input = await showAddProfileDialog(payload.profile);
    if (input) {
      await mutate('/api/profiles/create', input);
    }
  } else if (action === 'profile-edit') {
    const payload = await api('/api/profiles');
    const profileUpdate = await showSoftwareDialog(payload.profile);
    if (profileUpdate) {
      const ok = await confirmAction({
        title: 'Save active profile',
        message: 'This stops services, updates the active profile, replaces the live Apps payload, and runs preflight.',
        details: [`Profile: ${profileUpdate.name}`, `Software: ${profileUpdate.softwareIds.join(', ') || 'none'}`],
        confirmLabel: 'Save changes',
        severity: 'warning',
      });
      if (ok) {
        await mutate('/api/profile/software', profileUpdate);
      }
    }
  } else if (action === 'profile-delete') {
    const payload = await api('/api/profiles');
    const activeProfileId = payload.profile.activeProfile?.id;
    const candidates = payload.profile.profiles.filter((profile) => profile.id !== activeProfileId);
    if (!candidates.length) {
      window.alert('No inactive deployment profiles can be deleted.');
      return;
    }
    await showPicker('Delete deployment profile', candidates.map((profile) => ({
      title: `${profile.name} (${profile.id})`,
      detail: profile.softwareIds.length ? profile.softwareIds.join(', ') : 'no client software',
      value: profile,
    })), (profile) => {
      handleProfileDelete(profile).catch((error) => window.alert(error.message));
    }, 'Delete');
  } else if (action === 'http-toggle') {
    await mutate(`/api/services/http/${services.http?.running ? 'stop' : 'start'}`);
  } else if (action === 'tftp-toggle') {
    await mutate(`/api/services/tftp/${services.tftp?.running ? 'stop' : 'start'}`);
  } else if (action === 'dhcp-toggle') {
    const verb = services.dhcp?.running ? 'stop' : 'start';
    if (verb === 'stop') {
      await mutate('/api/services/dhcp/stop');
      return;
    }
    const ok = await confirmAction({
      title: 'Start DHCP',
      message: 'Confirm the real LAN DHCP server is disabled before starting the host DHCP responder.',
      confirmLabel: 'Start DHCP',
      danger: true,
    });
    if (ok) {
      await mutate('/api/services/dhcp/start');
    }
  } else if (action === 'all-services-toggle') {
    const allServicesRunning = ['http', 'tftp', 'dhcp'].every((name) => services[name]?.running);
    if (allServicesRunning) {
      await mutate('/api/services/stop-all');
      return;
    }
    const ok = await confirmAction({
      title: 'Start all services',
      message: 'Confirm the real LAN DHCP server is disabled before starting HTTP/status, TFTP, and DHCP.',
      confirmLabel: 'Start all services',
      danger: true,
    });
    if (ok) {
      await mutate('/api/services/start-all');
    }
  } else if (action === 'clear-status') {
    const ok = await confirmAction({
      title: 'Clear status files',
      message: 'This deletes live status JSON, JSONL, screenshot metadata, and screenshot folders under the configured status root.',
      details: [state.current?.config?.http?.statusRoot ?? 'configured status root'],
      confirmLabel: 'Clear status',
      danger: true,
    });
    if (ok) {
      await mutate('/api/status/clear');
    }
  } else if (action === 'refresh-evidence') {
    await refresh();
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) {
    return;
  }
  if (openValidationEvidenceFromTarget(target)) {
    event.preventDefault();
    return;
  }

  const interfaceButton = target.closest('[data-interface-action]');
  if (interfaceButton) {
    const item = state.interfaces[Number(interfaceButton.dataset.interfaceIndex)];
    if (!item) {
      return;
    }
    state.pendingInterface = item;
    render();
    if (interfaceButton.dataset.interfaceAction === 'sync') {
      confirmEndpointSync(item).catch((error) => window.alert(error.message));
    }
    return;
  }

  const profileButton = target.closest('[data-profile-action]');
  if (profileButton) {
    const profile = state.current?.profile?.profiles?.find((item) => item.id === profileButton.dataset.profileId);
    if (!profile) {
      return;
    }
    if (profileButton.dataset.profileAction === 'select') {
      handleProfileSelect(profile).catch((error) => window.alert(error.message));
    } else if (profileButton.dataset.profileAction === 'delete') {
      handleProfileDelete(profile).catch((error) => window.alert(error.message));
    } else if (profileButton.dataset.profileAction === 'edit') {
      handleAction('profile-edit').catch((error) => window.alert(error.message));
    }
    return;
  }

  const osImageButton = target.closest('[data-os-image-action]');
  if (osImageButton) {
    const image = state.current?.osImage?.images?.find((item) => item.id === osImageButton.dataset.osImageId);
    if (image && osImageButton.dataset.osImageAction === 'select') {
      handleOsImageSelect(image).catch((error) => window.alert(error.message));
    } else if (image && osImageButton.dataset.osImageAction === 'delete') {
      handleOsImageDelete(image).catch((error) => window.alert(error.message));
    }
    return;
  }

  const osDownloadButton = target.closest('[data-os-download-action]');
  if (osDownloadButton) {
    const image = state.osDownloadCatalog.find((item) => item.id === osDownloadButton.dataset.osDownloadId);
    if (image && osDownloadButton.dataset.osDownloadAction === 'download') {
      handleOsImageDownload(image).catch((error) => window.alert(error.message));
    }
    return;
  }

  const osImportButton = target.closest('[data-os-import-action]');
  if (osImportButton) {
    const row = state.osImportInspection?.indexes?.find((item) => String(item.imageIndex) === osImportButton.dataset.osImportIndex);
    if (row && osImportButton.dataset.osImportAction === 'import') {
      handleOsImageImport(row).catch((error) => window.alert(error.message));
    }
    return;
  }

  const actionButton = target.closest('[data-action]');
  if (actionButton) {
    handleAction(actionButton.dataset.action, actionButton).catch((error) => window.alert(error.message));
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) {
    return;
  }
  if (openValidationEvidenceFromTarget(target)) {
    event.preventDefault();
    return;
  }
  const serviceCard = target.closest('.service-card-action[data-action]');
  if (!serviceCard) {
    return;
  }
  event.preventDefault();
  handleAction(serviceCard.dataset.action).catch((error) => window.alert(error.message));
});

document.addEventListener('click', suppressBackdropCloseClickThrough, true);

elements.refreshButton.addEventListener('click', () => {
  refresh().catch((error) => window.alert(error.message));
});

[
  elements.osFilterRelease,
  elements.osFilterLanguage,
].forEach((select) => {
  select.addEventListener('change', () => render());
});

$$('[data-os-catalog-filter]').forEach((input) => {
  input.addEventListener('change', () => {
    state.osDownloadCatalog = [];
    state.osDownloadCatalogLoaded = false;
    state.osDownloadCatalogError = null;
    state.osDownloadCatalogFilters = null;
    clearRefineFilters();
    render();
  });
});

enableBackdropCloseForDialogs();

refresh().catch((error) => window.alert(error.message));
setInterval(() => {
  refresh().catch(() => {});
}, 2500);
