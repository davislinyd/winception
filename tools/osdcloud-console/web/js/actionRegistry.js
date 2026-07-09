import {
  clearFleetSelection,
  handleAction,
  handleFleetBulkAction,
  handleOsImageDelete,
  handleOsImageDownload,
  handleOsImageImport,
  handleOsImageReexport,
  handleProfileDelete,
  handleProfileSelect,
  handleSoftwareDelete,
  selectFleetCard,
  setFleetExpanded,
  switchToView,
  toggleFleetSelection,
} from './actions.js';
import { openValidationEvidenceFromTarget } from './deploy.js';
import {
  confirmEndpointSync,
  handleScriptDelete,
  showScriptContentViewer,
  showSoftwareDetails,
  showSoftwareScriptViewer,
} from './dialogs.js';
import { elements } from './dom.js';
import { render } from './render.js';
import { handleInitializationAction } from './setup.js';
import { state } from './state.js';

export function handleDocumentClick(event) {
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
      clearFleetSelection();
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
    clearFleetSelection();
    render();
    return;
  }

  const bulkButton = target.closest('[data-bulk-action]');
  if (bulkButton) {
    handleFleetBulkAction(bulkButton.dataset.bulkAction).catch((error) => window.alert(error.message));
    return;
  }

  if (openValidationEvidenceFromTarget(target)) {
    event.preventDefault();
    return;
  }

  const fleetCheck = target.closest('[data-fleet-check]');
  if (fleetCheck) {
    toggleFleetSelection(fleetCheck.dataset.fleetCheck);
    render();
    return;
  }

  const fleetCardSelect = target.closest('[data-fleet-select]');
  if (fleetCardSelect) {
    selectFleetCard(fleetCardSelect.dataset.fleetSelect, event);
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
}
