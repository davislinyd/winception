import { handleAction, handleOsImageDelete, handleOsImageDownload, handleOsImageImport, handleOsImageReexport, handleProfileDelete, handleProfileSelect, handleSoftwareDelete, setFleetExpanded, switchToView } from './actions.js';
import { api, refresh } from './api.js';
import { clearRefineFilters, openValidationEvidenceFromTarget } from './deploy.js';
import { closeDialog, confirmEndpointSync, enableBackdropCloseForDialogs, handleScriptDelete, showScriptContentViewer, showSoftwareDetails, showSoftwareScriptViewer, suppressBackdropCloseClickThrough } from './dialogs.js';
import { $, $$, elements } from './dom.js';
import { renderFleetCards } from './fleet.js';
import { render } from './render.js';
import { handleInitializationAction } from './setup.js';
import { state } from './state.js';
import { copyConsoleLog, setConsoleDockCollapsed } from './ui.js';

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
  const gotoButton = target.closest('[data-goto]');
  if (gotoButton) {
    if (gotoButton.dataset.fleetFilter) {
      state.fleetFilter = gotoButton.dataset.fleetFilter;
    }
    if (gotoButton.dataset.goto === 'activity') {
      switchToView('fleet');
    }
    render();
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
    } else if (image && osImageButton.dataset.osImageAction === 'reexport') {
      handleOsImageReexport(image).catch((error) => window.alert(error.message));
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
  copyConsoleLog(elements.consoleDockCopy).catch((error) => window.alert(error.message));
});

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

// Topbar setup progress chip: jump to guided setup
elements.setupProgressChip?.addEventListener('click', () => {
  switchToView('guided');
});

refresh().catch((error) => window.alert(error.message));
setInterval(() => {
  refresh().catch(() => {});
}, 2500);
