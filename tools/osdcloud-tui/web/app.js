const state = {
  current: null,
  selectedRunId: null,
  busy: false,
};

const elements = {
  endpointLine: document.querySelector('#endpoint-line'),
  appVersion: document.querySelector('#app-version'),
  operationBadge: document.querySelector('#operation-badge'),
  refreshButton: document.querySelector('#refresh-button'),
  updatedAt: document.querySelector('#updated-at'),
  servicesGrid: document.querySelector('#services-grid'),
  endpointDetails: document.querySelector('#endpoint-details'),
  clientsBody: document.querySelector('#clients-body'),
  fleetCounts: document.querySelector('#fleet-counts'),
  clientDetail: document.querySelector('#client-detail'),
  preflightList: document.querySelector('#preflight-list'),
  validationList: document.querySelector('#validation-list'),
  logs: document.querySelector('#logs'),
  pickerDialog: document.querySelector('#picker-dialog'),
  pickerTitle: document.querySelector('#picker-title'),
  pickerList: document.querySelector('#picker-list'),
  profileDialog: document.querySelector('#profile-dialog'),
  profileForm: document.querySelector('#profile-form'),
  profileName: document.querySelector('#profile-name'),
  profileCancel: document.querySelector('#profile-cancel'),
  profileError: document.querySelector('#profile-error'),
  softwareDialog: document.querySelector('#software-dialog'),
  softwareForm: document.querySelector('#software-form'),
  softwareCancel: document.querySelector('#software-cancel'),
  softwareProfileSummary: document.querySelector('#software-profile-summary'),
  softwareProfileName: document.querySelector('#software-profile-name'),
  softwareSelectAll: document.querySelector('#software-select-all'),
  softwareSelectNone: document.querySelector('#software-select-none'),
  softwareList: document.querySelector('#software-list'),
  softwareError: document.querySelector('#software-error'),
};

function text(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function elapsed(seconds) {
  if (!Number.isFinite(seconds)) {
    return '';
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
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  render();
}

async function mutate(path, body = null) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  setButtonsDisabled(true);
  try {
    const payload = await api(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : '',
    });
    state.current = payload.state;
    render();
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.busy = false;
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
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

function renderServices(appState) {
  const rows = [
    ['HTTP', appState.services.http, `${appState.services.http.host}:${appState.services.http.port}`],
    ['TFTP', appState.services.tftp, `${appState.services.tftp.listenIp}:${appState.services.tftp.port}`],
    ['DHCP', appState.services.dhcp, `${appState.services.dhcp.listenIp}:${appState.services.dhcp.listenPort}`],
  ];
  elements.servicesGrid.replaceChildren();
  for (const [name, service, detail] of rows) {
    const row = document.createElement('div');
    row.className = 'service-row';
    const stateLabel = document.createElement('div');
    stateLabel.className = `state ${service.running ? 'running' : 'stopped'}`;
    stateLabel.textContent = service.running ? 'running' : 'stopped';
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    const breakLine = document.createElement('br');
    const detailText = document.createTextNode(detail);
    body.append(title, breakLine, detailText);
    row.append(stateLabel, body);
    elements.servicesGrid.append(row);
  }

  const profile = appState.profile?.error
    ? `invalid: ${appState.profile.error}`
    : `${appState.profile?.activeProfile?.name ?? ''} (${appState.profile?.activeProfile?.id ?? ''})`;
  setDefinitionList(elements.endpointDetails, [
    ['Service NIC', appState.config.adapter.interfaceAlias],
    ['Service IP', `${appState.config.adapter.serverIp}/${appState.config.adapter.prefixLength}`],
    ['DHCP pool', `${appState.config.dhcp.leaseStartIp}-${appState.config.dhcp.leaseEndIp}`],
    ['DHCP router', appState.config.dhcp.router],
    ['SMB share', appState.config.smb.share],
    ['Profile', profile],
    ['Software', appState.profile?.selectedSoftwareText ?? ''],
  ]);
  elements.endpointLine.textContent = `${appState.config.adapter.interfaceAlias} ${appState.config.adapter.serverIp}/${appState.config.adapter.prefixLength}`;
}

function renderClients(appState) {
  const counts = appState.fleet.counts ?? {};
  elements.fleetCounts.textContent = `total=${appState.fleet.total ?? 0} running=${counts.running ?? 0} completed=${counts.completed ?? 0} failed=${counts.failed ?? 0}`;
  elements.clientsBody.replaceChildren();
  for (const run of appState.fleet.runs ?? []) {
    const tr = document.createElement('tr');
    if (run.runId === appState.selectedRunId) {
      tr.classList.add('selected');
    }
    tr.addEventListener('click', () => {
      state.selectedRunId = run.runId;
      refresh().catch((error) => window.alert(error.message));
    });
    for (const value of [
      run.status,
      run.clientId,
      run.runId,
      run.latestStage,
      Number.isFinite(run.latestPercent) ? `${run.latestPercent}%` : '',
      localTime(run.lastReceivedAt),
      elapsed(run.elapsedSeconds),
    ]) {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    }
    elements.clientsBody.append(tr);
  }
  if (!appState.fleet.runs?.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.textContent = 'No deployment clients yet.';
    tr.append(td);
    elements.clientsBody.append(tr);
  }
}

function renderClientDetail(appState) {
  const run = appState.selectedRun;
  if (!run) {
    setDefinitionList(elements.clientDetail, [['Status', 'No client selected']]);
    return;
  }
  setDefinitionList(elements.clientDetail, [
    ['Status', run.status],
    ['Run', run.runId],
    ['Client', run.clientId],
    ['Stage', run.latestStage],
    ['Percent', Number.isFinite(run.latestPercent) ? `${run.latestPercent}%` : ''],
    ['Started', run.startedAt],
    ['WinPE End', run.winpeEndedAt],
    ['Windows', run.windowsStartedAt],
    ['Finished', run.completedAt ?? run.failedAt],
    ['Seen', run.lastReceivedAt],
    ['Message', run.staleReason ? `${run.staleReason}; ${run.latestMessage ?? ''}` : run.latestMessage],
    ['Latest Shot', appState.selectedScreenshot?.filePath ?? ''],
  ]);
}

function renderChecks(element, checks) {
  element.replaceChildren();
  if (!checks?.length) {
    const empty = document.createElement('div');
    empty.className = 'check-row';
    empty.textContent = 'No data yet.';
    element.append(empty);
    return;
  }
  for (const check of checks) {
    const row = document.createElement('div');
    row.className = `check-row ${check.ok ? 'ok' : 'fail'}`;
    const name = document.createElement('strong');
    name.textContent = `${check.ok ? 'PASS' : 'FAIL'} ${check.name}`;
    const detail = document.createElement('span');
    detail.textContent = check.detail ?? '';
    row.append(name, detail);
    element.append(row);
  }
}

function renderOperation(appState) {
  const operation = appState.operation;
  elements.operationBadge.className = 'badge';
  if (!operation) {
    elements.operationBadge.textContent = 'Idle';
    return;
  }
  elements.operationBadge.textContent = operation.running ? operation.label : `${operation.status}: ${operation.label}`;
  if (operation.running) {
    elements.operationBadge.classList.add('running');
  } else if (operation.status === 'failed') {
    elements.operationBadge.classList.add('failed');
  }
}

function render() {
  const appState = state.current;
  if (!appState) {
    return;
  }
  elements.appVersion.textContent = appState.app?.version ? `v${appState.app.version}` : '';
  elements.updatedAt.textContent = localTime(appState.generatedAt);
  renderOperation(appState);
  renderServices(appState);
  renderClients(appState);
  renderClientDetail(appState);
  renderChecks(elements.preflightList, appState.preflight);
  renderChecks(elements.validationList, appState.validation);
  elements.logs.textContent = (appState.logs ?? []).join('\n');
}

function confirmAction(message) {
  return window.confirm(message);
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
    button.addEventListener('click', () => {
      elements.pickerDialog.close();
      onPick(row.value);
    });
    item.append(body, button);
    elements.pickerList.append(item);
  }
  elements.pickerDialog.showModal();
}

function validateProfileInput(name) {
  if (!name) {
    return 'Name is required.';
  }
  return '';
}

function showAddProfileDialog() {
  return new Promise((resolve) => {
    elements.profileForm.reset();
    elements.profileError.textContent = '';

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      elements.profileForm.removeEventListener('submit', submit);
      elements.profileCancel.removeEventListener('click', cancel);
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
      done({ name });
    };

    elements.profileForm.addEventListener('submit', submit);
    elements.profileCancel.addEventListener('click', cancel);
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
    elements.softwareProfileSummary.textContent = activeProfile ? `Profile ID: ${activeProfile.id}` : '';
    elements.softwareProfileName.value = activeProfile?.name ?? '';
    elements.softwareList.replaceChildren();

    for (const item of software) {
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.checked = selectedIds.has(item.id);
      const span = document.createElement('span');
      span.textContent = `${item.id} - ${item.name ?? item.id}`;
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
        softwareIds: software.map((item) => item.id).filter((id) => checked.has(id)),
      });
    };
    const selectAll = () => setSoftwareCheckboxes(true);
    const selectNone = () => setSoftwareCheckboxes(false);

    elements.softwareForm.addEventListener('submit', submit);
    elements.softwareCancel.addEventListener('click', cancel);
    elements.softwareDialog.addEventListener('cancel', cancel);
    elements.softwareSelectAll.addEventListener('click', selectAll);
    elements.softwareSelectNone.addEventListener('click', selectNone);
    elements.softwareDialog.showModal();
    elements.softwareList.querySelector('input')?.focus();
  });
}

async function handleAction(action) {
  const services = state.current?.services ?? {};
  if (action === 'preflight') {
    await mutate('/api/preflight');
  } else if (action === 'interfaces') {
    const payload = await api('/api/interfaces');
    await showPicker('Select service interface', payload.interfaces.map((item) => ({
      title: `${item.interfaceAlias} ${item.ipAddress}/${item.prefixLength}`,
      detail: `${item.interfaceDescription || item.macAddress || ''} gateway=${item.gateway || '-'}`,
      value: item,
    })), (item) => {
      if (confirmAction('This will stop services, update endpoint files, commit WinPE changes, and refresh osdcloud-assets. Continue?')) {
        mutate('/api/endpoint', item);
      }
    });
  } else if (action === 'profiles') {
    const payload = await api('/api/profiles');
    await showPicker('Select deployment profile', payload.profile.profiles.map((profile) => ({
      title: `${profile.name} (${profile.id})`,
      detail: profile.softwareIds.length ? profile.softwareIds.join(', ') : 'no client software',
      value: profile.id,
    })), (profileId) => {
      if (confirmAction('This will stop services and replace the live Apps payload. Continue?')) {
        mutate('/api/profile', { profileId });
      }
    });
  } else if (action === 'profile-add') {
    const input = await showAddProfileDialog();
    if (input) {
      await mutate('/api/profiles/create', input);
    }
  } else if (action === 'profile-edit') {
    const payload = await api('/api/profiles');
    const profileUpdate = await showSoftwareDialog(payload.profile);
    if (profileUpdate) {
      if (confirmAction('This will stop services, update the active profile, replace the live Apps payload, and run preflight. Continue?')) {
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
      value: profile.id,
    })), (profileId) => {
      const selected = candidates.find((profile) => profile.id === profileId);
      if (confirmAction(`Delete deployment profile ${selected?.name ?? profileId} (${profileId})?`)) {
        mutate('/api/profiles/delete', { profileId });
      }
    }, 'Delete');
  } else if (action === 'http-toggle') {
    await mutate(`/api/services/http/${services.http?.running ? 'stop' : 'start'}`);
  } else if (action === 'tftp-toggle') {
    await mutate(`/api/services/tftp/${services.tftp?.running ? 'stop' : 'start'}`);
  } else if (action === 'dhcp-toggle') {
    const verb = services.dhcp?.running ? 'stop' : 'start';
    if (verb === 'stop' || confirmAction('Confirm the real LAN DHCP server is disabled before starting DHCP. Continue?')) {
      await mutate(`/api/services/dhcp/${verb}`);
    }
  } else if (action === 'start-all') {
    if (confirmAction('Confirm the real LAN DHCP server is disabled before starting HTTP, TFTP, and DHCP. Continue?')) {
      await mutate('/api/services/start-all');
    }
  } else if (action === 'stop-all') {
    await mutate('/api/services/stop-all');
  } else if (action === 'clear-status') {
    if (confirmAction('This will delete live status files under the configured status root. Continue?')) {
      await mutate('/api/status/clear');
    }
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }
  handleAction(button.dataset.action).catch((error) => window.alert(error.message));
});

elements.refreshButton.addEventListener('click', () => {
  refresh().catch((error) => window.alert(error.message));
});

refresh().catch((error) => window.alert(error.message));
setInterval(() => {
  refresh().catch(() => {});
}, 2500);
