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
  logsText: null,
  fleetExpanded: false,
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
  clientFleetPanel: $('.client-fleet-panel'),
  fleetBackdrop: $('#fleet-backdrop'),
  clientsBody: $('#clients-body'),
  fleetCounts: $('#fleet-counts'),
  fleetExpandToggle: $('#fleet-expand-toggle'),
  logs: $('#logs'),
  interfacesBody: $('#interfaces-body'),
  pendingInterfaceLabel: $('#pending-interface-label'),
  profilesBody: $('#profiles-body'),
  softwareCatalogBody: $('#software-catalog-body'),
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
  profileOsImage: $('#profile-os-image'),
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
  softwareProfileOsImage: $('#software-profile-os-image'),
  softwareSelectAll: $('#software-select-all'),
  softwareSelectNone: $('#software-select-none'),
  softwareList: $('#software-list'),
  softwareError: $('#software-error'),
  softwareAddDialog: $('#software-add-dialog'),
  softwareAddForm: $('#software-add-form'),
  softwareAddCancel: $('#software-add-cancel'),
  softwareAddCancelSecondary: $('#software-add-cancel-secondary'),
  softwareAddName: $('#software-add-name'),
  softwareAddFile: $('#software-add-file'),
  softwareAddScriptMode: $('#software-add-script-mode'),
  softwareAddInstallerType: $('#software-add-installer-type'),
  softwareAddSuccessCodes: $('#software-add-success-codes'),
  softwareAddTemplateFields: $('#software-add-template-fields'),
  softwareAddSilentArgs: $('#software-add-silent-args'),
  softwareAddVerifyPath: $('#software-add-verify-path'),
  softwareAddRawFields: $('#software-add-raw-fields'),
  softwareAddRawScript: $('#software-add-raw-script'),
  softwareAddError: $('#software-add-error'),
  softwareDetailDialog: $('#software-detail-dialog'),
  softwareDetailTitle: $('#software-detail-title'),
  softwareDetailSummary: $('#software-detail-summary'),
  softwareDetailList: $('#software-detail-list'),
  softwareScriptDialog: $('#software-script-dialog'),
  softwareScriptTitle: $('#software-script-title'),
  softwareScriptPath: $('#software-script-path'),
  softwareScriptContent: $('#software-script-content'),
  softwareScriptStatus: $('#software-script-status'),
  softwareScriptError: $('#software-script-error'),
  softwareScriptOpen: $('#software-script-open'),
  scriptCatalogBody: $('#script-catalog-body'),
  profileScriptsList: $('#profile-scripts-list'),
  scriptAddDialog: $('#script-add-dialog'),
  scriptAddForm: $('#script-add-form'),
  scriptAddCancel: $('#script-add-cancel'),
  scriptAddCancelSecondary: $('#script-add-cancel-secondary'),
  scriptAddName: $('#script-add-name'),
  scriptAddFile: $('#script-add-file'),
  scriptAddDefaultPhase: $('#script-add-default-phase'),
  scriptAddError: $('#script-add-error'),
  scriptContentDialog: $('#script-content-dialog'),
  scriptContentTitle: $('#script-content-title'),
  scriptContentPath: $('#script-content-path'),
  scriptContentBody: $('#script-content-body'),
  scriptContentError: $('#script-content-error'),
  confirmDialog: $('#confirm-dialog'),
  confirmTitle: $('#confirm-title'),
  confirmMessage: $('#confirm-message'),
  confirmDetails: $('#confirm-details'),
  confirmSubmit: $('#confirm-submit'),
};

const syncSteps = [
  ['Stop running services', ['stopped running services'], ['selected']],
  ['Persist config/osdcloud-console.json', ['saved'], ['updating config']],
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
  $$('button[data-action], dialog button, dialog input, dialog select, dialog textarea').forEach((control) => {
    control.disabled = disabled;
  });
}

function renderFleetExpandedState() {
  document.body.classList.toggle('fleet-expanded', state.fleetExpanded);
  if (elements.fleetBackdrop) {
    elements.fleetBackdrop.hidden = !state.fleetExpanded;
  }
  if (!elements.fleetExpandToggle) {
    return;
  }
  elements.fleetExpandToggle.setAttribute('aria-expanded', String(state.fleetExpanded));
  elements.fleetExpandToggle.dataset.icon = state.fleetExpanded ? 'close_fullscreen' : 'open_in_full';
  elements.fleetExpandToggle.textContent = state.fleetExpanded ? 'Collapse fleet' : 'Expand fleet';
  elements.fleetExpandToggle.title = state.fleetExpanded ? 'Return to dashboard overview' : 'Expand Client Fleet';
}

function setFleetExpanded(expanded) {
  if (state.fleetExpanded === expanded) {
    return;
  }
  state.fleetExpanded = expanded;
  renderFleetExpandedState();
}

function isDialogOpen(dialog) {
  return Boolean(dialog.open || dialog.hasAttribute('open'));
}

function openDialog(dialog) {
  if (isDialogOpen(dialog)) {
    return;
  }
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
    dialog.classList.add('dialog-fallback-open');
    document.body.classList.add('dialog-fallback-open');
  }
}

function closeDialog(dialog, returnValue = '') {
  if (!isDialogOpen(dialog)) {
    return;
  }
  if (typeof dialog.close === 'function') {
    dialog.close(returnValue);
  } else {
    dialog.returnValue = returnValue;
    dialog.removeAttribute('open');
    dialog.classList.remove('dialog-fallback-open');
    if (!document.querySelector('dialog.dialog-fallback-open')) {
      document.body.classList.remove('dialog-fallback-open');
    }
    dialog.dispatchEvent(new Event('close'));
  }
}

function cancelDialog(dialog) {
  if (!isDialogOpen(dialog)) {
    return;
  }
  const cancelEvent = new Event('cancel', { cancelable: true });
  const shouldClose = dialog.dispatchEvent(cancelEvent);
  if (shouldClose && isDialogOpen(dialog)) {
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

function setDefinitionListNodes(element, rows) {
  element.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (value instanceof Node) {
      dd.append(value);
    } else {
      dd.textContent = text(value);
    }
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
    for (const image of osState?.images ?? []) {
      const tr = document.createElement('tr');
      const usedBy = Array.isArray(image.usedByProfiles) ? image.usedByProfiles : [];
      const inUse = usedBy.length > 0;
      const statusCell = document.createElement('td');
      statusCell.append(makeStatusPill(inUse ? 'In use' : 'Available', inUse ? 'ok' : 'neutral'));
      tr.append(statusCell);
      appendTextCell(tr, `${image.id} / ${image.name}`);
      appendTextCell(tr, image.language);
      appendTextCell(tr, image.edition);
      appendTextCell(tr, image.imageIndex);
      const cacheText = image.cached ? `${bytes(image.bytes)} cached` : 'missing';
      const usageText = inUse
        ? ` · used by ${usedBy.map((profile) => profile.name ?? profile.id).join(', ')}`
        : '';
      appendTextCell(tr, `${cacheText}${usageText}`);
      const actionCell = document.createElement('td');
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger';
      deleteButton.textContent = 'Delete';
      deleteButton.dataset.icon = 'delete';
      deleteButton.dataset.osImageAction = 'delete';
      deleteButton.dataset.osImageId = image.id;
      deleteButton.disabled = inUse;
      if (inUse) {
        deleteButton.title = `Cannot delete: in use by ${usedBy.map((p) => p.name ?? p.id).join(', ')}`;
      }
      actionCell.append(deleteButton);
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
  const explicitAction = origin.closest('[data-action]');
  if (explicitAction && explicitAction.dataset.action !== 'run-evidence') {
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
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = 'Delete';
    deleteButton.dataset.action = 'status-run-delete';
    deleteButton.dataset.icon = 'delete';
    deleteButton.dataset.runId = run.runId;
    statusCell.append(deleteButton);
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

function preflightResolutionHint(check) {
  const name = String(check?.name ?? '');
  const detail = String(check?.detail ?? '');
  const nameLower = name.toLowerCase();
  const fullText = `${name}\n${detail}`.toLowerCase();

  if (nameLower === 'os image' && fullText.includes('selected manifest stale')) {
    return 'Open Deployment profiles, re-select the active profile (or edit its OS image) to refresh selected-os.json, then run preflight again.';
  }
  if (nameLower === 'os image') {
    return 'Confirm the OS image referenced by the active profile is cached. Upload or re-import the file if missing, or edit the profile to point at a different cached OS image, then run preflight again.';
  }
  if (nameLower === 'smb image') {
    return 'Confirm the OSDCloudiPXE share exists, the backing image file is present, and pxeinstall has read access; reselect the active deployment profile if the path is stale.';
  }
  if (nameLower.startsWith('service ip')) {
    return 'Open Select interface, choose an enabled adapter that owns the service IP, apply the endpoint sync, then run preflight again.';
  }
  if (nameLower === 'dhcp subnet') {
    return 'Use Select interface or Sync endpoint so the DHCP lease range and router are recalculated inside the selected service subnet.';
  }
  if (nameLower.startsWith('http file') || nameLower === 'http root' || nameLower === 'tftp root') {
    return 'Run Sync endpoint to republish the boot files, or restore the missing C:\\OSDCloud runtime artifact before starting services.';
  }
  if (/^(udp 67|udp 69|tcp 80)$/u.test(nameLower)) {
    return 'Stop the process currently using this port, or stop the old Web/headless console before starting this service again.';
  }
  if (nameLower === 'deployment profile') {
    return 'Open Profiles, set or save the intended active profile to republish the Apps payload, then run preflight again.';
  }
  if (nameLower === 'administrator') {
    return 'Restart the Web console from an elevated PowerShell session, then run preflight again.';
  }
  return 'Review the detail and System Log, fix the reported mismatch, then run preflight again.';
}

function preflightTooltip(check, detailText, statusLabel) {
  const base = `${statusLabel} ${text(check?.name)}${detailText ? `\n${detailText}` : ''}`;
  if (check?.ok !== false) {
    return base;
  }
  return `${base}\n\nHow to fix:\n${preflightResolutionHint(check)}`;
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
    const tooltip = preflightTooltip(check, detailText, dot.title);
    detail.title = tooltip;
    row.title = tooltip;
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
    td.colSpan = 6;
    td.textContent = profileState.error;
    tr.append(td);
    elements.profilesBody.append(tr);
    return;
  }
  const activeId = profileState?.activeProfile?.id;
  const osImageById = new Map((appState.osImage?.images ?? []).map((image) => [image.id, image]));
  for (const profile of profileState?.profiles ?? []) {
    const tr = document.createElement('tr');
    const active = profile.id === activeId;
    if (active) {
      tr.classList.add('selected');
    }
    const status = document.createElement('td');
    status.append(makeStatusPill(active ? 'Active' : 'Inactive', active ? 'ok' : 'neutral'));
    tr.append(status);
    const osImage = profile.osImageId ? osImageById.get(profile.osImageId) : null;
    const osLabel = profile.osImageId
      ? (osImage ? `${profile.osImageId} — ${osImageLabel(osImage)}` : `${profile.osImageId} (missing)`)
      : '-';
    for (const value of [
      profile.id,
      profile.name,
      osLabel,
      profile.softwareIds?.length ? profile.softwareIds.join(', ') : 'none',
    ]) {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    }
    const action = document.createElement('td');
    const actionGroup = document.createElement('div');
    actionGroup.className = 'profile-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.dataset.icon = 'edit';
    edit.dataset.profileAction = 'edit';
    edit.dataset.profileId = profile.id;
    if (active) {
      actionGroup.append(edit);
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
      actionGroup.append(edit, select, del);
    }
    action.append(actionGroup);
    tr.append(action);
    elements.profilesBody.append(tr);
  }
}

function renderSoftwareCatalog(appState) {
  elements.softwareCatalogBody.replaceChildren();
  const profileState = appState.profile;
  if (profileState?.error) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = profileState.error;
    tr.append(td);
    elements.softwareCatalogBody.append(tr);
    return;
  }
  const software = profileState?.softwareCatalog ?? [];
  if (!software.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No software catalog entries.';
    tr.append(td);
    elements.softwareCatalogBody.append(tr);
    return;
  }
  for (const item of software) {
    const tr = document.createElement('tr');
    const selectedProfiles = item.usedByProfiles?.length
      ? item.usedByProfiles.map((profile) => profile.name || profile.id)
      : (profileState.profiles ?? [])
        .filter((profile) => profile.softwareIds?.includes(item.id))
        .map((profile) => profile.name || profile.id);
    for (const value of [
      item.id,
      item.name,
      item.source ?? item.id,
      selectedProfiles.length ? selectedProfiles.join(', ') : 'not selected',
    ]) {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    }
    const actions = document.createElement('td');
    const actionWrap = document.createElement('div');
    actionWrap.className = 'software-catalog-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = 'View';
    view.dataset.icon = 'visibility';
    view.dataset.softwareAction = 'view';
    view.dataset.softwareId = item.id;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.className = 'danger';
    del.dataset.icon = 'delete';
    del.dataset.softwareAction = 'delete';
    del.dataset.softwareId = item.id;
    if (selectedProfiles.length) {
      del.disabled = true;
      del.title = `Remove from profiles first: ${selectedProfiles.join(', ')}`;
    }
    actionWrap.append(view, del);
    actions.append(actionWrap);
    tr.append(actions);
    elements.softwareCatalogBody.append(tr);
  }
}

function renderScriptCatalog(appState) {
  elements.scriptCatalogBody.replaceChildren();
  const profileState = appState.profile;
  if (profileState?.error) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = profileState.error;
    tr.append(td);
    elements.scriptCatalogBody.append(tr);
    return;
  }
  const scripts = profileState?.customScriptCatalog ?? [];
  if (!scripts.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'No custom scripts.';
    tr.append(td);
    elements.scriptCatalogBody.append(tr);
    return;
  }
  for (const item of scripts) {
    const tr = document.createElement('tr');
    const selectedProfiles = item.usedByProfiles?.length
      ? item.usedByProfiles.map((profile) => profile.name || profile.id)
      : [];
    for (const value of [
      item.id,
      item.name,
      item.fileName,
      item.defaultPhase === 'before' ? 'Before Apps' : 'After Apps',
      selectedProfiles.length ? selectedProfiles.join(', ') : 'not selected',
    ]) {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    }
    const actions = document.createElement('td');
    const actionWrap = document.createElement('div');
    actionWrap.className = 'software-catalog-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = 'View';
    view.dataset.icon = 'visibility';
    view.dataset.scriptAction = 'view';
    view.dataset.scriptId = item.id;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.className = 'danger';
    del.dataset.icon = 'delete';
    del.dataset.scriptAction = 'delete';
    del.dataset.scriptId = item.id;
    if (selectedProfiles.length) {
      del.disabled = true;
      del.title = `Remove from profiles first: ${selectedProfiles.join(', ')}`;
    }
    actionWrap.append(view, del);
    actions.append(actionWrap);
    tr.append(actions);
    elements.scriptCatalogBody.append(tr);
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
      return [[nextKey, entry]];
    }
    return [[nextKey, entry]];
  });
}

function runEvents(appState) {
  const runId = appState.selectedRun?.runId;
  const selectedEvents = appState.selectedRunEvents ?? [];
  if (selectedEvents.length) {
    return selectedEvents;
  }
  const events = appState.statusEvents ?? [];
  return runId ? events.filter((event) => event.runId === runId) : events;
}

function evidenceKeyMatches(keyNorm, needle) {
  return keyNorm === needle || keyNorm.endsWith(needle);
}

function findEvidenceEntry(entries, needle, matchMode) {
  return entries.find(([key]) => {
    const keyNorm = normalizedKey(key);
    return matchMode === 'exact' ? keyNorm === needle : evidenceKeyMatches(keyNorm, needle);
  });
}

function evidenceText(value, options = {}) {
  const emptyValue = options.emptyValue ?? '<empty>';
  if (Array.isArray(value)) {
    return value.length ? value.map((entry) => text(entry, emptyValue)).join(', ') : emptyValue;
  }
  if (value === null || value === '') {
    return emptyValue;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return text(value, options.missingValue ?? 'Not reported');
}

function evidenceValue(appState, keys, options = {}) {
  const normalized = keys.map(normalizedKey);
  const events = [...runEvents(appState)].reverse();
  for (const event of events) {
    const entries = flattenEntries(event);
    for (const needle of normalized) {
      const exact = findEvidenceEntry(entries, needle, 'exact');
      if (exact) {
        return evidenceText(exact[1], options);
      }
      const fallback = findEvidenceEntry(entries, needle, 'fallback');
      if (fallback) {
        return evidenceText(fallback[1], options);
      }
    }
    const message = String(event.message ?? '');
    for (const key of keys) {
      const match = message.match(new RegExp(`${key}\\s*[:=]\\s*([^;\\n]*)`, 'i'));
      if (match) {
        return evidenceText(match[1].trim(), options);
      }
    }
  }
  return options.missingValue ?? 'Not reported';
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
    ['ImageFileUrl', evidenceValue(appState, ['imageFileUrl'])],
    ['ImageFileDestination', evidenceValue(appState, ['imageFileDestination', 'imagePath'])],
    ['ImageFileDestinationDisplayRoot', evidenceValue(appState, ['imageFileDestinationDisplayRoot', 'displayRoot'])],
    ['OSImageIndex', evidenceValue(appState, ['osImageIndex', 'selectedOs.imageIndex', 'imageIndex'])],
    ['Selected OS', evidenceValue(appState, ['selectedOs.id', 'selectedOsId', 'osImageId'])],
    ['OS language', evidenceValue(appState, ['selectedOs.language', 'osLanguage', 'selectedOs.locale'])],
    ['OS edition', evidenceValue(appState, ['selectedOs.editionId', 'osEditionId', 'selectedOs.edition'])],
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

function isScrolledToBottom(element, tolerance = 2) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= tolerance;
}

function renderLogs(appState) {
  const nextText = (appState.logs ?? []).length ? appState.logs.join('\n') : 'No operation logs observed yet.';
  const logElement = elements.logs;
  if (state.logsText === nextText) {
    return;
  }
  const previousScrollTop = logElement.scrollTop;
  const wasAtBottom = isScrolledToBottom(logElement);
  logElement.textContent = nextText;
  state.logsText = nextText;
  logElement.scrollTop = wasAtBottom ? logElement.scrollHeight : previousScrollTop;
}

function render() {
  const appState = state.current;
  if (!appState) {
    return;
  }
  renderFleetExpandedState();
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
  renderSoftwareCatalog(appState);
  renderScriptCatalog(appState);
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

function availableOsImages() {
  return state.current?.osImage?.images ?? [];
}

function populateOsImageSelect(selectElement, selectedId) {
  selectElement.replaceChildren();
  const images = availableOsImages();
  if (!images.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No OS images available — upload one first';
    option.disabled = true;
    option.selected = true;
    selectElement.append(option);
    return;
  }
  for (const image of images) {
    const option = document.createElement('option');
    option.value = image.id;
    const cached = image.cached ? '' : ' (not cached)';
    option.textContent = `${image.id} — ${osImageLabel(image)}${cached}`;
    if (!image.cached) {
      option.disabled = true;
    }
    if (image.id === selectedId) {
      option.selected = true;
    }
    selectElement.append(option);
  }
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
    populateOsImageSelect(elements.profileOsImage, profile.activeProfile?.osImageId ?? '');
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
      if (isDialogOpen(elements.profileDialog)) {
        closeDialog(elements.profileDialog);
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
      const osImageId = elements.profileOsImage.value;
      if (!osImageId) {
        elements.profileError.textContent = 'Select an OS image for this profile.';
        return;
      }
      done({
        name,
        description: elements.profileDescription.value.trim(),
        osImageId,
      });
    };

    elements.profileForm.addEventListener('submit', submit);
    elements.profileCancel.addEventListener('click', cancel);
    elements.profileCancelSecondary.addEventListener('click', cancel);
    elements.profileDialog.addEventListener('cancel', cancel);
    openDialog(elements.profileDialog);
    elements.profileName.focus();
  });
}

function showSoftwareDialog(profile, profileToEdit = null) {
  return new Promise((resolve) => {
    const targetProfile = profileToEdit ?? profile.activeProfile;
    const isActiveTarget = targetProfile?.id === profile.activeProfile?.id;
    const software = profile.softwareCatalog ?? [];
    const softwareById = new Map(software.map((item) => [item.id, item]));
    const scripts = profile.customScriptCatalog ?? [];
    const scriptsById = new Map(scripts.map((item) => [item.id, item]));
    let selectedOrder = (targetProfile?.softwareIds ?? []).filter((id, index, ids) => (
      softwareById.has(id) && ids.indexOf(id) === index
    ));
    const selectedScripts = new Map();
    for (const entry of targetProfile?.customScripts ?? []) {
      if (scriptsById.has(entry.id)) {
        const phase = entry.phase === 'before' ? 'before' : 'after';
        selectedScripts.set(entry.id, phase);
      }
    }
    let draggedSoftwareId = null;

    const renderScriptsEditor = () => {
      elements.profileScriptsList.replaceChildren();
      if (!scripts.length) {
        const empty = document.createElement('div');
        empty.className = 'readonly-item software-order-empty';
        empty.textContent = 'No custom scripts in catalog. Add one from Custom Scripts.';
        elements.profileScriptsList.append(empty);
        return;
      }
      for (const item of scripts) {
        const row = document.createElement('div');
        row.className = 'profile-script-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedScripts.has(item.id);
        checkbox.dataset.scriptCheckbox = item.id;
        const labelWrap = document.createElement('label');
        labelWrap.className = 'profile-script-label';
        const nameSpan = document.createElement('strong');
        nameSpan.textContent = item.name || item.id;
        const idSpan = document.createElement('span');
        idSpan.className = 'software-order-id';
        idSpan.textContent = item.id;
        labelWrap.append(checkbox, nameSpan, idSpan);
        const phaseSelect = document.createElement('select');
        phaseSelect.dataset.scriptPhase = item.id;
        for (const [value, label] of [['before', 'Before Apps'], ['after', 'After Apps']]) {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = label;
          phaseSelect.append(opt);
        }
        phaseSelect.value = selectedScripts.get(item.id) ?? item.defaultPhase ?? 'after';
        phaseSelect.disabled = !selectedScripts.has(item.id);
        row.append(labelWrap, phaseSelect);
        elements.profileScriptsList.append(row);
      }
    };

    const handleScriptsListChange = (event) => {
      const checkbox = event.target.closest('[data-script-checkbox]');
      if (checkbox) {
        const id = checkbox.dataset.scriptCheckbox;
        if (checkbox.checked) {
          const phase = scriptsById.get(id)?.defaultPhase ?? 'after';
          selectedScripts.set(id, phase);
        } else {
          selectedScripts.delete(id);
        }
        const phaseSelect = elements.profileScriptsList.querySelector(`[data-script-phase="${CSS.escape(id)}"]`);
        if (phaseSelect) {
          phaseSelect.disabled = !checkbox.checked;
          if (checkbox.checked) {
            phaseSelect.value = selectedScripts.get(id);
          }
        }
        return;
      }
      const phase = event.target.closest('[data-script-phase]');
      if (phase) {
        const id = phase.dataset.scriptPhase;
        if (selectedScripts.has(id)) {
          selectedScripts.set(id, phase.value === 'before' ? 'before' : 'after');
        }
      }
    };
    elements.softwareError.textContent = '';
    elements.softwareProfileSummary.textContent = isActiveTarget
      ? 'Save stops running services, republishes the live Apps payload in this install order, and reruns preflight.'
      : 'Save only updates this profile’s JSON. Services and the live Apps payload are not touched. Use Set active to publish.';
    elements.softwareProfileId.value = targetProfile?.id ?? '';
    elements.softwareProfileName.value = targetProfile?.name ?? '';
    elements.softwareProfileDescription.value = targetProfile?.description ?? '';
    populateOsImageSelect(elements.softwareProfileOsImage, targetProfile?.osImageId ?? '');

    const moveSelected = (id, toIndex) => {
      const fromIndex = selectedOrder.indexOf(id);
      if (fromIndex < 0) {
        return false;
      }
      const [moved] = selectedOrder.splice(fromIndex, 1);
      const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      const boundedIndex = Math.max(0, Math.min(adjustedIndex, selectedOrder.length));
      selectedOrder.splice(boundedIndex, 0, moved);
      return true;
    };

    const renderSoftwareIdentity = (container, item) => {
      const name = document.createElement('strong');
      name.textContent = item?.name ?? item?.id ?? '';
      const id = document.createElement('span');
      id.className = 'software-order-id';
      id.textContent = item?.id ?? '';
      container.append(name, id);
    };

    const appendEmptyRow = (parent, message) => {
      const row = document.createElement('div');
      row.className = 'readonly-item software-order-empty';
      row.textContent = message;
      parent.append(row);
    };

    const iconButton = (icon, label, action, softwareId, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'software-icon-button';
      button.dataset.icon = icon;
      button.dataset.softwareOrderAction = action;
      button.dataset.softwareId = softwareId;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.disabled = disabled;
      return button;
    };

    const renderEditor = () => {
      elements.softwareList.replaceChildren();
      const selectedSet = new Set(selectedOrder);

      const selectedSection = document.createElement('section');
      selectedSection.className = 'software-order-section';
      const selectedTitle = document.createElement('div');
      selectedTitle.className = 'field-label';
      selectedTitle.textContent = 'Selected install order';
      const selectedList = document.createElement('div');
      selectedList.className = 'software-order-list selected';

      if (!selectedOrder.length) {
        appendEmptyRow(selectedList, 'No client software selected.');
      } else {
        selectedOrder.forEach((id, index) => {
          const item = softwareById.get(id);
          const row = document.createElement('div');
          row.className = 'software-order-row';
          row.dataset.selected = 'true';
          row.dataset.softwareId = id;
          row.draggable = true;

          const handle = document.createElement('span');
          handle.className = 'software-drag-handle';
          handle.textContent = 'drag_indicator';
          handle.title = 'Drag to reorder';

          const rank = document.createElement('span');
          rank.className = 'software-order-rank';
          rank.textContent = String(index + 1);

          const label = document.createElement('span');
          label.className = 'software-order-name';
          renderSoftwareIdentity(label, item);

          const actions = document.createElement('span');
          actions.className = 'software-order-actions';
          actions.append(
            iconButton('keyboard_arrow_up', 'Move up', 'up', id, index === 0),
            iconButton('keyboard_arrow_down', 'Move down', 'down', id, index === selectedOrder.length - 1),
            iconButton('remove', 'Remove', 'remove', id),
          );

          row.append(handle, rank, label, actions);
          selectedList.append(row);
        });
      }
      selectedSection.append(selectedTitle, selectedList);

      const availableSection = document.createElement('section');
      availableSection.className = 'software-order-section';
      const availableTitle = document.createElement('div');
      availableTitle.className = 'field-label';
      availableTitle.textContent = 'Available software';
      const availableList = document.createElement('div');
      availableList.className = 'software-order-list available';
      const available = software.filter((item) => !selectedSet.has(item.id));
      if (!available.length) {
        appendEmptyRow(availableList, 'All catalog software is selected.');
      } else {
        available.forEach((item) => {
          const row = document.createElement('div');
          row.className = 'software-order-row';
          row.dataset.softwareId = item.id;

          const label = document.createElement('span');
          label.className = 'software-order-name';
          renderSoftwareIdentity(label, item);

          const add = document.createElement('button');
          add.type = 'button';
          add.textContent = 'Add';
          add.dataset.icon = 'add';
          add.dataset.softwareOrderAction = 'add';
          add.dataset.softwareId = item.id;
          row.append(label, add);
          availableList.append(row);
        });
      }
      availableSection.append(availableTitle, availableList);
      elements.softwareList.append(selectedSection, availableSection);
    };

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
      elements.softwareList.removeEventListener('click', handleOrderClick);
      elements.softwareList.removeEventListener('dragstart', handleDragStart);
      elements.softwareList.removeEventListener('dragover', handleDragOver);
      elements.softwareList.removeEventListener('dragleave', handleDragLeave);
      elements.softwareList.removeEventListener('drop', handleDrop);
      elements.softwareList.removeEventListener('dragend', handleDragEnd);
      elements.profileScriptsList.removeEventListener('change', handleScriptsListChange);
      if (isDialogOpen(elements.softwareDialog)) {
        closeDialog(elements.softwareDialog);
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
      const osImageId = elements.softwareProfileOsImage.value;
      if (!osImageId) {
        elements.softwareError.textContent = 'Select an OS image for this profile.';
        return;
      }
      const customScripts = [];
      for (const item of scripts) {
        if (selectedScripts.has(item.id)) {
          customScripts.push({ id: item.id, phase: selectedScripts.get(item.id) });
        }
      }
      done({
        profileId: targetProfile?.id ?? '',
        isActive: isActiveTarget,
        name,
        description: elements.softwareProfileDescription.value.trim(),
        softwareIds: [...selectedOrder],
        customScripts,
        osImageId,
      });
    };
    const selectAll = () => {
      const selectedSet = new Set(selectedOrder);
      selectedOrder = [
        ...selectedOrder,
        ...software.map((item) => item.id).filter((id) => !selectedSet.has(id)),
      ];
      renderEditor();
    };
    const selectNone = () => {
      selectedOrder = [];
      renderEditor();
    };
    const handleOrderClick = (event) => {
      const button = event.target.closest('[data-software-order-action]');
      if (!button || !elements.softwareList.contains(button)) {
        return;
      }
      const id = button.dataset.softwareId;
      if (!id) {
        return;
      }
      const action = button.dataset.softwareOrderAction;
      const index = selectedOrder.indexOf(id);
      if (action === 'add' && !selectedOrder.includes(id) && softwareById.has(id)) {
        selectedOrder = [...selectedOrder, id];
      } else if (action === 'remove') {
        selectedOrder = selectedOrder.filter((selectedId) => selectedId !== id);
      } else if (action === 'up' && index > 0) {
        moveSelected(id, index - 1);
      } else if (action === 'down' && index >= 0 && index < selectedOrder.length - 1) {
        moveSelected(id, index + 2);
      }
      renderEditor();
    };
    const clearDropTargets = () => {
      elements.softwareList.querySelectorAll('.software-order-row.drag-over').forEach((row) => {
        row.classList.remove('drag-over');
      });
    };
    const handleDragStart = (event) => {
      const row = event.target.closest('.software-order-row[data-selected="true"]');
      if (!row || !elements.softwareList.contains(row)) {
        return;
      }
      draggedSoftwareId = row.dataset.softwareId;
      row.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedSoftwareId);
      }
    };
    const handleDragOver = (event) => {
      const row = event.target.closest('.software-order-row[data-selected="true"]');
      if (!draggedSoftwareId || !row || row.dataset.softwareId === draggedSoftwareId) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      clearDropTargets();
      row.classList.add('drag-over');
    };
    const handleDragLeave = (event) => {
      const row = event.target.closest('.software-order-row.drag-over');
      if (row && !row.contains(event.relatedTarget)) {
        row.classList.remove('drag-over');
      }
    };
    const handleDrop = (event) => {
      const row = event.target.closest('.software-order-row[data-selected="true"]');
      if (!draggedSoftwareId || !row) {
        return;
      }
      event.preventDefault();
      const targetId = row.dataset.softwareId;
      const targetIndex = selectedOrder.indexOf(targetId);
      if (targetIndex >= 0 && targetId !== draggedSoftwareId) {
        const rect = row.getBoundingClientRect();
        const afterTarget = event.clientY > rect.top + rect.height / 2;
        moveSelected(draggedSoftwareId, targetIndex + (afterTarget ? 1 : 0));
      }
      draggedSoftwareId = null;
      clearDropTargets();
      renderEditor();
    };
    const handleDragEnd = () => {
      draggedSoftwareId = null;
      clearDropTargets();
      elements.softwareList.querySelectorAll('.software-order-row.dragging').forEach((row) => {
        row.classList.remove('dragging');
      });
    };

    elements.softwareForm.addEventListener('submit', submit);
    elements.softwareCancel.addEventListener('click', cancel);
    elements.softwareCancelSecondary.addEventListener('click', cancel);
    elements.softwareDialog.addEventListener('cancel', cancel);
    elements.softwareSelectAll.addEventListener('click', selectAll);
    elements.softwareSelectNone.addEventListener('click', selectNone);
    elements.softwareList.addEventListener('click', handleOrderClick);
    elements.softwareList.addEventListener('dragstart', handleDragStart);
    elements.softwareList.addEventListener('dragover', handleDragOver);
    elements.softwareList.addEventListener('dragleave', handleDragLeave);
    elements.softwareList.addEventListener('drop', handleDrop);
    elements.softwareList.addEventListener('dragend', handleDragEnd);
    elements.profileScriptsList.addEventListener('change', handleScriptsListChange);
    renderEditor();
    renderScriptsEditor();
    openDialog(elements.softwareDialog);
    elements.softwareProfileName.focus();
  });
}

function installerTypeForFile(file) {
  const name = String(file?.name ?? '').toLowerCase();
  if (name.endsWith('.msi')) {
    return 'msi';
  }
  if (name.endsWith('.exe')) {
    return 'exe';
  }
  return '';
}

function defaultSoftwareArgs(installerType) {
  return installerType === 'msi'
    ? '/qn /norestart REBOOT=ReallySuppress'
    : '/quiet /norestart';
}

function defaultSoftwareSuccessCodes(installerType) {
  return installerType === 'msi' ? '0,1641,3010' : '0';
}

function setAddSoftwareTemplateDefaults(installerType) {
  elements.softwareAddSilentArgs.value = defaultSoftwareArgs(installerType);
  elements.softwareAddSuccessCodes.value = defaultSoftwareSuccessCodes(installerType);
}

function updateAddSoftwareMode() {
  const mode = elements.softwareAddScriptMode.value;
  const installerType = elements.softwareAddInstallerType.value;
  elements.softwareAddTemplateFields.hidden = mode === 'raw';
  elements.softwareAddRawFields.hidden = mode !== 'raw';
  if (!elements.softwareAddSilentArgs.value.trim()) {
    elements.softwareAddSilentArgs.value = defaultSoftwareArgs(installerType);
  }
  if (!elements.softwareAddSuccessCodes.value.trim()) {
    elements.softwareAddSuccessCodes.value = defaultSoftwareSuccessCodes(installerType);
  }
}

function updateAddSoftwareInstallerDefaults() {
  const file = elements.softwareAddFile.files?.[0];
  const inferred = installerTypeForFile(file);
  if (inferred) {
    elements.softwareAddInstallerType.value = inferred;
    setAddSoftwareTemplateDefaults(inferred);
  }
  updateAddSoftwareMode();
}

function updateAddSoftwareSelectedInstallerDefaults() {
  setAddSoftwareTemplateDefaults(elements.softwareAddInstallerType.value);
  updateAddSoftwareMode();
}

function validateAddSoftwareInput(input) {
  if (!input.name) {
    return 'Display name is required.';
  }
  if (!input.file) {
    return 'Installer file is required.';
  }
  const inferred = installerTypeForFile(input.file);
  if (!inferred) {
    return 'Installer file must be .msi or .exe.';
  }
  if (inferred !== input.installerType) {
    return `Installer type ${input.installerType.toUpperCase()} does not match ${input.file.name}.`;
  }
  if (input.scriptMode === 'raw' && !input.rawScript.trim()) {
    return 'Raw mode requires install.ps1 content.';
  }
  return '';
}

async function showSoftwareScriptViewer(software) {
  elements.softwareScriptTitle.textContent = `${software.name || software.id} install.ps1`;
  elements.softwareScriptPath.textContent = 'Loading script...';
  elements.softwareScriptContent.textContent = '';
  elements.softwareScriptStatus.textContent = '';
  elements.softwareScriptError.textContent = '';
  elements.softwareScriptOpen.dataset.softwareId = software.id;
  elements.softwareScriptOpen.textContent = 'Open with...';
  elements.softwareScriptOpen.disabled = true;
  openDialog(elements.softwareScriptDialog);
  try {
    const payload = await api(`/api/software/script?softwareId=${encodeURIComponent(software.id)}`);
    elements.softwareScriptPath.textContent = payload.result.filePath;
    elements.softwareScriptContent.textContent = payload.result.content;
    elements.softwareScriptOpen.disabled = false;
  } catch (error) {
    elements.softwareScriptPath.textContent = software.installScript || '';
    elements.softwareScriptError.textContent = error.message;
  }
}

function showSoftwareDetails(software) {
  const usedByProfiles = software.usedByProfiles?.map((profile) => profile.name || profile.id) ?? [];
  const scriptModeValue = software.scriptMode === 'custom install.ps1'
    ? (() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'software-script-link';
      button.textContent = 'custom install.ps1';
      button.dataset.softwareAction = 'script-view';
      button.dataset.softwareId = software.id;
      return button;
    })()
    : software.scriptMode;
  elements.softwareDetailTitle.textContent = software.name || software.id;
  elements.softwareDetailSummary.textContent = `${software.id} / ${software.source ?? software.id}`;
  setDefinitionListNodes(elements.softwareDetailList, [
    ['Software ID', software.id],
    ['Name', software.name],
    ['Source folder', software.source],
    ['Installer file', software.installerFileName],
    ['Installer type', software.installerType ? String(software.installerType).toUpperCase() : '-'],
    ['Installer size', bytes(software.installerBytes)],
    ['Installer SHA256', software.installerSha256],
    ['Script mode', scriptModeValue],
    ['Silent arguments', software.silentArgs],
    ['Success exit codes', Array.isArray(software.successExitCodes) ? software.successExitCodes.join(',') : software.successExitCodes],
    ['Verification', software.verificationMode],
    ['Installed file to verify', software.verifyPath],
    ['Applied profiles', usedByProfiles.length ? usedByProfiles.join(', ') : 'not selected'],
    ['Source path', software.sourcePath],
    ['install.ps1', software.installScript],
  ]);
  openDialog(elements.softwareDetailDialog);
}

function showAddSoftwareDialog() {
  return new Promise((resolve) => {
    elements.softwareAddForm.reset();
    elements.softwareAddError.textContent = '';
    elements.softwareAddInstallerType.value = 'msi';
    setAddSoftwareTemplateDefaults('msi');
    updateAddSoftwareMode();

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      elements.softwareAddForm.removeEventListener('submit', submit);
      elements.softwareAddCancel.removeEventListener('click', cancel);
      elements.softwareAddCancelSecondary.removeEventListener('click', cancel);
      elements.softwareAddDialog.removeEventListener('cancel', cancel);
      elements.softwareAddFile.removeEventListener('change', updateAddSoftwareInstallerDefaults);
      elements.softwareAddScriptMode.removeEventListener('change', updateAddSoftwareMode);
      elements.softwareAddInstallerType.removeEventListener('change', updateAddSoftwareSelectedInstallerDefaults);
      if (isDialogOpen(elements.softwareAddDialog)) {
        closeDialog(elements.softwareAddDialog);
      }
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault();
      done(null);
    };
    const submit = (event) => {
      event.preventDefault();
      const input = {
        name: elements.softwareAddName.value.trim(),
        file: elements.softwareAddFile.files?.[0] ?? null,
        scriptMode: elements.softwareAddScriptMode.value,
        installerType: elements.softwareAddInstallerType.value,
        silentArgs: elements.softwareAddSilentArgs.value.trim(),
        successExitCodes: elements.softwareAddSuccessCodes.value.trim(),
        verifyPath: elements.softwareAddVerifyPath.value.trim(),
        rawScript: elements.softwareAddRawScript.value,
      };
      const error = validateAddSoftwareInput(input);
      if (error) {
        elements.softwareAddError.textContent = error;
        return;
      }
      done(input);
    };

    elements.softwareAddForm.addEventListener('submit', submit);
    elements.softwareAddCancel.addEventListener('click', cancel);
    elements.softwareAddCancelSecondary.addEventListener('click', cancel);
    elements.softwareAddDialog.addEventListener('cancel', cancel);
    elements.softwareAddFile.addEventListener('change', updateAddSoftwareInstallerDefaults);
    elements.softwareAddScriptMode.addEventListener('change', updateAddSoftwareMode);
    elements.softwareAddInstallerType.addEventListener('change', updateAddSoftwareSelectedInstallerDefaults);
    openDialog(elements.softwareAddDialog);
    elements.softwareAddName.focus();
  });
}

function showAddScriptDialog() {
  return new Promise((resolve) => {
    elements.scriptAddForm.reset();
    elements.scriptAddError.textContent = '';
    elements.scriptAddDefaultPhase.value = 'after';

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      elements.scriptAddForm.removeEventListener('submit', submit);
      elements.scriptAddCancel.removeEventListener('click', cancel);
      elements.scriptAddCancelSecondary.removeEventListener('click', cancel);
      elements.scriptAddDialog.removeEventListener('cancel', cancel);
      if (isDialogOpen(elements.scriptAddDialog)) {
        closeDialog(elements.scriptAddDialog);
      }
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault();
      done(null);
    };
    const submit = (event) => {
      event.preventDefault();
      const input = {
        name: elements.scriptAddName.value.trim(),
        file: elements.scriptAddFile.files?.[0] ?? null,
        defaultPhase: elements.scriptAddDefaultPhase.value === 'before' ? 'before' : 'after',
      };
      if (!input.name) {
        elements.scriptAddError.textContent = 'Display name is required.';
        return;
      }
      if (!input.file) {
        elements.scriptAddError.textContent = 'Script file is required.';
        return;
      }
      if (!input.file.name.toLowerCase().endsWith('.ps1')) {
        elements.scriptAddError.textContent = 'Script file must be .ps1.';
        return;
      }
      done(input);
    };

    elements.scriptAddForm.addEventListener('submit', submit);
    elements.scriptAddCancel.addEventListener('click', cancel);
    elements.scriptAddCancelSecondary.addEventListener('click', cancel);
    elements.scriptAddDialog.addEventListener('cancel', cancel);
    openDialog(elements.scriptAddDialog);
    elements.scriptAddName.focus();
  });
}

async function handleScriptAdd(input) {
  const ok = await confirmAction({
    title: 'Add custom script',
    message: 'This writes a new Scripts folder and catalog entry only. It does not change deployment profiles.',
    details: [
      `Script: ${input.name}`,
      `File: ${input.file.name}`,
      `Default phase: ${input.defaultPhase === 'before' ? 'Before Apps' : 'After Apps'}`,
    ],
    confirmLabel: 'Add to catalog',
    severity: 'warning',
  });
  if (!ok || state.busy) {
    return;
  }

  state.busy = true;
  setControlsDisabled(true);
  try {
    const uploadPayload = await api(`/api/script-upload?fileName=${encodeURIComponent(input.file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: input.file,
    });
    const createPayload = await api('/api/scripts/create', {
      method: 'POST',
      body: JSON.stringify({
        uploadId: uploadPayload.result.uploadId,
        name: input.name,
        defaultPhase: input.defaultPhase,
      }),
    });
    state.current = createPayload.state;
    state.selectedRunId = createPayload.state?.selectedRunId ?? state.selectedRunId;
    render();
    window.alert(`Added ${createPayload.result.script.name} (${createPayload.result.script.id}) to the custom scripts catalog. Select it in a deployment profile before publishing.`);
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

async function handleScriptDelete(script) {
  const usedByProfiles = script.usedByProfiles?.map((profile) => profile.name || profile.id) ?? [];
  if (usedByProfiles.length) {
    window.alert(`Remove ${script.name || script.id} from profiles first: ${usedByProfiles.join(', ')}`);
    return;
  }
  const ok = await confirmAction({
    title: 'Delete custom script',
    message: 'This removes the catalog entry and repo Scripts folder. It does not republish live profiles.',
    details: [
      `Script: ${script.name || script.id}`,
      `ID: ${script.id}`,
      `File: ${script.fileName}`,
    ],
    confirmLabel: 'Delete script',
    severity: 'danger',
  });
  if (ok) {
    await mutate('/api/scripts/delete', { scriptId: script.id });
  }
}

async function showScriptContentViewer(script) {
  elements.scriptContentTitle.textContent = `${script.name || script.id} run.ps1`;
  elements.scriptContentPath.textContent = 'Loading script...';
  elements.scriptContentBody.textContent = '';
  elements.scriptContentError.textContent = '';
  openDialog(elements.scriptContentDialog);
  try {
    const payload = await api(`/api/scripts/content?scriptId=${encodeURIComponent(script.id)}`);
    elements.scriptContentPath.textContent = payload.result.filePath;
    elements.scriptContentBody.textContent = payload.result.content;
  } catch (error) {
    elements.scriptContentPath.textContent = script.scriptFile || '';
    elements.scriptContentError.textContent = error.message;
  }
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
    openDialog(elements.confirmDialog);
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
      closeDialog(elements.pickerDialog);
      onPick(row.value);
    });
    item.append(body, button);
    elements.pickerList.append(item);
  }
  openDialog(elements.pickerDialog);
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

async function handleOsImageDelete(image) {
  const ok = await confirmAction({
    title: 'Delete cached OS image',
    message: 'This removes the OS image from the host cache catalog and deletes the ESD/WIM file when no other cached row uses it. Deletion is refused while any deployment profile references this image.',
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
    message: 'This downloads on the host into a staging file. After validation the image is added to the cache and can be selected by any deployment profile.',
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
    message: 'This copies the selected uploaded ISO/ESD/WIM image into the host OS cache. After import it can be selected by any deployment profile.',
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

async function handleSoftwareAdd(input) {
  const ok = await confirmAction({
    title: 'Add software package',
    message: 'This writes a new Softwares folder and catalog entry only. It does not publish Apps or change the active profile.',
    details: [
      `Software: ${input.name}`,
      'Software ID: generated automatically',
      `Installer: ${input.file.name}`,
      `Script mode: ${input.scriptMode}`,
      `Post-install verification: ${
        input.scriptMode === 'template'
          ? (input.verifyPath || 'installer exit code only')
          : 'raw install.ps1'
      }`,
    ],
    confirmLabel: 'Add to catalog',
    severity: 'warning',
  });
  if (!ok || state.busy) {
    return;
  }

  state.busy = true;
  setControlsDisabled(true);
  try {
    const uploadPayload = await api(`/api/software-upload?fileName=${encodeURIComponent(input.file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: input.file,
    });
    const createPayload = await api('/api/software/create', {
      method: 'POST',
      body: JSON.stringify({
        uploadId: uploadPayload.result.uploadId,
        name: input.name,
        scriptMode: input.scriptMode,
        installerType: input.installerType,
        silentArgs: input.silentArgs,
        successExitCodes: input.successExitCodes,
        verifyPath: input.verifyPath,
        rawScript: input.rawScript,
      }),
    });
    state.current = createPayload.state;
    state.selectedRunId = createPayload.state?.selectedRunId ?? state.selectedRunId;
    render();
    window.alert(`Added ${createPayload.result.software.name} (${createPayload.result.software.id}) to the software catalog. Select it in a deployment profile before publishing.`);
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

async function handleSoftwareDelete(software) {
  const usedByProfiles = software.usedByProfiles?.map((profile) => profile.name || profile.id) ?? [];
  if (usedByProfiles.length) {
    window.alert(`Remove ${software.name || software.id} from profiles first: ${usedByProfiles.join(', ')}`);
    return;
  }
  const ok = await confirmAction({
    title: 'Delete software package',
    message: 'This removes the catalog entry and repo Softwares folder. It does not republish live Apps or change deployment profiles.',
    details: [
      `Software: ${software.name || software.id}`,
      `ID: ${software.id}`,
      `Source: ${software.source ?? software.id}`,
    ],
    confirmLabel: 'Delete software',
    severity: 'danger',
  });
  if (ok) {
    await mutate('/api/software/delete', { softwareId: software.id });
  }
}

async function handleStatusRunDelete(runId) {
  const run = state.current?.fleet?.runs?.find((item) => item.runId === runId);
  if (!run) {
    window.alert('Deployment run was not found in the current Client Fleet list.');
    return;
  }
  const ok = await confirmAction({
    title: 'Delete client run',
    message: 'This removes only this Client Fleet row and its per-run status artifacts. Other runs for the same client are kept. If the client is still reporting, this run may appear again.',
    details: [
      `Run: ${run.runId}`,
      `Client: ${run.clientId ?? '-'}`,
      `Status: ${run.status ?? '-'}`,
      `Stage: ${run.latestStage ?? '-'}`,
    ],
    confirmLabel: 'Delete run',
    danger: true,
  });
  if (!ok) {
    return;
  }
  const deletedSelectedRun = state.selectedRunId === run.runId;
  const payload = await mutate('/api/status/run/delete', { runId: run.runId });
  if (payload?.state) {
    state.clientFleetSignature = '';
    if (deletedSelectedRun) {
      state.selectedRunId = payload.state.selectedRunId ?? null;
      closeDialog(elements.validationEvidenceDialog);
    }
    render();
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
    const requestedId = source?.dataset?.profileId ?? payload.profile.activeProfile?.id;
    const profileToEdit = payload.profile.profiles?.find((item) => item.id === requestedId)
      ?? payload.profile.activeProfile
      ?? null;
    if (!profileToEdit) {
      window.alert('Deployment profile not found.');
      return;
    }
    const profileUpdate = await showSoftwareDialog(payload.profile, profileToEdit);
    if (profileUpdate) {
      const scriptDetail = profileUpdate.customScripts?.length
        ? profileUpdate.customScripts.map((entry) => `${entry.id} (${entry.phase})`).join(', ')
        : 'none';
      const ok = await confirmAction(profileUpdate.isActive
        ? {
            title: 'Save active profile',
            message: 'This stops services, updates the active profile, replaces the live Apps payload, and runs preflight.',
            details: [
              `Profile: ${profileUpdate.name}`,
              `Software: ${profileUpdate.softwareIds.join(', ') || 'none'}`,
              `Custom scripts: ${scriptDetail}`,
            ],
            confirmLabel: 'Save changes',
            severity: 'warning',
          }
        : {
            title: 'Save deployment profile',
            message: 'This updates the profile JSON only. Services and the live Apps payload are not touched.',
            details: [
              `Profile: ${profileUpdate.name} (${profileUpdate.profileId})`,
              `Software: ${profileUpdate.softwareIds.join(', ') || 'none'}`,
              `Custom scripts: ${scriptDetail}`,
            ],
            confirmLabel: 'Save changes',
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
  } else if (action === 'software-add') {
    const input = await showAddSoftwareDialog();
    if (input) {
      await handleSoftwareAdd(input);
    }
  } else if (action === 'script-add') {
    const input = await showAddScriptDialog();
    if (input) {
      await handleScriptAdd(input);
    }
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
  } else if (action === 'status-run-delete') {
    await handleStatusRunDelete(source?.dataset?.runId);
  } else if (action === 'fleet-expand-toggle') {
    setFleetExpanded(!state.fleetExpanded);
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) {
    return;
  }
  if (target === elements.fleetBackdrop) {
    setFleetExpanded(false);
    elements.fleetExpandToggle?.focus();
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
      handleAction('profile-edit', profileButton).catch((error) => window.alert(error.message));
    }
    return;
  }

  const softwareButton = target.closest('[data-software-action]');
  if (softwareButton) {
    const software = state.current?.profile?.softwareCatalog?.find((item) => item.id === softwareButton.dataset.softwareId);
    if (!software) {
      return;
    }
    if (softwareButton.dataset.softwareAction === 'view') {
      showSoftwareDetails(software);
    } else if (softwareButton.dataset.softwareAction === 'delete') {
      handleSoftwareDelete(software).catch((error) => window.alert(error.message));
    } else if (softwareButton.dataset.softwareAction === 'script-view') {
      showSoftwareScriptViewer(software).catch((error) => window.alert(error.message));
    }
    return;
  }

  const scriptButton = target.closest('[data-script-action]');
  if (scriptButton) {
    const script = state.current?.profile?.customScriptCatalog?.find((item) => item.id === scriptButton.dataset.scriptId);
    if (!script) {
      return;
    }
    if (scriptButton.dataset.scriptAction === 'view') {
      showScriptContentViewer(script).catch((error) => window.alert(error.message));
    } else if (scriptButton.dataset.scriptAction === 'delete') {
      handleScriptDelete(script).catch((error) => window.alert(error.message));
    }
    return;
  }

  const osImageButton = target.closest('[data-os-image-action]');
  if (osImageButton) {
    const image = state.current?.osImage?.images?.find((item) => item.id === osImageButton.dataset.osImageId);
    if (image && osImageButton.dataset.osImageAction === 'delete') {
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

$$('button[data-action]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleAction(button.dataset.action, button).catch((error) => window.alert(error.message));
  });
});

document.addEventListener('submit', (event) => {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  const dialog = form?.closest('dialog');
  if (!form || !dialog || form.getAttribute('method') !== 'dialog') {
    return;
  }
  event.preventDefault();
  closeDialog(dialog, event.submitter?.value ?? '');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.fleetExpanded && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    setFleetExpanded(false);
    elements.fleetExpandToggle?.focus();
    return;
  }
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

elements.softwareScriptOpen.addEventListener('click', async () => {
  const softwareId = elements.softwareScriptOpen.dataset.softwareId;
  if (!softwareId || elements.softwareScriptOpen.disabled) {
    return;
  }
  elements.softwareScriptStatus.textContent = '';
  elements.softwareScriptError.textContent = '';
  elements.softwareScriptOpen.textContent = 'Opening...';
  elements.softwareScriptOpen.disabled = true;
  try {
    const payload = await api('/api/software/script/open', {
      method: 'POST',
      body: JSON.stringify({ softwareId }),
    });
    elements.softwareScriptStatus.textContent = `Open request sent: ${payload.result.method}`;
  } catch (error) {
    elements.softwareScriptError.textContent = error.message;
  } finally {
    elements.softwareScriptOpen.textContent = 'Open with...';
    elements.softwareScriptOpen.disabled = false;
  }
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
