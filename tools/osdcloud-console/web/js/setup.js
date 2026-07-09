import { handleAction, switchToView } from './actions.js';
import { api, mutate, refresh } from './api.js';
import { isScrolledToBottom } from './deploy.js';
import { closeDialog, confirmAction, openDialog } from './dialogs.js';
import { $, elements } from './dom.js';
import { text } from './format.js';
import { render } from './render.js';
import { DEFAULT_WINDOWS_USERNAME, RESERVED_WINDOWS_USERNAMES, state } from './state.js';
import { makeIcon, setControlsDisabled, setSetupRailCollapsed } from './ui.js';

export function initializationActionLabel(action) {
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

export function initializationActionIcon(action) {
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

export function initializationDetailStatusLabel(statusClass) {
  if (statusClass === 'blocked') {
    return 'MISSING';
  }
  if (statusClass === 'blocked-by-dependency') {
    return 'BLOCKED';
  }
  return statusClass ? statusClass.replace(/-/gu, ' ').toUpperCase() : '';
}

export function appendInitializationDetailItems(body, stepId, detailItems = []) {
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
    const sub = document.createElement('span');
    sub.className = 'initialization-detail-sub';
    sub.append(meta, detail);
    row.append(status, title, sub);
    list.append(row);
  }
  body.append(list);
  return list;
}

export function appendGuidedStepOverview(body, step) {
  const items = [
    ['Objective', step.objective],
    ['Done when', step.doneWhen],
    ['Safety note', step.safetyNote],
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

export function appendGuidedDiagnosticsAction(body, trigger = 'guided-setup-failure') {
  const actions = document.createElement('div');
  actions.className = 'flex justify-start mt-md';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'warning';
  button.dataset.action = 'diagnostics-run';
  button.dataset.diagnosticsScope = 'host';
  button.dataset.diagnosticsTrigger = trigger;
  button.dataset.icon = 'health_metrics';
  button.textContent = 'Run diagnostics';
  actions.append(button);
  body.append(actions);
}

export function captureInitializationDetailScrollPositions() {
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

export function restoreInitializationDetailScrollPosition(stepId, list) {
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

export function initializationDialogBody() {
  return elements.initializationDialog?.querySelector('.guided-v3-main') ?? null;
}

export function captureInitializationDialogScrollPosition() {
  const body = initializationDialogBody();
  if (!body) {
    return null;
  }
  return {
    atBottom: isScrolledToBottom(body),
    scrollTop: body.scrollTop,
  };
}

export function restoreInitializationDialogScrollPosition(position) {
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

export function initializationSecretsControls() {
  return {
    status: elements.initializationDialog?.querySelector('.initialization-secrets-status') ?? null,
    windowsUsername: elements.initializationDialog?.querySelector('#init-windows-username') ?? null,
    windowsPassword: elements.initializationDialog?.querySelector('#init-windows-password') ?? null,
  };
}

export function captureInitializationSecretsDraft() {
  const controls = initializationSecretsControls();
  state.initializationSecretsDraft.windowsUsername = controls.windowsUsername?.value ?? state.initializationSecretsDraft.windowsUsername;
  state.initializationSecretsDraft.windowsPassword = controls.windowsPassword?.value ?? state.initializationSecretsDraft.windowsPassword;
}

export function clearInitializationSecretsDraft() {
  state.initializationSecretsDraft.windowsUsername = DEFAULT_WINDOWS_USERNAME;
  state.initializationSecretsDraft.windowsPassword = '';
}

export function focusedInitializationTextControl() {
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

export function restoreInitializationTextControlFocus(focusedControl) {
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

export function createInitializationSecretField(id, name, labelText, type = 'password') {
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

export function appendInitializationSecretsForm(body) {
  const editing = state.initializationSecretsEditing;
  const form = document.createElement('div');
  form.className = 'initialization-secrets-form';
  const status = document.createElement('span');
  status.className = 'initialization-secrets-status';
  status.setAttribute('aria-live', 'polite');
  if (editing) {
    status.textContent = 'Re-enter the Windows username and password to replace the existing credentials. The password is not prefilled and must be entered again.';
  }
  const actions = document.createElement('div');
  actions.className = 'initialization-secrets-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'warning';
  button.dataset.initAction = 'save-secrets';
  button.dataset.icon = 'password';
  button.textContent = editing ? 'Update deployment secrets' : 'Save deployment secrets';
  actions.append(button);
  if (editing) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.initAction = 'cancel-secrets';
    cancel.textContent = 'Cancel';
    actions.append(cancel);
  }
  form.append(
    createInitializationSecretField('init-windows-username', 'windowsUsername', 'Windows username', 'text'),
    createInitializationSecretField('init-windows-password', 'windowsPassword', 'Windows password', 'password'),
    status,
    actions,
  );
  body.append(form);
}

export function appendInitializationSecretsEditButton(body) {
  const actions = document.createElement('div');
  actions.className = 'initialization-secrets-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.initAction = 'edit-secrets';
  button.dataset.icon = 'password';
  button.textContent = 'Edit secrets';
  actions.append(button);
  body.append(actions);
}

export function appendInitializationProjectRootForm(body, step) {
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

export function initializationActionForOperation(operation) {
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

export function activeInitializationOperation(appState) {
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

export const RERUNNABLE_STEP_ACTIONS = new Set(['interfaces', 'prepare-runtime', 'os-images', 'profiles']);
export const RERUN_STEP_LABELS = {
  interfaces: 'Re-sync endpoint',
  'prepare-runtime': 'Re-prepare runtime',
  'os-images': 'Manage OS images',
  profiles: 'Edit / re-publish profile',
};

// Heuristic front-end dependency inference: which completed steps need a re-run
// because an upstream change made their output stale. Maps existing preflight
// failure signals to the step ids they affect (no backend dependency metadata).
export function computeStepStaleness(appState) {
  const stale = new Set();
  const steps = appState.initialization?.steps ?? [];
  const doneIds = new Set(steps.filter((step) => step.done).map((step) => step.id));
  const checks = Array.isArray(appState.preflight)
    ? appState.preflight
    : Array.isArray(appState.preflight?.checks) ? appState.preflight.checks : [];
  const failed = checks.filter((check) => check && check.ok === false);
  const flag = (id) => { if (doneIds.has(id)) stale.add(id); };
  for (const check of failed) {
    const text = `${check.name ?? ''} ${check.detail ?? ''}`.toLowerCase();
    if (text.includes('manifest') || text.includes('selected-os') || text.includes('selected os')) {
      flag('os-image');
      flag('profile');
    }
    if (text.includes('profile') || text.includes('payload') || text.includes('apps')) {
      flag('profile');
    }
    if (text.includes('boot.wim') || text.includes('ipxe') || text.includes('endpoint') || text.includes('smb') || text.includes('service ip')) {
      flag('endpoint');
    }
    if (text.includes('runtime') || text.includes('artifact')) {
      flag('runtime');
    }
    if ((text.includes('os image') || text.includes('wim')) && !text.includes('boot.wim')) {
      flag('os-image');
    }
  }
  return stale;
}

export function renderSetupProgressChip(initialization, doneSteps, totalSteps) {
  const chip = elements.setupProgressChip;
  if (!chip) {
    return;
  }
  chip.hidden = false;
  const complete = totalSteps > 0 && doneSteps >= totalSteps;
  const live = initialization.deploymentLive === true;
  chip.classList.toggle('ok', complete || live);
  chip.classList.toggle('warn', !complete && !live);
  if (elements.setupProgressText) {
    elements.setupProgressText.textContent = complete || live ? 'Setup complete' : `Setup ${doneSteps}/${totalSteps}`;
  }
}

export function renderInitialization(appState) {
  const initialization = appState.initialization;
  if (!initialization || !elements.initializationDialog) {
    return;
  }

  // Set default view depending on initialization status
  const initialized = initialization.initialized === true;
  const deploymentReady = initialization.deploymentReady === true;
  const deploymentLive = initialization.deploymentLive === true;
  if (state.currentView === null) {
    const saved = localStorage.getItem('winception-view');
    const valid = new Set(['dashboard', 'fleet', 'services', 'logs']);
    state.currentView = saved === 'prepare' || saved === 'guided' ? 'dashboard' : (saved && valid.has(saved)) ? saved : 'dashboard';
  }

  // Toggle active views and nav tabs (Deploy / Monitor)
  if (elements.tabDashboard) {
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
  const dialogScrollPosition = captureInitializationDialogScrollPosition();
  state.initializationDetailScrollPositions = captureInitializationDetailScrollPositions();
  
  // Set default selected step in guided setup (skip when user explicitly collapsed)
  if (!state.selectedGuidedStepId && !state.guidedStepCollapsed) {
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
    elements.initProgressFill.style.background =
      progressPercent >= 67 ? 'var(--ok)' : progressPercent >= 34 ? 'var(--warn)' : 'var(--error)';
  }
  if (elements.initProgressText) {
    elements.initProgressText.textContent = `${doneSteps} of ${totalSteps} complete · ${progressPercent}%`;
  }
  if (elements.setupRailStripCount) {
    elements.setupRailStripCount.textContent = `${doneSteps}/${totalSteps}`;
  }

  // Dependency staleness: steps whose completed output needs re-running
  const staleSteps = computeStepStaleness(appState);

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
    if (step.id === state.selectedGuidedStepId && !state.guidedStepCollapsed) {
      row.classList.add('active');
    }
    if (stepIsRunning) {
      row.classList.add('working');
    }
    // Step ran but has blocking failures — show orange warning state (distinct from "never run")
    const stepHasFailures = step.ran === true && !step.done && !stepIsRunning;
    if (stepHasFailures) {
      row.classList.add('has-failures');
    }
    const stepNeedsUpdate = staleSteps.has(step.id) && !stepIsRunning;
    if (stepNeedsUpdate) {
      row.classList.add('needs-update');
    }

    const status = document.createElement('span');
    status.className = `status-pill ${stepIsRunning ? 'working' : step.done ? 'ok' : stepHasFailures ? 'warn' : step.required ? 'fail' : 'neutral'}`;
    status.textContent = stepIsRunning && step.id === 'runtime'
      ? 'Preparing'
      : stepIsRunning ? 'Running' : step.done ? 'Done' : stepHasFailures ? 'Issues' : step.required ? 'Required' : 'Optional';

    const body = document.createElement('div');
    body.className = 'initialization-step-body';
    const title = document.createElement('strong');
    title.textContent = `${index.toString().padStart(2, '0')}. ${step.label}`;
    if (stepNeedsUpdate) {
      const badge = document.createElement('span');
      badge.className = 'needs-update-badge';
      badge.textContent = 'Needs update';
      title.append(badge);
    }
    const detail = document.createElement('span');
    detail.textContent = step.detail ?? '';
    body.append(title, detail);

    row.append(status, body);
    elements.initializationSteps.append(row);
    index++;
  }
  renderSetupProgressChip(initialization, doneSteps, totalSteps);

  // 2. Render the focused detail panel (moved inline under the active step below)
  const selectedStep = state.guidedStepCollapsed ? null :
    ((initialization.steps ?? []).find(s => s.id === state.selectedGuidedStepId) || initialization.steps?.[0]);
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
    const stepIcon = makeIcon(initializationActionIcon(selectedStep.action), 'text-primary-fixed');
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
    const selectedStepHasFailures = selectedStep.ran === true && !selectedStep.done && !stepIsRunning;
    badge.className = `status-pill ${stepIsRunning ? 'working' : selectedStep.done ? 'ok' : selectedStepHasFailures ? 'warn' : selectedStep.required ? 'fail' : 'neutral'}`;
    badge.textContent = stepIsRunning ? 'Running' : selectedStep.done ? 'Ready' : selectedStepHasFailures ? 'Issues' : selectedStep.required ? 'Required' : 'Optional';

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
    if (selectedStepHasFailures) {
      appendGuidedDiagnosticsAction(body);
    }

    // Action button — re-runnable steps stay editable after init
    const stepRerunnable = RERUNNABLE_STEP_ACTIONS.has(selectedStep.action);
    if (selectedStep.action && selectedStep.action !== 'setup' && !hasInlineSecretsForm && !hasInlineProjectRootForm
      && (!selectedStep.done || stepRerunnable)) {
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'flex justify-start mt-md';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = (selectedStep.required && !selectedStep.done) ? 'warning' : '';
      button.dataset.initAction = selectedStep.action;
      button.dataset.icon = initializationActionIcon(selectedStep.action);
      button.textContent = selectedStep.done
        ? (RERUN_STEP_LABELS[selectedStep.action] ?? `Update ${selectedStep.label}`)
        : (selectedStep.nextActionText ?? initializationActionLabel(selectedStep.action));
      
      const runtime = appState.runtime;
      const requiresElevation = appState?.host?.elevated === false;
      button.disabled = state.busy
        || (selectedStep.action === 'prepare-runtime' && requiresElevation)
        || (selectedStep.action === 'all-services-toggle' && initialization.deploymentReady !== true);
      
      buttonContainer.append(button);
      body.append(buttonContainer);
    }

    detailPanel.append(body);
    restoreInitializationDetailScrollPosition(step.id, detailList);
  }

  // Inline expansion: move the detail panel inside the active step row
  // detailPanel is a stable DOM node; replaceChildren() above already detached it from any prior step
  const activeStepRow = elements.initializationSteps.querySelector('.initialization-step.active');
  if (activeStepRow && detailPanel && selectedStep) {
    activeStepRow.appendChild(detailPanel);
    detailPanel.hidden = false;
  } else if (elements.guidedStepDetail) {
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
    if (!localStorage.getItem('winception-view')) {
      switchToView('dashboard');
    }
    setSetupRailCollapsed(false);
  }
  restoreInitializationDialogScrollPosition(dialogScrollPosition);
  restoreInitializationTextControlFocus(focusedTextControl);
}

export async function saveInitializationSecrets() {
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

export async function saveInitializationProjectRoot() {
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

export function confirmPrepareRuntime(runtime) {
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

export async function handleInitializationLongAction(action) {
  const runtime = state.current?.runtime;
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
  state.guidedConsoleAttentionAction = action;
  state.guidedConsoleAttentionShown = false;
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
    state.guidedConsoleAttentionAction = null;
    state.guidedConsoleAttentionShown = false;
    openDialog(elements.initializationDialog);
    render();
  }
}

export async function handleInitializationAction(action, source = null) {
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
