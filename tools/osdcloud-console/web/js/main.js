import { handleAction, setFleetExpanded, switchToView } from './actions.js';
import { handleDocumentClick } from './actionRegistry.js';
import { api, loadAuthStatus, refresh, saveAuthToken, storedAuthToken } from './api.js';
import { clearRefineFilters, openValidationEvidenceFromTarget } from './deploy.js';
import { bindEmbeddedConfigHeaderToggles, closeDialog, closeEmbeddedConfig, enableBackdropCloseForDialogs, isInsideStandaloneDialog, suppressBackdropCloseClickThrough } from './dialogs.js';
import { $, $$, elements } from './dom.js';
import { showOperationError } from './errorDialog.js';
import { renderFleetCards } from './fleet.js';
import { render } from './render.js';
import { state } from './state.js';
import { copyConsoleLog, hydrateActionIcons, hydrateStaticIcons, setConsoleDockCollapsed, setSetupRailCollapsed } from './ui.js';

hydrateStaticIcons();
hydrateActionIcons();

let deployTooltipTarget = null;
let deployTooltipHideTimer = null;

function deployTooltipSource(target) {
  return target instanceof Element ? target.closest('.deploy-seg[data-deploy-tooltip]') : null;
}

function isDeployTooltipNode(target) {
  return Boolean(elements.deployTooltip && target instanceof Node && elements.deployTooltip.contains(target));
}

function clearDeployTooltipHideTimer() {
  if (!deployTooltipHideTimer) {
    return;
  }
  window.clearTimeout(deployTooltipHideTimer);
  deployTooltipHideTimer = null;
}

function scheduleDeployTooltipHide() {
  clearDeployTooltipHideTimer();
  deployTooltipHideTimer = window.setTimeout(() => {
    deployTooltipHideTimer = null;
    hideDeployTooltip();
  }, 160);
}

function renderDeployTooltipContent(payload) {
  elements.deployTooltip.replaceChildren();
  const title = document.createElement('div');
  title.className = 'deploy-tooltip-title';
  title.textContent = payload.title ?? '';
  elements.deployTooltip.append(title);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length) {
    const details = document.createElement('dl');
    details.className = 'deploy-tooltip-details';
    rows.forEach((row) => {
      const [label, value] = Array.isArray(row) ? row : ['', row];
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value ?? '-';
      details.append(dt, dd);
    });
    elements.deployTooltip.append(details);
  }
  const list = Array.isArray(payload.list) ? payload.list : [];
  if (list.length) {
    const listTitle = document.createElement('div');
    listTitle.className = 'deploy-tooltip-section-title';
    listTitle.textContent = payload.listTitle ?? 'Details';
    const ul = document.createElement('ul');
    ul.className = 'deploy-tooltip-list';
    list.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item ?? '-';
      ul.append(li);
    });
    elements.deployTooltip.append(listTitle, ul);
  }
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  sections.forEach((section) => {
    const sectionList = Array.isArray(section?.list) ? section.list : [];
    if (!sectionList.length) {
      return;
    }
    const listTitle = document.createElement('div');
    listTitle.className = 'deploy-tooltip-section-title';
    listTitle.textContent = section.title ?? 'Details';
    const ul = document.createElement('ul');
    ul.className = 'deploy-tooltip-list';
    sectionList.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item ?? '-';
      ul.append(li);
    });
    elements.deployTooltip.append(listTitle, ul);
  });
}

function positionDeployTooltip(target) {
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = elements.deployTooltip.getBoundingClientRect();
  const margin = 12;
  const left = Math.min(
    Math.max(margin, targetRect.left),
    Math.max(margin, window.innerWidth - tooltipRect.width - margin),
  );
  let top = targetRect.bottom + 8;
  if (top + tooltipRect.height > window.innerHeight - margin) {
    top = Math.max(margin, targetRect.top - tooltipRect.height - 8);
  }
  elements.deployTooltip.style.left = `${left}px`;
  elements.deployTooltip.style.top = `${top}px`;
}

function showDeployTooltip(target) {
  if (!elements.deployTooltip) {
    return;
  }
  clearDeployTooltipHideTimer();
  let payload;
  try {
    payload = JSON.parse(target.dataset.deployTooltip ?? '{}');
  } catch {
    payload = {};
  }
  if (!payload.title && !payload.rows && !payload.list && !payload.sections) {
    return;
  }
  deployTooltipTarget?.removeAttribute('aria-describedby');
  deployTooltipTarget = target;
  renderDeployTooltipContent(payload);
  elements.deployTooltip.hidden = false;
  target.setAttribute('aria-describedby', 'deploy-tooltip');
  positionDeployTooltip(target);
}

function hideDeployTooltip(target = deployTooltipTarget) {
  if (!elements.deployTooltip || elements.deployTooltip.hidden) {
    return;
  }
  clearDeployTooltipHideTimer();
  target?.removeAttribute('aria-describedby');
  elements.deployTooltip.hidden = true;
  elements.deployTooltip.style.left = '';
  elements.deployTooltip.style.top = '';
  deployTooltipTarget = null;
}

function renderAuthGate() {
  if (!elements.authGate) {
    return;
  }
  const shouldShow = state.auth.required && (!storedAuthToken() || Boolean(state.auth.error));
  elements.authGate.hidden = !shouldShow;
  if (elements.webTokenError) {
    elements.webTokenError.hidden = !state.auth.error;
    elements.webTokenError.textContent = state.auth.error;
  }
}

document.addEventListener('click', handleDocumentClick);

document.addEventListener('input', (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input) return;
  if (input.dataset.torrentSeedSetting === 'true') {
    state.torrentSeedMinutesDraft = input.value;
  }
  if (input.dataset.torrentExtensionRunId) {
    state.torrentExtensionMinutesByRun[input.dataset.torrentExtensionRunId] = input.value;
  }
});

document.addEventListener('pointerover', (event) => {
  const target = deployTooltipSource(event.target);
  if (target) {
    showDeployTooltip(target);
    return;
  }
  if (isDeployTooltipNode(event.target)) {
    clearDeployTooltipHideTimer();
  }
});

document.addEventListener('pointerout', (event) => {
  const target = deployTooltipSource(event.target);
  const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
  if (target) {
    if (relatedTarget && (target.contains(relatedTarget) || isDeployTooltipNode(relatedTarget))) {
      return;
    }
    scheduleDeployTooltipHide();
    return;
  }
  if (isDeployTooltipNode(event.target)) {
    if (relatedTarget && (isDeployTooltipNode(relatedTarget) || deployTooltipTarget?.contains(relatedTarget))) {
      return;
    }
    scheduleDeployTooltipHide();
  }
});

document.addEventListener('focusin', (event) => {
  const target = deployTooltipSource(event.target);
  if (target) {
    showDeployTooltip(target);
  }
});

document.addEventListener('focusout', (event) => {
  const target = deployTooltipSource(event.target);
  if (target) {
    hideDeployTooltip(target);
  }
});

$$('button[data-action]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleAction(button.dataset.action, button).catch(showOperationError);
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

// Click outside config-embed (profile / OS image / endpoint panel) closes it.
// Uses mousedown + capture so it fires before stopPropagation in button handlers.
document.addEventListener('mousedown', (event) => {
  const configHost = document.getElementById('config-embed');
  if (!configHost || configHost.hidden) return;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  // deploy-seg segment buttons have their own toggle logic — don't interfere
  if (target.closest('.deploy-seg[data-action]')) return;
  if (isInsideStandaloneDialog(target)) return;
  if (!target.closest('#config-embed')) {
    closeEmbeddedConfig();
  }
}, { capture: true });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (elements.deployTooltip && !elements.deployTooltip.hidden) {
      hideDeployTooltip();
      return;
    }
    const configHost = document.getElementById('config-embed');
    const standaloneDialogOpen = Boolean(document.querySelector('dialog[open]:not(.embedded-open)'));
    if (configHost && !configHost.hidden && !standaloneDialogOpen) {
      closeEmbeddedConfig();
      return;
    }
  }
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
  handleAction(serviceCard.dataset.action).catch(showOperationError);
});

document.addEventListener('click', suppressBackdropCloseClickThrough, true);

elements.refreshButton.addEventListener('click', () => {
  refresh().catch(showOperationError);
});

elements.validationEvidenceDialog?.addEventListener('close', () => {
  state.validationEvidenceOpen = false;
});

elements.authForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  saveAuthToken(elements.webTokenInput?.value ?? '');
  refresh()
    .then(() => renderAuthGate())
    .catch(() => renderAuthGate());
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
bindEmbeddedConfigHeaderToggles();

// Console dock: header toggles collapse, copy button copies the visible log
if (elements.consoleDockHead) {
  elements.consoleDockHead.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('#console-dock-copy')) {
      return;
    }
    setConsoleDockCollapsed(!state.consoleDockCollapsed);
  });
  elements.consoleDockHead.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    if (event.target instanceof Element && event.target.closest('#console-dock-copy')) {
      return;
    }
    event.preventDefault();
    setConsoleDockCollapsed(!state.consoleDockCollapsed);
  });
}
elements.consoleDockCopy?.addEventListener('click', (event) => {
  event.stopPropagation();
  copyConsoleLog(elements.consoleDockCopy).catch(showOperationError);
});

// Header workspace switcher (Deploy / Monitor). Guided setup stays inside the
// Deploy rail and is opened/collapsed by the rail controls.
if (elements.tabDashboard) {
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
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    // Don't toggle expand/collapse when clicking interactive controls inside the step
    if (target?.closest('input, button, select, textarea, label, a')) {
      return;
    }
    const stepEl = target?.closest('.initialization-step');
    if (stepEl && stepEl.dataset.stepId) {
      if (stepEl.dataset.stepId === state.selectedGuidedStepId && !state.guidedStepCollapsed) {
        state.guidedStepCollapsed = true;
      } else {
        state.selectedGuidedStepId = stepEl.dataset.stepId;
        state.guidedStepCollapsed = false;
      }
      render();
    }
  });
}

// Guided-setup rail: the chevron collapses it (maximizing Deploy); the
// collapsed strip re-expands it.
elements.setupRailCollapse?.addEventListener('click', () => setSetupRailCollapsed(true));
elements.setupRailStrip?.addEventListener('click', () => setSetupRailCollapsed(false));

async function boot() {
  await loadAuthStatus();
  renderAuthGate();
  if (!state.auth.required || storedAuthToken()) {
    await refresh();
    renderAuthGate();
  }
}

boot().catch((error) => {
  state.refreshError = error.message;
  renderAuthGate();
  showOperationError(error);
});
setInterval(() => {
  if (!state.auth.required || storedAuthToken()) {
    refresh().then(() => renderAuthGate()).catch(() => renderAuthGate());
  }
}, 2500);
