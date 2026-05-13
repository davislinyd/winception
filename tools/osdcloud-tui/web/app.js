const state = {
  current: null,
  view: 'dashboard',
  selectedRunId: null,
  pendingInterface: null,
  interfaces: [],
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  endpointLine: $('#endpoint-line'),
  appVersion: $('#app-version'),
  operationBadge: $('#operation-badge'),
  refreshButton: $('#refresh-button'),
  updatedAt: $('#updated-at'),
  endpointSummary: $('#endpoint-summary'),
  servicesGrid: $('#services-grid'),
  activeProfileDetails: $('#active-profile-details'),
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

function text(value, fallback = '-') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function percent(value) {
  return Number.isFinite(value) ? `${value}%` : '-';
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

function localTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  const payload = await api('/api/interfaces');
  state.interfaces = payload.interfaces ?? [];
  render();
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
  } catch (error) {
    window.alert(error.message);
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

function switchView(view) {
  state.view = view;
  $$('.view').forEach((element) => element.classList.toggle('active', element.id === `view-${view}`));
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  render();
  if (view === 'endpoints' && state.interfaces.length === 0) {
    loadInterfaces().catch((error) => window.alert(error.message));
  }
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
    ['http', 'HTTP Server', appState.services.http],
    ['upload_file', 'TFTP Server', appState.services.tftp],
    ['router', 'DHCP Server', appState.services.dhcp],
  ];
  elements.servicesGrid.replaceChildren();
  for (const [iconName, name, service] of rows) {
    const row = document.createElement('div');
    row.className = 'service-card service-row';
    const head = document.createElement('div');
    head.className = 'service-row-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'service-title';
    titleWrap.append(makeIcon(iconName, 'service-icon'));
    const title = document.createElement('strong');
    title.textContent = name;
    titleWrap.append(title);
    head.append(titleWrap, makeStatusPill(service.running ? 'Running' : 'Stopped', service.running ? 'ok' : 'fail'));
    const address = document.createElement('code');
    address.className = 'service-address';
    address.textContent = serviceAddress(service);
    const switchVisual = document.createElement('div');
    switchVisual.className = `service-switch${service.running ? ' running' : ''}`;
    row.append(head, address, switchVisual);
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

function setActionLabel(action, label) {
  $$(`[data-action="${action}"]`).forEach((button) => {
    button.textContent = label;
  });
}

function setActionIcon(action, icon) {
  $$(`[data-action="${action}"]`).forEach((button) => {
    button.dataset.icon = icon;
  });
}

function setActionRunning(action, running) {
  $$(`[data-action="${action}"]`).forEach((button) => {
    button.classList.toggle('is-running', running);
    button.dataset.running = running ? 'true' : 'false';
  });
}

function setActionDanger(action, danger) {
  $$(`[data-action="${action}"]`).forEach((button) => {
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

function renderClients(appState) {
  const counts = appState.fleet?.counts ?? {};
  elements.fleetCounts.textContent = `total=${appState.fleet?.total ?? 0} running=${counts.running ?? 0} completed=${counts.completed ?? 0} failed=${counts.failed ?? 0}`;
  elements.clientsBody.replaceChildren();
  const runs = appState.fleet?.runs ?? [];
  for (const run of runs) {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    if (run.runId === appState.selectedRunId) {
      tr.classList.add('selected');
    }
    tr.addEventListener('click', () => {
      state.selectedRunId = run.runId;
      switchView('validation');
      refresh().catch((error) => window.alert(error.message));
    });

    const statusCell = document.createElement('td');
    statusCell.append(makeStatusPill(text(run.status), run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'fail' : 'working'));
    tr.append(statusCell);
    for (const value of [
      run.clientId,
      run.runId,
      run.latestStage,
      percent(run.latestPercent),
      localTime(run.lastReceivedAt),
      elapsed(run.elapsedSeconds),
    ]) {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    }
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
  for (const check of checks) {
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

function renderInterfaces(appState) {
  elements.interfacesBody.replaceChildren();
  elements.pendingInterfaceLabel.textContent = state.pendingInterface
    ? `Selected: ${state.pendingInterface.interfaceAlias} ${state.pendingInterface.ipAddress}/${state.pendingInterface.prefixLength}`
    : 'No pending endpoint target';
  if (!state.interfaces.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No interface data loaded. Use Refresh endpoints.';
    tr.append(td);
    elements.interfacesBody.append(tr);
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
    const sync = document.createElement('button');
    sync.type = 'button';
    sync.textContent = 'Sync';
    sync.dataset.icon = 'sync';
    sync.dataset.interfaceAction = 'sync';
    sync.dataset.interfaceIndex = String(index);
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
    /apps|payload|profile|smb/i.test(check.name ?? '') || /apps|payload|profile|smb/i.test(check.detail ?? '')
  ));
}

function renderPayload(appState) {
  const active = appState.profile?.activeProfile;
  setDefinitionList(elements.payloadSummary, [
    ['Active profile', active ? `${active.id} / ${active.name}` : '-'],
    ['Software', appState.profile?.selectedSoftwareText || 'none'],
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
  renderPreflightSummary(appState.preflight);
  renderClients(appState);
  renderInterfaces(appState);
  renderProfiles(appState);
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

function confirmAction({ title, message, details = [], confirmLabel = 'Continue', danger = false }) {
  return new Promise((resolve) => {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmSubmit.textContent = confirmLabel;
    elements.confirmSubmit.classList.toggle('danger', danger);
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
    danger: true,
  });
  if (!ok) {
    return;
  }
  state.pendingInterface = choice;
  switchView('sync');
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
    danger: true,
  });
  if (ok) {
    await mutate('/api/profile', { profileId: profile.id });
  }
}

async function handleAction(action) {
  const services = state.current?.services ?? {};
  if (action === 'preflight') {
    await mutate('/api/preflight');
  } else if (action === 'interfaces') {
    switchView('endpoints');
    await loadInterfaces();
  } else if (action === 'reload-endpoints') {
    await Promise.all([refresh(), loadInterfaces()]);
  } else if (action === 'endpoint-sync') {
    if (state.interfaces.length === 0) {
      await loadInterfaces();
    }
    const choice = state.pendingInterface ?? currentInterfaceChoice();
    if (!choice) {
      window.alert('Select a service interface before syncing the endpoint.');
      switchView('endpoints');
      return;
    }
    await confirmEndpointSync(choice);
  } else if (action === 'profiles') {
    switchView('endpoints');
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
        danger: true,
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
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    switchView(viewButton.dataset.view);
    return;
  }

  const interfaceButton = event.target.closest('[data-interface-action]');
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

  const profileButton = event.target.closest('[data-profile-action]');
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

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    handleAction(actionButton.dataset.action).catch((error) => window.alert(error.message));
  }
});

elements.refreshButton.addEventListener('click', () => {
  refresh().catch((error) => window.alert(error.message));
});

refresh().catch((error) => window.alert(error.message));
setInterval(() => {
  refresh().catch(() => {});
}, 2500);
