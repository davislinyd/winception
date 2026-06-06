const RESERVED_WINDOWS_USERNAMES = new Set([
  'administrator', 'guest', 'defaultaccount', 'wdagutilityaccount', 'system',
]);
const DEFAULT_WINDOWS_USERNAME = 'LabAdmin';

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
  refreshError: null,
  osImportInspection: null,
  busy: false,
  clientFleetSignature: '',
  logsText: null,
  fleetExpanded: false,
  initializationAutoOpened: false,
  initializationPendingAction: null,
  initializationOperationAction: null,
  initializationOperationLogText: '',
  initializationDetailScrollPositions: {},
  endpointSyncReturnToInitialization: false,
  initializationRootDraft: '',
  initializationSecretsEditing: false,
  initializationSecretsDraft: {
    windowsUsername: DEFAULT_WINDOWS_USERNAME,
    windowsPassword: '',
  },
  currentView: null,
  selectedGuidedStepId: null,
  fleetFilter: 'all',
  fleetSearch: '',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let suppressBackdropClickUntil = 0;
let interfacesLoadPromise = null;

const elements = {
  warningBanner: $('#warning-banner'),
  warningBannerText: $('#warning-banner-text'),
  endpointLine: $('#endpoint-line'),
  appVersion: $('#app-version'),
  operationBadge: $('#operation-badge'),
  refreshButton: $('#refresh-button'),
  updatedAt: $('#updated-at'),
  endpointSummary: $('#endpoint-summary'),
  runtimeReadinessBadge: $('#runtime-readiness-badge'),
  runtimeReadinessSummary: $('#runtime-readiness-summary'),
  servicesGrid: $('#services-grid'),
  activeProfileDetails: $('#active-profile-details'),
  activeOsDetails: $('#active-os-details'),
  preflightStatusBadge: $('#preflight-status-badge'),
  preflightList: $('#preflight-list'),
  driverCacheCount: $('#driver-cache-count'),
  driverCacheDetails: $('#driver-cache-details'),
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
  initializationDialog: $('#initialization-dialog'),
  initializationSummary: $('#initialization-summary'),
  initializationBadge: $('#initialization-badge'),
  initializationOperation: $('#initialization-operation'),
  initializationSteps: $('#initialization-steps'),
  initializationNext: $('#initialization-next'),
  initProgressFill: $('#init-progress-fill'),
  initProgressText: $('#init-progress-text'),
  tabGuided: $('#tab-guided'),
  tabDashboard: $('#tab-dashboard'),
  tabFleet: $('#tab-fleet'),
  navServices: $('#nav-services'),
  navLogs: $('#nav-logs'),
  contextTitle: $('#context-title'),
  ssRuntime: $('#ss-runtime'),
  ssPreflight: $('#ss-preflight'),
  ssServices: $('#ss-services'),
  ssActive: $('#ss-active'),
  ssDone: $('#ss-done'),
  summaryEndpoint: $('#summary-endpoint'),
  summaryServices: $('#summary-services'),
  summaryAction: $('#summary-action'),
  summaryStatus: $('#summary-status'),
  guidedStepDetail: $('#guided-step-detail'),
  pipelineSteps: $('#pipeline-steps'),
  topologyClients: $('#topology-clients'),
  topologyHostIp: $('#topology-host-ip'),
  topologyPorts: $('#topology-ports'),
  topologyThroughput: $('#topology-throughput'),
  liveMetrics: $('#live-metrics'),
  fleetStatStrip: $('#fleet-stat-strip'),
  fleetCards: $('#fleet-cards'),
  fleetFilter: $('#fleet-filter'),
  fleetSearch: $('#fleet-search'),
  fleetDetail: $('#fleet-detail'),
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
  osCatalogLanguageCustom: $('#os-catalog-language-custom'),
  osCatalogReleaseCustom: $('#os-catalog-release-custom'),
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
  installerErrorEvidence: $('#installer-error-evidence'),
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

function osDownloadBytes(status) {
  const total = status?.totalBytes ? ` / ${bytes(status.totalBytes)}` : '';
  return `${bytes(status?.bytes)}${total}`;
}

function osDownloadStatusText(status) {
  if (!status) {
    return '';
  }
  if (status.status === 'failed') {
    return `Failed: ${text(status.error, 'unknown error')}`;
  }
  if (status.status === 'downloaded' || status.status === 'cache-hit') {
    return `Cached ${text(status.fileName ?? status.catalogId)}.`;
  }
  if (status.phase === 'downloading-source') {
    return `Downloading source image ${osDownloadBytes(status)}`;
  }
  if (status.phase === 'download-complete') {
    return 'Download complete; preparing image...';
  }
  if (status.message) {
    return status.message;
  }
  if (status.status === 'starting') {
    return 'Starting OS image download...';
  }
  return `${text(status.status)} ${text(status.fileName ?? status.catalogId)} ${osDownloadBytes(status)}`;
}

function osDownloadButtonText(status) {
  if (!status || status.status === 'starting' || status.phase === 'starting') {
    return 'Starting...';
  }
  if (status.phase === 'downloading-source') {
    return `Downloading ${osDownloadBytes(status)}`;
  }
  if (status.phase === 'exporting-wim') {
    return 'Exporting WIM...';
  }
  if (status.running) {
    return 'Processing...';
  }
  return status.status === 'failed' ? 'Failed' : 'Download';
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

async function mutate(path, body = null, options = {}) {
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

function setControlsDisabled(disabled) {
  $$('button[data-action], dialog button, dialog input, dialog select, dialog textarea').forEach((control) => {
    if (control instanceof HTMLButtonElement && control.value === 'cancel') {
      return;
    }
    if (control instanceof HTMLButtonElement && control.dataset.operationAction === 'copy-log') {
      return;
    }
    if (disabled) {
      if (!control.disabled) {
        control.dataset.busyDisabled = 'true';
      }
      control.disabled = true;
    } else if (control.dataset.busyDisabled === 'true') {
      control.disabled = false;
      delete control.dataset.busyDisabled;
    }
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

function switchToView(viewName) {
  if (state.currentView === viewName) {
    return;
  }
  state.currentView = viewName;
  if (viewName === 'guided' && !state.selectedGuidedStepId && state.current?.initialization?.nextStepId) {
    state.selectedGuidedStepId = state.current.initialization.nextStepId;
  }
  render();
}

function isDialogOpen(dialog) {
  return Boolean(dialog.open || dialog.hasAttribute('open'));
}

function openDialog(dialog) {
  if (dialog === elements.initializationDialog) {
    switchToView('guided');
    return;
  }
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
  if (dialog === elements.initializationDialog) {
    return;
  }
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
    ['folder_managed', 'Working Dir', config.workspace?.runtimeRoot],
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

function renderRuntimeReadiness(appState) {
  const runtime = appState.runtime;
  const requiresElevation = appState?.host?.elevated === false;
  elements.runtimeReadinessSummary.replaceChildren();
  if (!runtime || runtime.error) {
    elements.runtimeReadinessBadge.textContent = 'Blocked';
    elements.runtimeReadinessBadge.className = 'status-pill fail';
    const row = document.createElement('div');
    row.className = 'check-row fail';
    row.textContent = runtime?.error ?? 'Runtime readiness is unavailable.';
    elements.runtimeReadinessSummary.append(row);
    setActionLabel('prepare-runtime', 'Prepare runtime');
    setActionIcon('prepare-runtime', 'deployed_code_update');
    return;
  }

  elements.runtimeReadinessBadge.textContent = runtime.ready ? 'Ready' : 'Blocked';
  elements.runtimeReadinessBadge.className = `status-pill ${runtime.ready ? 'ok' : 'fail'}`;
  const summary = document.createElement('div');
  summary.className = `check-row ${runtime.ready ? 'ok' : 'fail'}`;
  summary.textContent = runtime.ready
    ? `${runtime.readyCount}/${runtime.requiredCount} required runtime artifact(s) are present.`
    : requiresElevation
      ? 'Restart the Web console from an elevated PowerShell session before preparing runtime artifacts.'
      : `${runtime.missingCount} runtime artifact group(s) need preparation.`;
  elements.runtimeReadinessSummary.append(summary);

  for (const artifact of (runtime.missing ?? []).slice(0, 4)) {
    const row = document.createElement('div');
    row.className = 'check-row fail runtime-missing-row';
    const firstTarget = artifact.targets?.[0];
    row.textContent = `${artifact.id}: ${firstTarget?.reason ?? 'missing'} ${firstTarget?.filePath ?? ''}`.trim();
    row.title = row.textContent;
    elements.runtimeReadinessSummary.append(row);
  }

  setActionLabel('prepare-runtime', runtime.ready ? 'Runtime ready' : 'Prepare runtime');
  setActionIcon('prepare-runtime', runtime.ready ? 'check_circle' : 'deployed_code_update');
  actionButtons('prepare-runtime').forEach((button) => {
    button.disabled = state.busy || runtime.ready || requiresElevation;
  });
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

  // Read-only status for the BitTorrent tracker. It is started/stopped together
  // with the core services (Start/Stop all services) and accelerates the OS image
  // transfer via P2P, so it is surfaced for visibility rather than as a toggle.
  const torrent = appState.services.torrent;
  if (torrent) {
    const torrentEnabled = torrent.enabled !== false;
    const row = document.createElement('div');
    row.className = 'service-card service-row';
    row.dataset.serviceState = torrent.running ? 'running' : 'stopped';
    const head = document.createElement('div');
    head.className = 'service-row-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'service-title';
    titleWrap.append(makeIcon('hub', 'service-icon'));
    const title = document.createElement('strong');
    title.textContent = 'Torrent Tracker';
    titleWrap.append(title);
    const pill = torrentEnabled
      ? makeStatusPill(torrent.running ? 'Running' : 'Stopped', torrent.running ? 'ok' : 'neutral')
      : makeStatusPill('Disabled', 'neutral');
    head.append(titleWrap, pill);
    const address = document.createElement('code');
    address.className = 'service-address';
    const seedText = torrent.seederRunning
      ? (torrent.seeding ? `seeding ${torrent.seeding}` : 'seeding')
      : 'no seed';
    address.textContent = torrent.serverIp
      ? `${torrent.serverIp}:${torrent.trackerPort ?? 6969} · ${seedText}`
      : 'P2P OS image distribution';
    row.append(head, address);

    const peers = torrent.swarmPeers ?? [];
    if (peers.length > 0) {
      const peerList = document.createElement('div');
      peerList.className = 'torrent-swarm-peers';
      for (const peer of peers) {
        const item = document.createElement('div');
        item.className = 'torrent-peer-row';
        const total = peer.left + peer.downloaded;
        const pct = total > 0 ? Math.round((peer.downloaded / total) * 100) : (peer.complete ? 100 : 0);
        const status = peer.complete ? 'seeding ✓' : `${pct}%`;
        item.textContent = `${peer.ip}  ${status}`;
        peerList.append(item);
      }
      row.append(peerList);
    }

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

function initializationActionLabel(action) {
  const labels = {
    'project-root': 'Set project root',
    secrets: 'Save secrets',
    'prepare-runtime': 'Prepare runtime',
    'endpoint-sync': 'Sync endpoint',
    interfaces: 'Select endpoint',
    'os-images': 'Open OS images',
    profiles: 'Publish profile',
    preflight: 'Run preflight',
    'all-services-toggle': 'Start services',
    dashboard: 'Open dashboard',
  };
  return labels[action] ?? 'Open';
}

function initializationActionIcon(action) {
  const icons = {
    'project-root': 'folder_managed',
    secrets: 'password',
    'prepare-runtime': 'deployed_code_update',
    'endpoint-sync': 'sync_alt',
    interfaces: 'settings_ethernet',
    'os-images': 'deployed_code',
    profiles: 'list_alt',
    preflight: 'fact_check',
    'all-services-toggle': 'play_arrow',
    dashboard: 'dashboard',
  };
  return icons[action] ?? 'arrow_forward';
}

function initializationDetailStatusLabel(statusClass) {
  if (statusClass === 'blocked') {
    return 'MISSING';
  }
  if (statusClass === 'blocked-by-dependency') {
    return 'BLOCKED';
  }
  return statusClass ? statusClass.replace(/-/gu, ' ').toUpperCase() : '';
}

function appendInitializationDetailItems(body, stepId, detailItems = []) {
  if (!Array.isArray(detailItems) || detailItems.length === 0) {
    return null;
  }
  const list = document.createElement('div');
  list.className = 'initialization-detail-list';
  if (stepId) {
    list.dataset.initializationStepId = String(stepId);
  }
  for (const item of detailItems) {
    const row = document.createElement('div');
    row.className = 'initialization-detail-item';
    const statusClass = String(item.status ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-');
    if (statusClass) {
      row.classList.add(`status-${statusClass}`);
    }
    const statusLabel = initializationDetailStatusLabel(statusClass);
    const status = document.createElement('span');
    status.className = 'initialization-detail-status';
    status.textContent = statusLabel;
    if (statusLabel) {
      row.classList.add('has-status');
    }
    const title = document.createElement('span');
    title.className = 'initialization-detail-title';
    title.textContent = item.title ?? 'Runtime artifact';
    const meta = document.createElement('span');
    meta.className = 'initialization-detail-meta';
    meta.textContent = item.meta ?? '';
    const detail = document.createElement('span');
    detail.className = 'initialization-detail-text';
    detail.textContent = item.detail ?? '';
    row.append(status, title, meta, detail);
    list.append(row);
  }
  body.append(list);
  return list;
}

function appendGuidedStepOverview(body, step) {
  const items = [
    ['用途', step.objective],
    ['完成條件', step.doneWhen],
    ['安全提醒', step.safetyNote],
  ].filter(([, value]) => String(value ?? '').trim());
  if (items.length === 0) {
    return;
  }
  const overview = document.createElement('div');
  overview.className = 'guided-step-overview';
  for (const [label, value] of items) {
    const row = document.createElement('div');
    row.className = 'guided-step-overview-row';
    const title = document.createElement('strong');
    title.textContent = label;
    const textNode = document.createElement('span');
    textNode.textContent = value;
    row.append(title, textNode);
    overview.append(row);
  }
  body.append(overview);
}

function captureInitializationDetailScrollPositions() {
  const positions = {};
  elements.initializationSteps?.querySelectorAll('.initialization-detail-list[data-initialization-step-id]').forEach((list) => {
    const stepId = list.dataset.initializationStepId;
    if (!stepId) {
      return;
    }
    positions[stepId] = {
      atBottom: isScrolledToBottom(list),
      scrollTop: list.scrollTop,
    };
  });
  return positions;
}

function restoreInitializationDetailScrollPosition(stepId, list) {
  if (!stepId || !list) {
    return;
  }
  const position = state.initializationDetailScrollPositions?.[stepId];
  if (!position) {
    return;
  }
  const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  list.scrollTop = position.atBottom ? list.scrollHeight : Math.min(position.scrollTop, maxScrollTop);
}

function initializationDialogBody() {
  return elements.initializationDialog?.querySelector('.drawer-body') ?? null;
}

function captureInitializationDialogScrollPosition() {
  const body = initializationDialogBody();
  if (!body) {
    return null;
  }
  return {
    atBottom: isScrolledToBottom(body),
    scrollTop: body.scrollTop,
  };
}

function restoreInitializationDialogScrollPosition(position) {
  if (!position) {
    return;
  }
  const body = initializationDialogBody();
  if (!body) {
    return;
  }
  const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
  body.scrollTop = position.atBottom ? body.scrollHeight : Math.min(position.scrollTop, maxScrollTop);
}

function initializationSecretsControls() {
  return {
    status: elements.initializationDialog?.querySelector('.initialization-secrets-status') ?? null,
    windowsUsername: elements.initializationDialog?.querySelector('#init-windows-username') ?? null,
    windowsPassword: elements.initializationDialog?.querySelector('#init-windows-password') ?? null,
  };
}

function captureInitializationSecretsDraft() {
  const controls = initializationSecretsControls();
  state.initializationSecretsDraft.windowsUsername = controls.windowsUsername?.value ?? state.initializationSecretsDraft.windowsUsername;
  state.initializationSecretsDraft.windowsPassword = controls.windowsPassword?.value ?? state.initializationSecretsDraft.windowsPassword;
}

function clearInitializationSecretsDraft() {
  state.initializationSecretsDraft.windowsUsername = DEFAULT_WINDOWS_USERNAME;
  state.initializationSecretsDraft.windowsPassword = '';
}

function focusedInitializationTextControl() {
  const activeId = document.activeElement?.id;
  if (activeId !== 'init-windows-username' && activeId !== 'init-windows-password' && activeId !== 'init-project-root') {
    return null;
  }
  return {
    id: activeId,
    selectionStart: document.activeElement.selectionStart,
    selectionEnd: document.activeElement.selectionEnd,
  };
}

function restoreInitializationTextControlFocus(focusedControl) {
  if (!focusedControl?.id) {
    return;
  }
  const input = elements.initializationDialog?.querySelector(`#${focusedControl.id}`);
  if (!input) {
    return;
  }
  input.focus({ preventScroll: true });
  if (typeof focusedControl.selectionStart === 'number' && typeof focusedControl.selectionEnd === 'number') {
    input.setSelectionRange(focusedControl.selectionStart, focusedControl.selectionEnd);
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('Copy failed.');
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose Clipboard API but deny this call.
    }
  }
  fallbackCopyText(text);
}

async function copyInitializationOperationLog(button) {
  const logText = state.initializationOperationLogText;
  if (!logText) {
    return;
  }
  await copyText(logText);
  button.dataset.icon = 'done';
  button.title = 'Copied';
  button.setAttribute('aria-label', 'Copied');
  window.setTimeout(() => {
    if (!button.isConnected) {
      return;
    }
    button.dataset.icon = 'content_copy';
    button.title = 'Copy log';
    button.setAttribute('aria-label', 'Copy log');
  }, 1200);
}

function createInitializationSecretField(id, name, labelText, type = 'password') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = type;
  input.autocomplete = type === 'password' ? 'new-password' : 'on';
  input.required = true;
  input.value = state.initializationSecretsDraft[name] ?? '';
  input.addEventListener('input', () => {
    state.initializationSecretsDraft[name] = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    saveInitializationSecrets().catch((error) => window.alert(error.message));
  });
  label.append(input);
  return label;
}

function appendInitializationSecretsForm(body) {
  const editing = state.initializationSecretsEditing;
  const form = document.createElement('div');
  form.className = 'initialization-secrets-form';
  const status = document.createElement('span');
  status.className = 'initialization-secrets-status';
  status.setAttribute('aria-live', 'polite');
  if (editing) {
    status.textContent = '重新輸入 Windows 帳號與密碼以覆寫現有認證（密碼不會回填，需重新輸入）。';
  }
  const actions = document.createElement('div');
  actions.className = 'initialization-secrets-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'warning';
  button.dataset.initAction = 'save-secrets';
  button.dataset.icon = 'password';
  button.textContent = editing ? '更新部署認證' : 'Save deployment secrets';
  actions.append(button);
  if (editing) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.initAction = 'cancel-secrets';
    cancel.textContent = '取消';
    actions.append(cancel);
  }
  form.append(
    createInitializationSecretField('init-windows-username', 'windowsUsername', 'Windows 帳號', 'text'),
    createInitializationSecretField('init-windows-password', 'windowsPassword', 'Windows 密碼', 'password'),
    status,
    actions,
  );
  body.append(form);
}

function appendInitializationSecretsEditButton(body) {
  const actions = document.createElement('div');
  actions.className = 'initialization-secrets-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.initAction = 'edit-secrets';
  button.dataset.icon = 'password';
  button.textContent = '修改認證';
  actions.append(button);
  body.append(actions);
}

function appendInitializationProjectRootForm(body, step) {
  state.initializationRootDraft = 'C:\\OSDCloud';
  const form = document.createElement('div');
  form.className = 'initialization-secrets-form';
  const label = document.createElement('label');
  label.textContent = 'Deployment working directory';
  const input = document.createElement('input');
  input.id = 'init-project-root';
  input.type = 'text';
  input.value = 'C:\\OSDCloud';
  input.placeholder = 'C:\\OSDCloud';
  input.readOnly = true;
  input.disabled = true;
  label.append(input);
  const status = document.createElement('span');
  status.className = 'initialization-secrets-status';
  status.textContent = 'Project root is locked to C:\\OSDCloud for deployment stability.';
  form.append(label, status);
  body.append(form);
}

function initializationActionForOperation(operation) {
  if (!operation?.label) {
    return null;
  }
  if (operation.label === 'Preparing runtime artifacts') {
    return 'prepare-runtime';
  }
  if (operation.label === 'Running preflight') {
    return 'preflight';
  }
  if (operation.label === 'Applying service endpoint') {
    return 'endpoint-sync';
  }
  if (operation.label === 'Starting all services' || operation.label === 'Stopping all services') {
    return 'all-services-toggle';
  }
  if (operation.label === 'Saving project root') {
    return 'project-root';
  }
  return null;
}

function activeInitializationOperation(appState) {
  const operation = appState.operation ?? null;
  const operationAction = initializationActionForOperation(operation);
  if (state.initializationPendingAction) {
    return {
      action: state.initializationPendingAction,
      operation: operationAction === state.initializationPendingAction ? operation : null,
    };
  }
  if (operation?.running && operationAction) {
    return { action: operationAction, operation };
  }
  if (state.initializationOperationAction && operationAction === state.initializationOperationAction) {
    return { action: state.initializationOperationAction, operation };
  }
  return null;
}

function renderInitializationOperation(appState) {
  const panel = elements.initializationOperation;
  if (!panel) {
    return;
  }
  const activeOperation = activeInitializationOperation(appState);
  if (!activeOperation) {
    panel.hidden = true;
    panel.replaceChildren();
    state.initializationOperationLogText = '';
    return;
  }

  const existingLog = panel.querySelector('.initialization-operation-log');
  const previousScrollTop = existingLog?.scrollTop ?? 0;
  const wasAtBottom = existingLog ? isScrolledToBottom(existingLog) : true;
  const { action, operation } = activeOperation;
  const running = Boolean(operation?.running || state.initializationPendingAction === action);
  const status = running ? 'running' : operation?.status ?? 'running';
  const statusText = status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Running';
  const titleText = operation?.label ?? (action === 'prepare-runtime' ? 'Preparing runtime artifacts' : 'Running preflight');
  const lines = (operation?.lines ?? []).filter((line) => String(line).trim());
  const operationLogText = lines.join('\n');
  state.initializationOperationLogText = operationLogText;

  panel.hidden = false;
  panel.className = `initialization-operation-panel ${status}`;
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'initialization-operation-header';
  const title = document.createElement('strong');
  title.className = 'initialization-operation-title';
  title.textContent = titleText;
  const actions = document.createElement('div');
  actions.className = 'initialization-operation-header-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'initialization-operation-copy';
  copyButton.dataset.operationAction = 'copy-log';
  copyButton.dataset.icon = 'content_copy';
  copyButton.title = 'Copy log';
  copyButton.setAttribute('aria-label', 'Copy log');
  copyButton.disabled = !operationLogText;
  const badge = document.createElement('span');
  badge.className = `status-pill ${status === 'completed' ? 'ok' : status === 'failed' ? 'fail' : 'working'}`;
  badge.textContent = statusText;
  actions.append(copyButton, badge);
  header.append(title, actions);
  panel.append(header);

  if (operation?.error) {
    const error = document.createElement('div');
    error.className = 'initialization-operation-error';
    error.textContent = operation.error;
    panel.append(error);
  }

  const log = document.createElement('pre');
  log.className = 'initialization-operation-log';
  log.textContent = operationLogText
    ? operationLogText
    : running ? 'Starting operation...' : 'No operation output captured.';
  panel.append(log);
  log.scrollTop = wasAtBottom ? log.scrollHeight : previousScrollTop;
}

function renderInitialization(appState) {
  const initialization = appState.initialization;
  if (!initialization || !elements.initializationDialog) {
    return;
  }

  // Set default view depending on initialization status
  const initialized = initialization.initialized === true;
  const deploymentReady = initialization.deploymentReady === true;
  const deploymentLive = initialization.deploymentLive === true;
  if (state.currentView === null) {
    state.currentView = deploymentLive ? 'dashboard' : 'guided';
  }

  // Toggle active views and nav tabs
  if (elements.tabGuided && elements.tabDashboard) {
    elements.tabGuided.classList.toggle('active', state.currentView === 'guided');
    elements.tabDashboard.classList.toggle('active', state.currentView === 'dashboard');
  }
  if (elements.tabFleet) {
    elements.tabFleet.classList.toggle('active', state.currentView === 'fleet');
  }
  if (elements.navServices) {
    elements.navServices.classList.toggle('active', state.currentView === 'services');
  }
  if (elements.navLogs) {
    elements.navLogs.classList.toggle('active', state.currentView === 'logs');
  }
  if (elements.contextTitle) {
    const titles = { dashboard: 'Overview', guided: 'Setup', fleet: 'Fleet', services: 'Services', logs: 'Logs' };
    elements.contextTitle.textContent = titles[state.currentView] ?? 'Overview';
  }
  if (elements.initializationDialog) {
    elements.initializationDialog.classList.toggle('active', state.currentView === 'guided');
  }
  const dashboardView = $('#view-dashboard');
  if (dashboardView) {
    dashboardView.classList.toggle('active', state.currentView === 'dashboard');
  }
  const fleetView = $('#view-fleet');
  if (fleetView) {
    fleetView.classList.toggle('active', state.currentView === 'fleet');
  }

  captureInitializationSecretsDraft();
  const focusedTextControl = focusedInitializationTextControl();

  const activeOperation = activeInitializationOperation(appState);
  const initializationBusy = state.busy || Boolean(state.initializationPendingAction) || appState.operation?.running === true;
  elements.initializationBadge.textContent = deploymentLive ? 'Live' : deploymentReady ? 'Ready' : initialized ? 'Configured' : 'Guided setup';
  elements.initializationBadge.className = `status-pill ${deploymentReady || deploymentLive ? 'ok' : initialized ? 'working' : 'neutral'}`;
  const nextStep = (initialization.steps ?? []).find((step) => step.id === initialization.nextStepId);
  elements.initializationSummary.textContent = deploymentLive
    ? 'Services are running. Boot the client from UEFI IPv4 PXE and monitor the dashboard.'
    : deploymentReady
      ? 'Preflight passed. Confirm DHCP safety before starting services.'
      : initialized
        ? 'Base setup is complete. Run preflight before starting services.'
        : `Next: ${nextStep?.label ?? 'Run preflight'}`;
  renderInitializationOperation(appState);
  const dialogScrollPosition = captureInitializationDialogScrollPosition();
  state.initializationDetailScrollPositions = captureInitializationDetailScrollPositions();
  
  // Set default selected step in guided setup
  if (!state.selectedGuidedStepId) {
    state.selectedGuidedStepId = initialization.nextStepId || initialization.steps?.[0]?.id || 'project-root';
  }

  elements.initializationSteps.replaceChildren();

  // Setup progress bar (Stitch parity)
  const allSteps = initialization.steps ?? [];
  const totalSteps = allSteps.length;
  const doneSteps = allSteps.filter((step) => step.done).length;
  const progressPercent = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;
  if (elements.initProgressFill) {
    elements.initProgressFill.style.width = `${progressPercent}%`;
  }
  if (elements.initProgressText) {
    elements.initProgressText.textContent = `${doneSteps} of ${totalSteps} complete · ${progressPercent}%`;
  }

  // 1. Render Left Column Stepper List
  let index = 1;
  for (const step of initialization.steps ?? []) {
    const stepIsRunning = (step.id === 'runtime' && activeOperation?.action === 'prepare-runtime' && initializationBusy)
      || (step.id === 'project-root' && activeOperation?.action === 'project-root' && initializationBusy)
      || (step.id === 'endpoint' && activeOperation?.action === 'endpoint-sync' && initializationBusy)
      || (step.id === 'preflight' && activeOperation?.action === 'preflight' && initializationBusy)
      || (step.id === 'services' && activeOperation?.action === 'all-services-toggle' && initializationBusy);

    const row = document.createElement('div');
    row.className = `initialization-step ${step.done ? 'done' : step.required ? 'blocked' : 'optional'}`;
    row.dataset.stepId = step.id;
    if (step.id === state.selectedGuidedStepId) {
      row.classList.add('active');
    }
    if (stepIsRunning) {
      row.classList.add('working');
    }

    const status = document.createElement('span');
    status.className = `status-pill ${stepIsRunning ? 'working' : step.done ? 'ok' : step.required ? 'fail' : 'neutral'}`;
    status.textContent = stepIsRunning && step.id === 'runtime'
      ? 'Preparing'
      : stepIsRunning ? 'Running' : step.done ? 'Done' : step.required ? 'Required' : 'Optional';

    const body = document.createElement('div');
    body.className = 'initialization-step-body';
    const title = document.createElement('strong');
    title.textContent = `${index.toString().padStart(2, '0')}. ${step.label}`;
    const detail = document.createElement('span');
    detail.textContent = step.detail ?? '';
    body.append(title, detail);

    row.append(status, body);
    elements.initializationSteps.append(row);
    index++;
  }

  // 2. Render the focused detail panel (moved inline under the active step below)
  const selectedStep = (initialization.steps ?? []).find(s => s.id === state.selectedGuidedStepId) || initialization.steps?.[0];
  const detailPanel = elements.guidedStepDetail;

  if (selectedStep && detailPanel) {
    detailPanel.replaceChildren();

    // Header
    const header = document.createElement('div');
    header.className = 'guided-detail-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'guided-detail-title-row';
    const title = document.createElement('h3');
    title.className = 'guided-detail-title';
    const stepIcon = document.createElement('span');
    stepIcon.className = 'material-symbols-outlined text-[24px] text-primary-fixed';
    stepIcon.textContent = initializationActionIcon(selectedStep.action);
    title.append(stepIcon, document.createTextNode(selectedStep.label));

    const desc = document.createElement('p');
    desc.className = 'guided-detail-desc';
    desc.textContent = selectedStep.objective ?? selectedStep.detail ?? 'Configure this deployment parameter.';
    titleRow.append(title, desc);

    const badge = document.createElement('span');
    const stepIsRunning = (selectedStep.id === 'runtime' && activeOperation?.action === 'prepare-runtime' && initializationBusy)
      || (selectedStep.id === 'project-root' && activeOperation?.action === 'project-root' && initializationBusy)
      || (selectedStep.id === 'endpoint' && activeOperation?.action === 'endpoint-sync' && initializationBusy)
      || (selectedStep.id === 'preflight' && activeOperation?.action === 'preflight' && initializationBusy)
      || (selectedStep.id === 'services' && activeOperation?.action === 'all-services-toggle' && initializationBusy);
    badge.className = `status-pill ${stepIsRunning ? 'working' : selectedStep.done ? 'ok' : selectedStep.required ? 'fail' : 'neutral'}`;
    badge.textContent = stepIsRunning ? 'Running' : selectedStep.done ? 'Ready' : selectedStep.required ? 'Required' : 'Optional';

    header.append(titleRow, badge);
    detailPanel.append(header);

    // Step Body Container (named 'body' to preserve exact test matches)
    const body = document.createElement('div');
    body.className = 'guided-detail-body flex flex-col gap-md';

    const step = selectedStep;
    const hasInlineSecretsForm = step.id === 'secrets' && (!step.done || state.initializationSecretsEditing);
    const hasInlineProjectRootForm = step.id === 'project-root';

    // Render detailed items & forms (named 'body' to pass test assertions)
    appendGuidedStepOverview(body, step);
    const detailList = appendInitializationDetailItems(body, step.id, step.detailItems);
    if (hasInlineSecretsForm) {
      appendInitializationSecretsForm(body);
    } else if (step.id === 'secrets' && step.done) {
      appendInitializationSecretsEditButton(body);
    }
    if (hasInlineProjectRootForm) {
      appendInitializationProjectRootForm(body, selectedStep);
    }

    // Action button
    if (!selectedStep.done && selectedStep.action && selectedStep.action !== 'setup' && !hasInlineSecretsForm && !hasInlineProjectRootForm) {
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'flex justify-start mt-md';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = selectedStep.required ? 'warning px-lg py-md' : 'px-lg py-md';
      button.dataset.initAction = selectedStep.action;
      button.dataset.icon = initializationActionIcon(selectedStep.action);
      button.textContent = selectedStep.nextActionText ?? initializationActionLabel(selectedStep.action);
      
      const runtime = appState.runtime;
      const requiresElevation = appState?.host?.elevated === false;
      button.disabled = state.busy
        || (selectedStep.action === 'prepare-runtime' && (runtime.ready || requiresElevation))
        || (selectedStep.action === 'all-services-toggle' && initialization.deploymentReady !== true);
      
      buttonContainer.append(button);
      body.append(buttonContainer);
    }

    detailPanel.append(body);
    restoreInitializationDetailScrollPosition(step.id, detailList);
  }

  // v3 timeline: nest the focused detail panel inline directly under the active step
  if (elements.guidedStepDetail) {
    const activeRow = elements.initializationSteps.querySelector('.initialization-step.active');
    if (activeRow) {
      activeRow.after(elements.guidedStepDetail);
    } else {
      elements.initializationSteps.append(elements.guidedStepDetail);
    }
    elements.guidedStepDetail.hidden = !selectedStep;
  }

  if (nextStep?.action && nextStep.action !== 'setup') {
    elements.initializationNext.hidden = false;
    elements.initializationNext.dataset.initAction = 'next';
    elements.initializationNext.dataset.nextAction = nextStep.action;
    elements.initializationNext.dataset.icon = initializationActionIcon(nextStep.action);
    elements.initializationNext.textContent = nextStep.nextActionText ?? initializationActionLabel(nextStep.action);
    elements.initializationNext.disabled = initializationBusy;
  } else {
    elements.initializationNext.hidden = initialized;
    elements.initializationNext.dataset.nextAction = 'preflight';
    elements.initializationNext.dataset.icon = 'fact_check';
    elements.initializationNext.textContent = 'Run preflight';
    elements.initializationNext.disabled = initializationBusy;
  }

  if (!deploymentLive && !state.initializationAutoOpened && !document.querySelector('dialog[open]')) {
    state.initializationAutoOpened = true;
    switchToView('guided');
  }
  restoreInitializationDialogScrollPosition(dialogScrollPosition);
  restoreInitializationTextControlFocus(focusedTextControl);
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

function customFilterValues(input) {
  return String(input?.value ?? '')
    .split(/[,\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function selectedOsCatalogFilters() {
  return {
    osFamily: ['win11'],
    edition: ['Pro'],
    activation: ['Retail'],
    language: uniqueValues([
      ...checkedValues('os-catalog-language'),
      ...customFilterValues(elements.osCatalogLanguageCustom),
    ]),
    releaseId: uniqueValues([
      ...checkedValues('os-catalog-release'),
      ...customFilterValues(elements.osCatalogReleaseCustom).map((value) => value.toUpperCase()),
    ]),
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
  meta.textContent = active ? osImageLabel(active) : 'No OS image selected.';
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
    elements.osDownloadStatus.textContent = status.running && state.refreshError
      ? 'Connection to Web console lost; status may be stale.'
      : osDownloadStatusText(status);
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
        button.textContent = osDownloadButtonText(downloadStatus);
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
  {
    const total = appState.fleet?.total ?? 0;
    const parts = [`${total} machine${total === 1 ? '' : 's'}`];
    if ((counts.running ?? 0) > 0) parts.push(`${counts.running} deploying`);
    if ((counts.completed ?? 0) > 0) parts.push(`${counts.completed} ready`);
    if ((counts.failed ?? 0) > 0) parts.push(`${counts.failed} failed`);
    elements.fleetCounts.textContent = parts.join(' · ');
  }
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

  if (nameLower === 'winpe boot.wim customization') {
    return 'Open Select interface, choose an enabled adapter, and click Sync (or run the endpoint sync script) to mount and customize boot.wim with the active settings, then run preflight again.';
  }
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

function renderDriverPackCache(appState) {
  if (!elements.driverCacheDetails || !elements.driverCacheCount) {
    return;
  }
  const cache = appState.driverPackCache ?? {};
  const entries = cache.entries ?? [];
  elements.driverCacheCount.textContent = cache.enabled
    ? `${entries.filter((entry) => entry.exists).length}/${entries.length} cached`
    : 'Disabled';
  elements.driverCacheDetails.replaceChildren();
  if (!cache.enabled) {
    const row = document.createElement('div');
    row.className = 'check-row neutral';
    row.textContent = 'Driver pack cache is disabled.';
    elements.driverCacheDetails.append(row);
    return;
  }
  if (!entries.length) {
    const row = document.createElement('div');
    row.className = 'check-row neutral';
    row.textContent = `No driver cache requests recorded yet. Cache root: ${text(cache.root)}`;
    elements.driverCacheDetails.append(row);
    return;
  }
  for (const entry of entries.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = `driver-cache-row check-row ${entry.exists ? 'ok' : entry.status === 'failed' || entry.status === 'rejected' ? 'fail' : 'working'}`;
    const title = document.createElement('strong');
    title.textContent = [entry.manufacturer, entry.model, entry.product].filter(Boolean).join(' / ')
      || entry.name
      || entry.packageId
      || entry.fileName
      || 'Unknown model';
    const detail = document.createElement('span');
    detail.textContent = `${text(entry.status)} ${text(entry.fileName)} ${bytes(entry.bytes)} ${entry.reason ? `- ${entry.reason}` : ''}`.trim();
    row.append(title, detail);
    elements.driverCacheDetails.append(row);
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
  if (alias.includes('vethernet')) {
    return 'virtual adapter';
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
    td.colSpan = 5;
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

function latestRunEvent(appState, predicate) {
  return [...runEvents(appState)].reverse().find(predicate) ?? null;
}

function makePreformattedValue(value) {
  const node = document.createElement('div');
  node.className = 'font-log-entry text-log-entry';
  node.style.whiteSpace = 'pre-wrap';
  node.textContent = text(value);
  return node;
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
    setDefinitionList(elements.installerErrorEvidence, [['Error', 'No selected run']]);
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

  const installerErrorEvent = latestRunEvent(appState, (event) => event.stage === 'windows-apps-error'
    || event.exitCode !== undefined
    || event.stdoutTailText
    || event.stderrTailText
    || event.transcriptTailText);
  setDefinitionListNodes(elements.installerErrorEvidence, [
    ['Stage', installerErrorEvent?.stage ?? 'Not reported'],
    ['ExitCode', installerErrorEvent?.exitCode ?? 'Not reported'],
    ['Script', installerErrorEvent?.script ?? 'Not reported'],
    ['AppsRoot', installerErrorEvent?.root ?? 'Not reported'],
    ['StdoutLog', installerErrorEvent?.stdoutLog ?? 'Not reported'],
    ['StderrLog', installerErrorEvent?.stderrLog ?? 'Not reported'],
    ['TranscriptLog', installerErrorEvent?.transcriptLog ?? 'Not reported'],
    ['StdoutTail', makePreformattedValue(installerErrorEvent?.stdoutTailText ?? 'Not reported')],
    ['StderrTail', makePreformattedValue(installerErrorEvent?.stderrTailText ?? 'Not reported')],
    ['TranscriptTail', makePreformattedValue(installerErrorEvent?.transcriptTailText ?? 'Not reported')],
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

    if (event.stage === 'torrent-peers') {
      const msg = event.message ?? '';
      const match = msg.match(/peers=(\d+)(?:\s+ips=([\d.,]+))?/);
      if (match) {
        const count = match[1];
        const ips = match[2] ? match[2].split(',') : [];
        detail.textContent = `[torrent-peers] ${count} peer(s)`;
        if (ips.length) {
          const ipList = document.createElement('ul');
          ipList.className = 'torrent-peer-ips';
          for (const ip of ips) {
            const li = document.createElement('li');
            li.textContent = ip;
            ipList.append(li);
          }
          row.append(when, detail, ipList);
          elements.eventTimeline.append(row);
          continue;
        }
      } else {
        detail.textContent = `[torrent-peers] ${msg}`;
      }
    } else {
      detail.textContent = `[${text(event.stage, 'event')}] ${text(event.message, '')}`;
    }

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

function renderWarningBanner(appState) {
  if (!elements.warningBanner || !elements.warningBannerText) {
    return;
  }
  const preflight = appState.preflight ?? [];
  const customizationCheck = preflight.find((c) => String(c.name).toLowerCase() === 'winpe boot.wim customization');
  const syncCheck = preflight.find((c) => String(c.name).toLowerCase() === 'winpe boot.wim synchronization');

  if (customizationCheck && customizationCheck.ok === false) {
    elements.warningBanner.classList.remove('hidden');
    elements.warningBannerText.textContent = customizationCheck.detail || 'WinPE boot.wim has not been customized yet. Please run Endpoint Sync.';
  } else if (syncCheck && syncCheck.ok === false) {
    elements.warningBanner.classList.remove('hidden');
    elements.warningBannerText.textContent = syncCheck.detail || 'Configuration or secrets changes are pending. Please run Endpoint Sync to apply updates.';
  } else {
    elements.warningBanner.classList.add('hidden');
  }
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
  renderWarningBanner(appState);
  renderOperation(appState);
  renderEndpointSummary(appState);
  renderRuntimeReadiness(appState);
  renderServices(appState);
  renderProfileSummary(appState);
  renderOsImageSummary(appState);
  renderPreflightSummary(appState.preflight);
  renderDriverPackCache(appState);
  renderInitialization(appState);
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
  renderPipeline(appState);
  renderTopology(appState);
  renderLiveMetrics(appState);
  renderStatusStrip(appState);
  renderSummaryBar(appState);
  renderFleetCards(appState);
  setControlsDisabled(state.busy || appState.operation?.running === true);
}

// ---- v3: deploy summary bar (endpoint + service dots + state-aware action) ----
function preflightState(appState) {
  const pf = appState.preflight;
  if (pf?.summary?.blocking > 0 || pf?.status === 'blocked') return ['Preflight blocked', 'warn'];
  if (pf?.status === 'ready' || pf?.ok === true) return ['Preflight passed', 'ok'];
  if (pf?.status === 'review' || (pf?.summary?.warnings ?? 0) > 0) return ['Preflight: review', 'warn'];
  if (pf?.ranAt || pf?.checks?.length) return ['Preflight passed', 'ok'];
  return ['Preflight not run', ''];
}

function renderSummaryBar(appState) {
  if (elements.summaryEndpoint) {
    elements.summaryEndpoint.textContent = endpointLabel(appState.config) || '—';
  }
  if (elements.summaryServices) {
    const rows = [['HTTP', 'http'], ['TFTP', 'tftp'], ['DHCP', 'dhcp']];
    elements.summaryServices.replaceChildren();
    for (const [label, key] of rows) {
      const running = appState.services?.[key]?.running === true;
      const span = document.createElement('span');
      span.className = `v3-svc ${running ? 'on' : 'off'}`;
      const dot = document.createElement('span');
      dot.className = 'd';
      span.append(dot, document.createTextNode(label));
      elements.summaryServices.append(span);
    }
  }
  const [pfText, pfTone] = preflightState(appState);
  const runtimeReady = appState.runtime?.ready === true;
  const allRunning = ['http', 'tftp', 'dhcp'].every((n) => appState.services?.[n]?.running);
  const preflightPassed = pfTone === 'ok';

  if (elements.summaryStatus) {
    if (!runtimeReady) {
      elements.summaryStatus.textContent = 'Runtime not ready';
      elements.summaryStatus.className = 'v3-summary-status warn';
    } else {
      elements.summaryStatus.textContent = pfText;
      elements.summaryStatus.className = `v3-summary-status ${pfTone}`;
    }
  }
  if (elements.summaryAction) {
    let label = 'Run preflight';
    let action = 'preflight';
    if (allRunning) { label = 'Stop services'; action = 'all-services-toggle'; }
    else if (preflightPassed) { label = 'Start services'; action = 'all-services-toggle'; }
    elements.summaryAction.textContent = label;
    elements.summaryAction.dataset.action = action;
  }
}

// ---- v2: Overview status strip ----
function setStrip(el, text, tone) {
  if (!el) return;
  el.className = `ss-value${tone ? ' ' + tone : ''}`;
  el.replaceChildren();
  if (tone === 'ok' || tone === 'warn' || tone === 'err' || tone === 'neutral') {
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.append(dot);
  }
  el.append(document.createTextNode(text));
}

function renderStatusStrip(appState) {
  const runtimeReady = appState.runtime?.ready === true;
  setStrip(elements.ssRuntime, runtimeReady ? 'Ready' : 'Not ready', runtimeReady ? 'ok' : 'warn');

  const pf = appState.preflight;
  let pfText = 'Not run';
  let pfTone = 'neutral';
  if (pf?.summary?.blocking > 0 || pf?.status === 'blocked') { pfText = 'Blocked'; pfTone = 'err'; }
  else if (pf?.status === 'ready' || pf?.ok === true) { pfText = 'Ready'; pfTone = 'ok'; }
  else if (pf?.status === 'review' || (pf?.summary?.warnings ?? 0) > 0) { pfText = 'Review'; pfTone = 'warn'; }
  else if (pf?.ranAt || pf?.checks?.length) { pfText = 'Ready'; pfTone = 'ok'; }
  setStrip(elements.ssPreflight, pfText, pfTone);

  const running = ['http', 'tftp', 'dhcp'].filter((n) => appState.services?.[n]?.running).length;
  setStrip(elements.ssServices, `${running} / 3 running`, running === 3 ? 'ok' : running === 0 ? 'neutral' : 'warn');

  const counts = appState.fleet?.counts ?? {};
  setStrip(elements.ssActive, String(counts.running ?? 0), (counts.running ?? 0) > 0 ? 'ok' : 'neutral');
  setStrip(elements.ssDone, String(counts.completed ?? 0), 'neutral');
}

// ---- Aurora: Live Metrics bento card (Overview) ----
function renderLiveMetrics(appState) {
  if (!elements.liveMetrics) {
    return;
  }
  const counts = appState.fleet?.counts ?? {};
  const deploying = counts.running ?? 0;
  const ready = counts.completed ?? 0;
  const failed = counts.failed ?? 0;
  const metrics = [
    ['deploying', deploying, 'Deploying'],
    ['ready', ready, 'Ready'],
  ];
  if (failed) {
    metrics.push(['failed', failed, 'Failed']);
  }
  elements.liveMetrics.replaceChildren();
  for (const [cls, num, lbl] of metrics) {
    const metric = document.createElement('div');
    metric.className = `live-metric ${cls}`;
    const n = document.createElement('span');
    n.className = 'lm-num';
    n.textContent = String(num).padStart(2, '0');
    const l = document.createElement('span');
    l.className = 'lm-lbl';
    l.textContent = lbl;
    metric.append(n, l);
    elements.liveMetrics.append(metric);
  }
  const foot = document.createElement('div');
  foot.className = 'lm-foot';
  const runs = appState.fleet?.runs ?? [];
  const lastSeen = runs.map((r) => r.lastReceivedAt).filter(Boolean).sort().at(-1);
  foot.textContent = lastSeen ? `last seen ${localTime(lastSeen)}` : 'no client activity yet';
  elements.liveMetrics.append(foot);
}

// ---- Aurora: vertical deployment pipeline (Overview hero sidebar) ----
function renderPipeline(appState) {
  if (!elements.pipelineSteps) {
    return;
  }
  const init = appState.initialization ?? {};
  const steps = init.steps ?? [];
  elements.pipelineSteps.replaceChildren();
  let index = 1;
  for (const step of steps) {
    const isCurrent = step.id === init.nextStepId;
    const cls = step.done ? 'done' : isCurrent ? 'current' : step.required ? 'locked' : '';
    const row = document.createElement('div');
    row.className = `pipe-step ${cls}`.trim();
    const dot = document.createElement('span');
    dot.className = 'pipe-dot';
    if (step.done) {
      dot.append(makeIcon('check'));
    } else if (cls === 'locked') {
      dot.append(makeIcon('lock'));
    } else {
      dot.textContent = String(index);
    }
    const body = document.createElement('div');
    body.className = 'pipe-body';
    const name = document.createElement('span');
    name.className = 'pipe-name';
    name.textContent = step.label ?? step.id;
    const meta = document.createElement('span');
    meta.className = 'pipe-meta';
    meta.textContent = step.done ? 'Done' : isCurrent ? 'Current step' : step.required ? 'Locked' : 'Optional';
    body.append(name, meta);
    row.append(dot, body);
    elements.pipelineSteps.append(row);
    index += 1;
  }
}

// ---- Aurora: live network topology client nodes (Overview hero) ----
function topologyRingClass(run) {
  if (run.status === 'completed') return 'ring done';
  if (run.status === 'failed') return 'ring';
  return 'ring';
}

function renderTopology(appState) {
  if (elements.topologyHostIp) {
    elements.topologyHostIp.textContent = appState.config?.serverIp ?? appState.config?.ipxe?.serverIp ?? '—';
  }
  const anyRunning = ['http', 'tftp', 'dhcp'].some((name) => appState.services?.[name]?.running);
  if (elements.topologyPorts) {
    const active = ['http', 'tftp', 'dhcp'].filter((name) => appState.services?.[name]?.running).length;
    elements.topologyPorts.textContent = active ? `${active} ports active` : 'ready';
  }
  if (elements.topologyThroughput) {
    elements.topologyThroughput.textContent = anyRunning ? 'serving · live stream' : 'idle · no active stream';
  }
  if (!elements.topologyClients) {
    return;
  }
  const runs = (appState.fleet?.runs ?? []).slice(0, 5);
  elements.topologyClients.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('div');
    empty.className = 'topo-client';
    const ring = document.createElement('div');
    ring.className = 'ring idle';
    ring.dataset.label = '—';
    const meta = document.createElement('div');
    meta.className = 'topo-client-meta';
    const name = document.createElement('span');
    name.className = 'topo-client-name';
    name.textContent = 'Waiting for clients';
    const stage = document.createElement('span');
    stage.className = 'topo-client-stage';
    stage.textContent = 'No PXE boot yet';
    meta.append(name, stage);
    empty.append(ring, meta);
    elements.topologyClients.append(empty);
    return;
  }
  for (const run of runs) {
    const node = document.createElement('div');
    node.className = 'topo-client';
    const pct = Math.max(0, Math.min(100, Math.round(run.latestPercent ?? 0)));
    const ring = document.createElement('div');
    ring.className = topologyRingClass(run);
    if (run.status !== 'completed' && run.status !== 'failed' && !pct) {
      ring.classList.add('idle');
      ring.dataset.label = '—';
    } else {
      ring.style.setProperty('--val', String(pct));
      ring.dataset.label = run.status === 'completed' ? '✓' : `${pct}%`;
    }
    if (run.status === 'failed') {
      ring.style.setProperty('--ring-color', 'var(--error)');
    }
    const meta = document.createElement('div');
    meta.className = 'topo-client-meta';
    const name = document.createElement('span');
    name.className = 'topo-client-name';
    name.textContent = text(run.clientId);
    const stage = document.createElement('span');
    stage.className = 'topo-client-stage';
    stage.textContent = text(run.latestStage, 'pending');
    meta.append(name, stage);
    node.append(ring, meta);
    elements.topologyClients.append(node);
  }
}

// ---- Aurora: Fleet view card grid (reuses fleet data) ----
function renderFleetCards(appState) {
  if (elements.fleetStatStrip) {
    const counts = appState.fleet?.counts ?? {};
    const stats = [
      [appState.fleet?.total ?? 0, 'Total', ''],
      [counts.running ?? 0, 'Deploying', ''],
      [counts.completed ?? 0, 'Ready', ''],
      [counts.failed ?? 0, 'Failed', 'fail'],
    ];
    elements.fleetStatStrip.replaceChildren();
    for (const [num, lbl, cls] of stats) {
      const stat = document.createElement('div');
      stat.className = `fleet-stat ${cls}`.trim();
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = String(num);
      const l = document.createElement('span');
      l.className = 'lbl';
      l.textContent = lbl;
      stat.append(n, l);
      elements.fleetStatStrip.append(stat);
    }
  }
  if (elements.fleetFilter) {
    for (const button of elements.fleetFilter.querySelectorAll('[data-fleet-filter]')) {
      button.classList.toggle('active', button.dataset.fleetFilter === state.fleetFilter);
    }
  }
  if (!elements.fleetCards) {
    return;
  }
  const allRuns = appState.fleet?.runs ?? [];
  const query = state.fleetSearch.trim().toLowerCase();
  const runs = allRuns.filter((run) => {
    if (state.fleetFilter === 'active' && !(run.status !== 'completed' && run.status !== 'failed')) return false;
    if (state.fleetFilter === 'done' && run.status !== 'completed') return false;
    if (state.fleetFilter === 'failed' && run.status !== 'failed') return false;
    if (query) {
      const hay = `${run.clientId ?? ''} ${run.runId ?? ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  elements.fleetCards.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('div');
    empty.className = 'fc-stage';
    empty.textContent = allRuns.length ? 'No clients match the current filter.' : 'No deployment clients have reported status yet.';
    elements.fleetCards.append(empty);
    renderFleetDetail(null);
    return;
  }
  if (!runs.some((run) => run.runId === state.selectedRunId)) {
    state.selectedRunId = runs[0].runId;
  }
  for (const run of runs) {
    const card = document.createElement('div');
    card.className = 'fleet-card';
    if (run.runId === state.selectedRunId) {
      card.classList.add('selected');
    }
    card.dataset.fleetSelect = run.runId;
    const head = document.createElement('div');
    head.className = 'fc-head';
    const nameWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'fc-name';
    name.textContent = text(run.clientId);
    const runId = document.createElement('div');
    runId.className = 'fc-run';
    runId.textContent = text(run.runId);
    nameWrap.append(name, runId);
    head.append(nameWrap, makeStatusPill(text(run.status), run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'fail' : 'working'));
    const ring = makeFleetRing(run);
    const stageLabel = document.createElement('div');
    stageLabel.className = 'fc-stage-label';
    stageLabel.textContent = 'Current Stage';
    const stage = document.createElement('div');
    stage.className = 'fc-stage';
    stage.textContent = text(run.latestStage, 'pending');
    card.append(head, ring, stageLabel, stage);
    elements.fleetCards.append(card);
  }
  renderFleetDetail(runs.find((run) => run.runId === state.selectedRunId) ?? runs[0]);
}

function makeFleetRing(run) {
  const pct = Math.max(0, Math.min(100, Math.round(run.latestPercent ?? 0)));
  const ring = document.createElement('div');
  ring.className = run.status === 'completed' ? 'ring done' : 'ring';
  if (run.status !== 'completed' && run.status !== 'failed' && !pct) {
    ring.classList.add('idle');
    ring.dataset.label = '—';
  } else {
    ring.style.setProperty('--val', String(pct));
    ring.dataset.label = run.status === 'completed' ? '✓' : `${pct}%`;
  }
  if (run.status === 'failed') {
    ring.style.setProperty('--ring-color', 'var(--error)');
  }
  return ring;
}

const FLEET_STAGE_FLOW = [
  ['winpe-start', 'winpe-start'],
  ['smb-mounted', 'smb-mounted'],
  ['osdcloud-start', 'osdcloud-start'],
  ['apply-image', 'apply-image'],
  ['rebooting', 'reboot'],
  ['windows-setupcomplete', 'windows-setupcomplete'],
  ['windows-desktop-ready', 'desktop-ready'],
];

function renderFleetDetail(run) {
  if (!elements.fleetDetail) {
    return;
  }
  elements.fleetDetail.replaceChildren();
  if (!run) {
    elements.fleetDetail.classList.add('empty');
    const empty = document.createElement('div');
    empty.className = 'fc-stage';
    empty.textContent = 'Select a client to see deployment detail.';
    elements.fleetDetail.append(empty);
    return;
  }
  elements.fleetDetail.classList.remove('empty');

  const head = document.createElement('div');
  head.className = 'fd-head';
  const title = document.createElement('div');
  title.className = 'fd-name';
  title.textContent = text(run.clientId);
  head.append(title, makeStatusPill(text(run.status), run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'fail' : 'working'));
  elements.fleetDetail.append(head);

  const meta = document.createElement('div');
  meta.className = 'fd-meta';
  meta.textContent = `${text(run.runId)}${run.clientIp ? ' · ' + run.clientIp : ''}`;
  elements.fleetDetail.append(meta);

  elements.fleetDetail.append(makeFleetRing(run));

  const flowTitle = document.createElement('div');
  flowTitle.className = 'fd-section-title';
  flowTitle.textContent = 'Execution Flow';
  elements.fleetDetail.append(flowTitle);

  const flow = document.createElement('div');
  flow.className = 'fd-flow';
  const reachedIndex = FLEET_STAGE_FLOW.findIndex(([key]) => key === run.latestStage);
  const isDone = run.status === 'completed';
  FLEET_STAGE_FLOW.forEach(([key, label], idx) => {
    const isReached = isDone || (reachedIndex >= 0 && idx < reachedIndex);
    const isCurrent = !isDone && reachedIndex === idx;
    const cls = isReached ? 'done' : isCurrent ? 'current' : 'pending';
    const row = document.createElement('div');
    row.className = `fd-flow-step ${cls}`;
    const dot = document.createElement('span');
    dot.className = 'fd-flow-dot';
    if (isReached) {
      dot.append(makeIcon('check'));
    }
    const name = document.createElement('span');
    name.className = 'fd-flow-name';
    name.textContent = label;
    row.append(dot, name);
    flow.append(row);
  });
  elements.fleetDetail.append(flow);

  const footer = document.createElement('div');
  footer.className = 'fd-footer';
  const evidence = document.createElement('button');
  evidence.type = 'button';
  evidence.className = 'bento-mini ghost';
  evidence.dataset.icon = 'fact_check';
  evidence.dataset.action = 'run-evidence';
  evidence.dataset.runAction = 'evidence';
  evidence.dataset.runId = run.runId;
  evidence.textContent = 'View evidence';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'bento-mini ghost danger-text';
  del.dataset.icon = 'delete';
  del.dataset.action = 'status-run-delete';
  del.dataset.runId = run.runId;
  del.textContent = 'Delete run';
  footer.append(evidence, del);
  elements.fleetDetail.append(footer);
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
    const softwareKey = (id) => `software:${id}`;
    const scriptKey = (id) => `script:${id}`;
    const keyParts = (key) => {
      const [type, ...rest] = String(key).split(':');
      return { type, id: rest.join(':') };
    };
    let selectedOrder = [];
    for (const entry of targetProfile?.installSequence ?? []) {
      if (entry.type === 'software' && softwareById.has(entry.id) && !selectedOrder.includes(softwareKey(entry.id))) {
        selectedOrder.push(softwareKey(entry.id));
      } else if (entry.type === 'script' && scriptsById.has(entry.id) && !selectedOrder.includes(scriptKey(entry.id))) {
        selectedOrder.push(scriptKey(entry.id));
      }
    }
    if (!selectedOrder.length) {
      selectedOrder = [
        ...(targetProfile?.softwareIds ?? [])
          .filter((id) => softwareById.has(id))
          .map((id) => softwareKey(id)),
      ];
    }
    const selectedScriptIds = () => selectedOrder
      .map((key) => keyParts(key))
      .filter((entry) => entry.type === 'script')
      .map((entry) => entry.id);
    const selectedSoftwareIds = () => selectedOrder
      .map((key) => keyParts(key))
      .filter((entry) => entry.type === 'software')
      .map((entry) => entry.id);
    let draggedSoftwareId = null;

    const renderScriptsEditor = () => {
      elements.profileScriptsList.replaceChildren();
      const row = document.createElement('div');
      row.className = 'readonly-item software-order-empty';
      row.textContent = scripts.length
        ? 'Custom scripts are added and ordered in the unified install sequence above.'
        : 'No custom scripts in catalog. Add one from Custom Scripts.';
      elements.profileScriptsList.append(row);
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

    const renderScriptIdentity = (container, item) => {
      const name = document.createElement('strong');
      name.textContent = item?.name ?? item?.id ?? '';
      const id = document.createElement('span');
      id.className = 'software-order-id';
      id.textContent = `script:${item?.id ?? ''}`;
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
      const selectedSoftwareSet = new Set(selectedSoftwareIds());
      const selectedScriptSet = new Set(selectedScriptIds());

      const selectedSection = document.createElement('section');
      selectedSection.className = 'software-order-section';
      const selectedTitle = document.createElement('div');
      selectedTitle.className = 'field-label';
      selectedTitle.textContent = 'Selected install sequence';
      const selectedList = document.createElement('div');
      selectedList.className = 'software-order-list selected';

      if (!selectedOrder.length) {
        appendEmptyRow(selectedList, 'No software or custom scripts selected.');
      } else {
        selectedOrder.forEach((key, index) => {
          const { type, id } = keyParts(key);
          const item = type === 'script' ? scriptsById.get(id) : softwareById.get(id);
          const row = document.createElement('div');
          row.className = 'software-order-row';
          row.dataset.selected = 'true';
          row.dataset.softwareId = key;
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
          if (type === 'script') {
            renderScriptIdentity(label, item);
          } else {
            renderSoftwareIdentity(label, item);
          }

          const actions = document.createElement('span');
          actions.className = 'software-order-actions';
          actions.append(
            iconButton('keyboard_arrow_up', 'Move up', 'up', key, index === 0),
            iconButton('keyboard_arrow_down', 'Move down', 'down', key, index === selectedOrder.length - 1),
            iconButton('remove', 'Remove', 'remove', key),
          );

          row.append(handle, rank, label);
          row.append(actions);
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
      const available = software.filter((item) => !selectedSoftwareSet.has(item.id));
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
          add.dataset.softwareId = softwareKey(item.id);
          row.append(label, add);
          availableList.append(row);
        });
      }
      availableSection.append(availableTitle, availableList);

      const availableScriptsSection = document.createElement('section');
      availableScriptsSection.className = 'software-order-section';
      const availableScriptsTitle = document.createElement('div');
      availableScriptsTitle.className = 'field-label';
      availableScriptsTitle.textContent = 'Available custom scripts';
      const availableScriptsList = document.createElement('div');
      availableScriptsList.className = 'software-order-list available';
      const availableScripts = scripts.filter((item) => !selectedScriptSet.has(item.id));
      if (!availableScripts.length) {
        appendEmptyRow(availableScriptsList, scripts.length ? 'All custom scripts are selected.' : 'No custom scripts in catalog.');
      } else {
        availableScripts.forEach((item) => {
          const row = document.createElement('div');
          row.className = 'software-order-row';
          row.dataset.softwareId = scriptKey(item.id);
          const label = document.createElement('span');
          label.className = 'software-order-name';
          renderScriptIdentity(label, item);
          const add = document.createElement('button');
          add.type = 'button';
          add.textContent = 'Add';
          add.dataset.icon = 'add';
          add.dataset.softwareOrderAction = 'add';
          add.dataset.softwareId = scriptKey(item.id);
          row.append(label, add);
          availableScriptsList.append(row);
        });
      }
      availableScriptsSection.append(availableScriptsTitle, availableScriptsList);
      elements.softwareList.append(selectedSection, availableSection, availableScriptsSection);
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
      const installSequence = selectedOrder.map((key) => {
        const { type, id } = keyParts(key);
        return { type, id };
      });
      done({
        profileId: targetProfile?.id ?? '',
        isActive: isActiveTarget,
        name,
        description: elements.softwareProfileDescription.value.trim(),
        softwareIds: selectedSoftwareIds(),
        installSequence,
        osImageId,
      });
    };
    const selectAll = () => {
      const selectedSet = new Set(selectedOrder);
      selectedOrder = [
        ...selectedOrder,
        ...software.map((item) => softwareKey(item.id)).filter((key) => !selectedSet.has(key)),
        ...scripts.map((item) => scriptKey(item.id)).filter((key) => !selectedSet.has(key)),
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
      const { type, id: itemId } = keyParts(id);
      if (action === 'add' && !selectedOrder.includes(id)
        && ((type === 'software' && softwareById.has(itemId)) || (type === 'script' && scriptsById.has(itemId)))) {
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
    message: 'This will stop services, persist config, sync repo-sourced endpoint files into the live runtime, commit WinPE changes, and rerun preflight.',
    details: [`Target: ${choice.interfaceAlias} ${choice.ipAddress}/${choice.prefixLength}`],
    confirmLabel: 'Sync endpoint',
    severity: 'warning',
  });
  if (!ok) {
    return;
  }
  const returnToInitialization = state.endpointSyncReturnToInitialization;
  state.pendingInterface = choice;
  closeDialog(elements.endpointSettingsDialog);
  if (returnToInitialization) {
    state.initializationPendingAction = 'endpoint-sync';
    state.initializationOperationAction = 'endpoint-sync';
    openDialog(elements.initializationDialog);
    render();
  }
  try {
    await mutate('/api/endpoint', choice, { alertOnError: !returnToInitialization });
  } finally {
    if (returnToInitialization) {
      state.endpointSyncReturnToInitialization = false;
      state.initializationPendingAction = null;
      openDialog(elements.initializationDialog);
      render();
    }
  }
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

async function saveInitializationSecrets() {
  const controls = initializationSecretsControls();
  const windowsUsername = controls.windowsUsername?.value ?? '';
  const windowsPassword = controls.windowsPassword?.value ?? '';
  if (!windowsUsername.trim() || !windowsPassword.trim()) {
    if (controls.status) {
      controls.status.textContent = 'Enter both Windows credentials before saving.';
    }
    return;
  }
  if (RESERVED_WINDOWS_USERNAMES.has(windowsUsername.trim().toLowerCase())) {
    if (controls.status) {
      controls.status.textContent = `"${windowsUsername.trim()}" is a reserved Windows account name. Choose a different account name (the built-in Administrator account is disabled during deployment).`;
    }
    return;
  }
  if (state.busy) {
    return;
  }
  state.busy = true;
  setControlsDisabled(true);
  try {
    const payload = await api('/api/secrets', {
      method: 'POST',
      body: JSON.stringify({ windowsUsername, windowsPassword }),
    });
    state.current = payload.state;
    state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
    state.initializationSecretsEditing = false;
    clearInitializationSecretsDraft();
    if (controls.windowsUsername) controls.windowsUsername.value = DEFAULT_WINDOWS_USERNAME;
    if (controls.windowsPassword) controls.windowsPassword.value = '';
    render();
  } catch (error) {
    if (controls.status) {
      controls.status.textContent = error.message;
    }
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

async function saveInitializationProjectRoot() {
  const input = elements.initializationDialog?.querySelector('#init-project-root');
  const runtimeRoot = String(input?.value ?? state.initializationRootDraft ?? '').trim();
  if (!runtimeRoot) {
    input?.focus();
    return;
  }
  if (state.busy) {
    return;
  }
  state.busy = true;
  setControlsDisabled(true);
  try {
    const payload = await api('/api/project-root', {
      method: 'POST',
      body: JSON.stringify({ runtimeRoot }),
    });
    state.current = payload.state;
    state.selectedRunId = payload.state?.selectedRunId ?? state.selectedRunId;
    state.initializationRootDraft = payload.state?.config?.workspace?.runtimeRoot ?? runtimeRoot;
    render();
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

function confirmPrepareRuntime(runtime) {
  return confirmAction({
    title: 'Prepare runtime',
    message: 'This downloads or rebuilds missing runtime artifacts on the host. Deployment services remain stopped.',
    details: [
      `${runtime?.missingCount ?? 'Unknown'} artifact group(s) need preparation.`,
      'After this completes, sync endpoint and run preflight from the Web console.',
    ],
    confirmLabel: 'Prepare runtime',
    severity: 'warning',
  });
}

async function handleInitializationLongAction(action) {
  const runtime = state.current?.runtime;
  if (action === 'prepare-runtime' && runtime?.ready) {
    return;
  }
  closeDialog(elements.initializationDialog);
  if (action === 'prepare-runtime') {
    const ok = await confirmPrepareRuntime(runtime);
    if (!ok) {
      openDialog(elements.initializationDialog);
      render();
      return;
    }
  }

  state.initializationPendingAction = action;
  state.initializationOperationAction = action;
  openDialog(elements.initializationDialog);
  render();
  try {
    if (action === 'prepare-runtime') {
      await mutate('/api/runtime/prepare', null, { alertOnError: false });
    } else if (action === 'preflight') {
      await mutate('/api/preflight', null, { alertOnError: false });
    }
    await refresh();
  } finally {
    state.initializationPendingAction = null;
    openDialog(elements.initializationDialog);
    render();
  }
}

async function handleInitializationAction(action, source = null) {
  const resolvedAction = action === 'next'
    ? (source?.dataset?.nextAction ?? state.current?.initialization?.nextStepId)
    : action;
  if (resolvedAction === 'save-secrets') {
    await saveInitializationSecrets();
    return;
  }
  if (resolvedAction === 'edit-secrets') {
    state.initializationSecretsEditing = true;
    state.initializationSecretsDraft.windowsUsername = state.current?.initialization?.secrets?.windowsUsername
      ?? DEFAULT_WINDOWS_USERNAME;
    state.initializationSecretsDraft.windowsPassword = '';
    render();
    initializationSecretsControls().windowsPassword?.focus();
    return;
  }
  if (resolvedAction === 'cancel-secrets') {
    state.initializationSecretsEditing = false;
    clearInitializationSecretsDraft();
    render();
    return;
  }
  if (resolvedAction === 'save-project-root') {
    await saveInitializationProjectRoot();
    return;
  }
  if (resolvedAction === 'project-root') {
    openDialog(elements.initializationDialog);
    elements.initializationDialog?.querySelector('#init-project-root')?.focus();
    return;
  }
  if (resolvedAction === 'secrets') {
    if (state.current?.initialization?.secrets?.ready) {
      return;
    }
    openDialog(elements.initializationDialog);
    initializationSecretsControls().windowsPassword?.focus();
    return;
  }
  if (resolvedAction === 'dashboard') {
    switchToView('dashboard');
    return;
  }
  if (!resolvedAction || resolvedAction === 'setup') {
    return;
  }
  if (resolvedAction === 'prepare-runtime' || resolvedAction === 'preflight') {
    await handleInitializationLongAction(resolvedAction);
    return;
  }
  closeDialog(elements.initializationDialog);
  if (resolvedAction === 'interfaces') {
    state.endpointSyncReturnToInitialization = true;
  }
  await handleAction(resolvedAction, source);
}

async function handleAction(action, source = null) {
  const services = state.current?.services ?? {};
  if (action === 'run-evidence') {
    const runId = source?.dataset?.runId ?? source?.closest?.('[data-run-id]')?.dataset?.runId;
    showValidationEvidence(runId);
  } else if (action === 'initialization') {
    openDialog(elements.initializationDialog);
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
  } else if (action === 'prepare-runtime') {
    const runtime = state.current?.runtime;
    if (runtime?.ready) {
      return;
    }
    const ok = await confirmPrepareRuntime(runtime);
    if (ok) {
      await mutate('/api/runtime/prepare');
    }
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
      const scriptDetail = profileUpdate.installSequence?.some((entry) => entry.type === 'script')
        ? profileUpdate.installSequence
          .filter((entry) => entry.type === 'script')
          .map((entry) => entry.id)
          .join(', ')
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
  const fleetFilterButton = target.closest('[data-fleet-filter]');
  if (fleetFilterButton) {
    state.fleetFilter = fleetFilterButton.dataset.fleetFilter;
    render();
    return;
  }

  if (openValidationEvidenceFromTarget(target)) {
    event.preventDefault();
    return;
  }

  const fleetCardSelect = target.closest('[data-fleet-select]');
  if (fleetCardSelect) {
    state.selectedRunId = fleetCardSelect.dataset.fleetSelect;
    render();
    return;
  }

  const operationButton = target.closest('[data-operation-action]');
  if (operationButton) {
    event.preventDefault();
    if (operationButton.dataset.operationAction === 'copy-log') {
      copyInitializationOperationLog(operationButton).catch((error) => window.alert(error.message));
    }
    return;
  }

  const initButton = target.closest('[data-init-action]');
  if (initButton) {
    event.preventDefault();
    handleInitializationAction(initButton.dataset.initAction, initButton).catch((error) => window.alert(error.message));
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

elements.endpointSettingsDialog?.addEventListener('close', () => {
  if (!state.initializationPendingAction) {
    state.endpointSyncReturnToInitialization = false;
  }
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

// Header view switcher tabs
if (elements.tabGuided && elements.tabDashboard) {
  elements.tabGuided.addEventListener('click', () => switchToView('guided'));
  elements.tabDashboard.addEventListener('click', () => switchToView('dashboard'));
  if (elements.tabFleet) {
    elements.tabFleet.addEventListener('click', () => switchToView('fleet'));
  }
  if (elements.navServices) {
    elements.navServices.addEventListener('click', () => {
      switchToView('dashboard');
      document.querySelector('#services-grid')?.closest('.bento-card, section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  if (elements.navLogs) {
    elements.navLogs.addEventListener('click', () => {
      switchToView('dashboard');
      document.querySelector('#logs')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  if (elements.fleetSearch) {
    elements.fleetSearch.addEventListener('input', () => {
      state.fleetSearch = elements.fleetSearch.value;
      renderFleetCards(state.current ?? {});
    });
  }
}

// Stepper items click handler
if (elements.initializationSteps) {
  elements.initializationSteps.addEventListener('click', (event) => {
    const stepEl = event.target.closest('.initialization-step');
    if (stepEl && stepEl.dataset.stepId) {
      state.selectedGuidedStepId = stepEl.dataset.stepId;
      render();
    }
  });
}

refresh().catch((error) => window.alert(error.message));
setInterval(() => {
  refresh().catch(() => {});
}, 2500);
