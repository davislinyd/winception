import { switchToView } from './actions.js';
import { api, mutate } from './api.js';
import { $, $$, elements } from './dom.js';
import { operationErrorDetails, showOperationError, showOperationNotice } from './errorDialog.js';
import { bytes, osImageLabel, text } from './format.js';
import { render } from './render.js';
import { state } from './state.js';
import { makeIcon, setControlsDisabled, setDefinitionListNodes, setSetupRailCollapsed } from './ui.js';

export let suppressBackdropClickUntil = 0;
export const humanCatalogIdPattern = /^[a-z0-9][a-z0-9-]{0,15}$/u;
let selectedSoftwareInstallerFile = null;

export function validateHumanCatalogId(value, label) {
  if (!value) {
    return `${label} is required.`;
  }
  if (!humanCatalogIdPattern.test(value)) {
    return `${label} must use lowercase letters, numbers, and hyphens only, max 16 characters.`;
  }
  return '';
}

export function isDialogOpen(dialog) {
  return Boolean(dialog.open || dialog.hasAttribute('open'));
}

export function embeddedConfigDialogs() {
  return [
    elements.deploymentProfilesDialog,
    elements.osImagesDialog,
    elements.endpointSettingsDialog,
  ].filter(Boolean);
}

export function embeddedConfigTargets() {
  return [
    { dialog: elements.deploymentProfilesDialog, action: 'profiles' },
    { dialog: elements.osImagesDialog, action: 'os-images' },
    { dialog: elements.endpointSettingsDialog, action: 'interfaces' },
  ].filter((entry) => entry.dialog);
}

const embeddedConfigScrollState = {
  scrollHost: null,
  scrollTop: 0,
};

export function getEmbeddedConfigScrollHost(host = document.getElementById('config-embed')) {
  return host?.closest('.deploy-main') ?? null;
}

export function rememberEmbeddedConfigScrollPosition(host = document.getElementById('config-embed')) {
  if (embeddedConfigScrollState.scrollHost) {
    return;
  }
  const scrollHost = getEmbeddedConfigScrollHost(host);
  if (!scrollHost) {
    return;
  }
  embeddedConfigScrollState.scrollHost = scrollHost;
  embeddedConfigScrollState.scrollTop = scrollHost.scrollTop;
}

export function clearEmbeddedConfigScrollPosition() {
  embeddedConfigScrollState.scrollHost = null;
  embeddedConfigScrollState.scrollTop = 0;
}

export function restoreEmbeddedConfigScrollPosition() {
  const scrollHost = embeddedConfigScrollState.scrollHost;
  if (!scrollHost) {
    return;
  }
  const savedScrollTop = embeddedConfigScrollState.scrollTop;
  requestAnimationFrame(() => {
    const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    scrollHost.scrollTop = Math.min(savedScrollTop, maxScrollTop);
    clearEmbeddedConfigScrollPosition();
  });
}

export function syncEmbeddedConfigSummaryState() {
  for (const { dialog, action } of embeddedConfigTargets()) {
    const button = document.querySelector(`.deploy-seg[data-action="${action}"]`);
    const open = dialog.classList.contains('embedded-open');
    if (!button) {
      continue;
    }
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
  }
}

export function isEmbeddedConfigDialog(dialog) {
  return embeddedConfigDialogs().includes(dialog);
}

export function isInsideStandaloneDialog(target) {
  const dialog = target?.closest?.('dialog');
  return Boolean(dialog && !dialog.classList.contains('embedded-open'));
}

export function closeEmbeddedConfig(except = null) {
  const host = document.getElementById('config-embed');
  for (const dialog of embeddedConfigDialogs()) {
    if (dialog === except || !dialog.classList.contains('embedded-open')) {
      continue;
    }
    if (except) {
      dialog.dataset.embeddedScrollSuppressRestore = '1';
    }
    if (isDialogOpen(dialog)) {
      closeDialog(dialog, 'cancel');
    } else {
      restoreEmbeddedDialog(dialog);
    }
  }
  if (host && !host.querySelector('dialog.embedded-open')) {
    host.hidden = true;
  }
  syncEmbeddedConfigSummaryState();
}

export function restoreEmbeddedDialog(dialog) {
  const suppressScrollRestore = dialog.dataset.embeddedScrollSuppressRestore === '1';
  delete dialog.dataset.embeddedScrollSuppressRestore;
  dialog.classList.remove('embedded-open');
  dialog.removeAttribute('open');
  if (dialog.parentElement && dialog.parentElement.id === 'config-embed') {
    document.body.append(dialog);
  }
  const host = document.getElementById('config-embed');
  const hasEmbeddedOpenDialog = Boolean(host?.querySelector('dialog.embedded-open'));
  if (host && !hasEmbeddedOpenDialog) {
    host.hidden = true;
  }
  if (!hasEmbeddedOpenDialog && !suppressScrollRestore) {
    restoreEmbeddedConfigScrollPosition();
  }
  syncEmbeddedConfigSummaryState();
}

export function openEmbeddedConfig(dialog) {
  const host = document.getElementById('config-embed');
  if (!host) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    return;
  }
  // toggle: clicking the same segment again closes it
  if (dialog.classList.contains('embedded-open')) {
    closeEmbeddedConfig();
    return;
  }
  rememberEmbeddedConfigScrollPosition(host);
  closeEmbeddedConfig(dialog);
  if (!dialog.dataset.embeddedCloseBound) {
    dialog.dataset.embeddedCloseBound = '1';
    dialog.addEventListener('close', () => restoreEmbeddedDialog(dialog));
  }
  switchToView('dashboard');
  host.hidden = false;
  host.append(dialog);
  dialog.classList.add('embedded-open');
  dialog.setAttribute('open', '');
  syncEmbeddedConfigSummaryState();
  requestAnimationFrame(() => {
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function bindEmbeddedConfigHeaderToggles() {
  $$('[data-embedded-config-toggle]').forEach((button) => {
    if (button.dataset.embeddedConfigToggleBound === '1') {
      return;
    }
    button.dataset.embeddedConfigToggleBound = '1';
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (!dialog || !isEmbeddedConfigDialog(dialog)) {
        return;
      }
      if (dialog.classList.contains('embedded-open')) {
        closeEmbeddedConfig();
        return;
      }
      closeDialog(dialog, 'cancel');
    });
  });
}

export function openDialog(dialog) {
  if (dialog === elements.initializationDialog) {
    switchToView('dashboard');
    setSetupRailCollapsed(false);
    return;
  }
  if (isEmbeddedConfigDialog(dialog)) {
    openEmbeddedConfig(dialog);
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

export function closeDialog(dialog, returnValue = '') {
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

export function cancelDialog(dialog) {
  if (!isDialogOpen(dialog)) {
    return;
  }
  const cancelEvent = new Event('cancel', { cancelable: true });
  const shouldClose = dialog.dispatchEvent(cancelEvent);
  if (shouldClose && isDialogOpen(dialog)) {
    closeDialog(dialog, 'cancel');
  }
}

export function enableBackdropClose(dialog) {
  dialog.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    if (dialog.classList.contains('embedded-open')) {
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

export function enableBackdropCloseForDialogs() {
  $$('dialog').forEach((dialog) => enableBackdropClose(dialog));
}

export function suppressBackdropCloseClickThrough(event) {
  if (performance.now() > suppressBackdropClickUntil) {
    return;
  }
  suppressBackdropClickUntil = 0;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function validateProfileInput(name) {
  if (!name) {
    return 'Display name is required.';
  }
  return '';
}

export function availableOsImages() {
  return state.current?.osImage?.images ?? [];
}

export function populateOsImageSelect(selectElement, selectedId) {
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

export function renderSoftwareBaseline(element, softwareIds, catalog) {
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

export function showAddProfileDialog(profile) {
  return new Promise((resolve) => {
    elements.profileForm.reset();
    elements.profileError.textContent = '';
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
      const displayLanguage = elements.profileDisplayLanguage.value.trim() || null;
      const locale = elements.profileLocale.value.trim() || null;
      const inputLanguage = elements.profileInputLanguage.value.trim() || null;
      const timeZone = elements.profileTimezone.value.trim() || null;
      done({
        name,
        description: elements.profileDescription.value.trim(),
        osImageId,
        ...(displayLanguage ? { displayLanguage } : {}),
        ...(locale ? { locale } : {}),
        ...(inputLanguage ? { inputLanguage } : {}),
        ...(timeZone ? { timeZone } : {}),
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

export function showSoftwareTestDialog(configuration = {}, saveConfiguration = null) {
  return new Promise((resolve) => {
    elements.softwareTestForm.reset();
    elements.softwareTestVmName.value = configuration.vmName ?? 'winception-software-test-01';
    elements.softwareTestCheckpointName.value = configuration.checkpointName ?? 'Winception-SoftwareTest-Clean';
    elements.softwareTestTargetUser.value = configuration.targetUser ?? '';
    elements.softwareTestError.textContent = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      elements.softwareTestForm.removeEventListener('submit', submit);
      elements.softwareTestCancel.removeEventListener('click', cancel);
      elements.softwareTestCancelSecondary.removeEventListener('click', cancel);
      elements.softwareTestDialog.removeEventListener('cancel', cancel);
      if (isDialogOpen(elements.softwareTestDialog)) {
        closeDialog(elements.softwareTestDialog, 'cancel');
      }
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault();
      done(null);
    };
    const submit = async (event) => {
      event.preventDefault();
      if (!elements.softwareTestForm.reportValidity()) {
        return;
      }
      const input = {
        vmName: elements.softwareTestVmName.value.trim(),
        checkpointName: elements.softwareTestCheckpointName.value.trim(),
        targetUser: elements.softwareTestTargetUser.value.trim(),
      };
      if (!saveConfiguration) {
        done(input);
        return;
      }
      const submitButton = elements.softwareTestForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        await saveConfiguration(input);
        done(input);
      } catch (error) {
        const details = operationErrorDetails(error);
        elements.softwareTestError.textContent = details.action
          ? `${details.message} ${details.action}`
          : details.message;
        elements.softwareTestError.focus();
      } finally {
        submitButton.disabled = false;
      }
    };
    elements.softwareTestForm.addEventListener('submit', submit);
    elements.softwareTestCancel.addEventListener('click', cancel);
    elements.softwareTestCancelSecondary.addEventListener('click', cancel);
    elements.softwareTestDialog.addEventListener('cancel', cancel);
    openDialog(elements.softwareTestDialog);
  });
}

export function showSoftwareDialog(profile, profileToEdit = null) {
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
    elements.softwareProfileName.value = targetProfile?.name ?? '';
    elements.softwareProfileDescription.value = targetProfile?.description ?? '';
    populateOsImageSelect(elements.softwareProfileOsImage, targetProfile?.osImageId ?? '');
    elements.softwareProfileDisplayLanguage.value = targetProfile?.displayLanguage ?? '';
    elements.softwareProfileLocale.value = targetProfile?.locale ?? '';
    elements.softwareProfileInputLanguage.value = targetProfile?.inputLanguage ?? '';
    elements.softwareProfileTimezone.value = targetProfile?.timeZone ?? '';

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
      button.append(makeIcon(icon, 'local-action-icon'));
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
          handle.setAttribute('aria-hidden', 'true');
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
      const displayLanguage = elements.softwareProfileDisplayLanguage.value.trim() || null;
      const locale = elements.softwareProfileLocale.value.trim() || null;
      const inputLanguage = elements.softwareProfileInputLanguage.value.trim() || null;
      const timeZone = elements.softwareProfileTimezone.value.trim() || null;
      done({
        profileId: targetProfile?.id ?? '',
        isActive: isActiveTarget,
        name,
        description: elements.softwareProfileDescription.value.trim(),
        softwareIds: selectedSoftwareIds(),
        installSequence,
        osImageId,
        displayLanguage,
        locale,
        inputLanguage,
        timeZone,
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

export function installerTypeForFile(file) {
  const name = String(file?.name ?? '').toLowerCase();
  if (name.endsWith('.msi')) {
    return 'msi';
  }
  if (name.endsWith('.exe')) {
    return 'exe';
  }
  return '';
}

export function defaultSoftwareArgs(installerType) {
  return installerType === 'msi'
    ? '/qn /norestart REBOOT=ReallySuppress'
    : '/quiet /norestart';
}

export function defaultSoftwareSuccessCodes(installerType) {
  return installerType === 'msi' ? '0,1641,3010' : '0';
}

export function setAddSoftwareTemplateDefaults(installerType) {
  elements.softwareAddSilentArgs.value = defaultSoftwareArgs(installerType);
  elements.softwareAddSuccessCodes.value = defaultSoftwareSuccessCodes(installerType);
}

export function customPowerShellTemplate(installerType) {
  const isMsi = installerType === 'msi';
  const installerFilter = isMsi ? '*.msi' : '*.exe';
  const startProcess = isMsi
    ? `$logPath = Join-Path $logRoot 'custom-installer-msi.log'
$arguments = '/i "' + $installer.FullName + '" /qn /norestart REBOOT=ReallySuppress /L*v "' + $logPath + '"'
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden`
    : `$process = Start-Process -FilePath $installer.FullName -ArgumentList '/quiet /norestart' -Wait -PassThru -WindowStyle Hidden`;
  const successCodes = isMsi ? '0,1641,3010' : '0';
  return `# Custom PowerShell runs as non-interactive SYSTEM in Windows PowerShell 5.1.
# This package publishes this install.ps1 and the selected ${isMsi ? 'MSI' : 'EXE'} payload together.
# The normal flow is: find the payload, run it silently, validate its exit code, then optionally verify installation.
# Change the vendor-specific arguments and verification below; do not add interactive prompts or forced restarts.
$ErrorActionPreference = 'Stop'

# Use a durable local log folder so technicians can inspect installer output after deployment.
$logRoot = 'C:\\Windows\\Temp\\osdcloud-logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

# A package normally contains one installer. If you intentionally add several matching files,
# replace this discovery with the exact filename so selection is deterministic.
$installer = Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter '${installerFilter}' | Select-Object -First 1
if ($null -eq $installer) {
    throw 'Expected ${isMsi ? 'MSI' : 'EXE'} payload was not found beside install.ps1.'
}

# Start-Process waits for the child installer before checking its exit code.
# MSI uses /qn and /norestart to stay non-interactive; /L*v records a verbose installer log.
# For an EXE, replace /quiet /norestart only with silent switches documented by that vendor.
${startProcess}

# MSI commonly uses 0, 1641, and 3010. EXE success codes are vendor-specific, so this template trusts 0.
# A non-listed code stops the deployment sequence and retains the diagnostic failure state.
$successExitCodes = @(${successCodes})
if ($successExitCodes -notcontains $process.ExitCode) {
    throw ('Installer failed with exit code ' + $process.ExitCode)
}

# Optional: set this to a durable installed file, service, or registry check.
# Leave it empty only when the installer exit code is sufficient evidence for this package.
$verifyPath = ''
if ($verifyPath -and -not (Test-Path -LiteralPath $verifyPath -PathType Leaf)) {
    throw ('Installer completed but verification was not found: ' + $verifyPath)
}

# Preserve Winception's reboot semantics. Do not call Restart-Computer from this script.
# 3010 completes this step but recommends a restart; 1641 checkpoints and resumes at the next step after sign-in.
if ($process.ExitCode -eq 3010) {
    Write-Output 'WINCEPTION_REBOOT_RECOMMENDED'
}
if ($process.ExitCode -eq 1641) {
    Write-Output 'WINCEPTION_REBOOT_PENDING'
}`;
}

export function updateAddSoftwareFileDisplay() {
  elements.softwareAddFileName.textContent = selectedSoftwareInstallerFile?.name ?? '尚未選擇檔案';
}

export function selectedAddSoftwareMode() {
  return elements.softwareAddModeRaw.checked ? 'raw' : 'template';
}

export function selectedAddSoftwareDependencies() {
  return Array.from(
    elements.softwareAddDependsOn.querySelectorAll('input[data-software-dependency]:checked'),
    (input) => input.value,
  );
}

export function updateAddSoftwareInstallerTypeDisplay() {
  const inferred = installerTypeForFile(selectedSoftwareInstallerFile);
  elements.softwareAddInstallerTypeDisplay.textContent = inferred
    ? inferred.toUpperCase()
    : '選擇 MSI 或 EXE 後自動判定';
  elements.softwareAddRawTemplate.textContent = `載入 ${(inferred || elements.softwareAddInstallerType.value).toUpperCase()} 參考範本`;
}

export function updateAddSoftwareMode() {
  const mode = selectedAddSoftwareMode();
  const installerType = elements.softwareAddInstallerType.value;
  const isTemplate = mode === 'template';
  elements.softwareAddTemplateFields.hidden = !isTemplate;
  elements.softwareAddRawFields.hidden = isTemplate;
  elements.softwareAddTemplateFields.querySelectorAll('input').forEach((input) => {
    input.disabled = !isTemplate;
  });
  elements.softwareAddRawScript.disabled = isTemplate;
  elements.softwareAddRawScript.required = !isTemplate;
  elements.softwareAddRawScript.setAttribute('aria-required', String(!isTemplate));
  elements.softwareAddRawTemplate.disabled = isTemplate;
  elements.softwareAddModeTemplateCard.classList.toggle('selected', isTemplate);
  elements.softwareAddModeRawCard.classList.toggle('selected', !isTemplate);
  if (isTemplate && !elements.softwareAddSilentArgs.value.trim()) {
    elements.softwareAddSilentArgs.value = defaultSoftwareArgs(installerType);
  }
  if (isTemplate && !elements.softwareAddSuccessCodes.value.trim()) {
    elements.softwareAddSuccessCodes.value = defaultSoftwareSuccessCodes(installerType);
  }
  updateAddSoftwareNetworkMode();
}

export function updateAddSoftwareNetworkMode() {
  const needsInternet = elements.softwareAddNetworkRequirement.value === 'client-internet';
  elements.softwareAddNetworkFields.hidden = !needsInternet;
  elements.softwareAddNetworkProbeHost.disabled = !needsInternet;
  elements.softwareAddNetworkProbeHost.required = needsInternet;
  elements.softwareAddNetworkProbeHost.setAttribute('aria-required', String(needsInternet));
  if (!elements.softwareAddStepRequirements.hidden) {
    updateAddSoftwareReview();
  }
}

export function updateAddSoftwareInstallerDefaults() {
  const file = elements.softwareAddFile.files?.[0];
  if (file) {
    selectedSoftwareInstallerFile = file;
  }
  const inferred = installerTypeForFile(file);
  if (inferred) {
    elements.softwareAddInstallerType.value = inferred;
    setAddSoftwareTemplateDefaults(inferred);
  }
  updateAddSoftwareFileDisplay();
  updateAddSoftwareInstallerTypeDisplay();
  updateAddSoftwareMode();
}

export function openAddSoftwareFilePicker() {
  elements.softwareAddFile.click();
}

export function insertAddSoftwareRawTemplate() {
  if (elements.softwareAddRawScript.value.trim()) {
    elements.softwareAddError.textContent = '已輸入 Custom PowerShell。為避免覆寫內容，請先自行清空後再載入範本。';
    return;
  }
  elements.softwareAddRawScript.value = customPowerShellTemplate(elements.softwareAddInstallerType.value);
  elements.softwareAddError.textContent = '';
  elements.softwareAddRawScript.focus();
}

export function validateAddSoftwarePackageInput(input) {
  const idError = validateHumanCatalogId(input.softwareId, 'Software ID');
  if (idError) {
    return idError;
  }
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
  return '';
}

export function validateAddSoftwareInput(input) {
  const packageError = validateAddSoftwarePackageInput(input);
  if (packageError) {
    return packageError;
  }
  if (input.scriptMode === 'raw' && !input.rawScript.trim()) {
    return 'Custom PowerShell requires install.ps1 content.';
  }
  if (input.network.requirement === 'client-internet' && !input.network.probeHost) {
    return 'Client Internet mode requires a network probe hostname.';
  }
  if (input.network.requirement === 'client-internet' && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(input.network.probeHost)) {
    return 'Network probe hostname must be a DNS hostname without a scheme, port, or path.';
  }
  return '';
}

export function collectAddSoftwareInput() {
  const scriptMode = selectedAddSoftwareMode();
  const networkRequirement = elements.softwareAddNetworkRequirement.value;
  const input = {
    softwareId: elements.softwareAddId.value.trim(),
    name: elements.softwareAddName.value.trim(),
    file: selectedSoftwareInstallerFile,
    scriptMode,
    installerType: elements.softwareAddInstallerType.value,
    dependsOn: selectedAddSoftwareDependencies(),
    network: {
      requirement: networkRequirement,
      ...(networkRequirement === 'client-internet' ? {
        probeHost: elements.softwareAddNetworkProbeHost.value.trim(),
      } : {}),
    },
  };
  if (scriptMode === 'template') {
    input.silentArgs = elements.softwareAddSilentArgs.value.trim();
    input.successExitCodes = elements.softwareAddSuccessCodes.value.trim();
    input.verifyPath = elements.softwareAddVerifyPath.value.trim();
  } else {
    input.rawScript = elements.softwareAddRawScript.value;
  }
  return input;
}

export function updateAddSoftwareReview() {
  const input = collectAddSoftwareInput();
  const dependencyNames = Array.from(
    elements.softwareAddDependsOn.querySelectorAll('input[data-software-dependency]:checked'),
    (checkbox) => checkbox.dataset.softwareName ?? checkbox.value,
  );
  const installerName = input.file?.name ?? '尚未選擇';
  const installerType = input.file ? input.installerType.toUpperCase() : '—';
  const installation = input.scriptMode === 'template'
    ? `Guided installer；回傳碼 ${input.successExitCodes || '預設值'}；${input.verifyPath ? `驗證 ${input.verifyPath}` : '僅信任回傳碼'}`
    : 'Custom PowerShell；儲存前會做 Windows PowerShell 5.1 syntax 檢查';
  const network = input.network.requirement === 'client-internet'
    ? `Client 必須可連外（${input.network.probeHost || '尚未填寫 hostname'}）`
    : 'Host 預載 payload；client 不需外網';
  setDefinitionListNodes(elements.softwareAddReviewList, [
    ['Software', input.name ? `${input.name} (${input.softwareId || '未填 ID'})` : '尚未填寫'],
    ['Payload', `${installerName} / ${installerType}`],
    ['安裝方式', installation],
    ['前置 software', dependencyNames.length ? dependencyNames.join('、') : '無'],
    ['Client 網路', network],
  ]);
}

export function updateAddSoftwareStep(step) {
  const currentStep = Number(step);
  const steps = [
    elements.softwareAddStepPackage,
    elements.softwareAddStepInstall,
    elements.softwareAddStepRequirements,
  ];
  steps.forEach((section, index) => {
    section.hidden = index + 1 !== currentStep;
  });
  elements.softwareAddStepIndicators.forEach((indicator, index) => {
    const indicatorStep = index + 1;
    indicator.classList.toggle('active', indicatorStep === currentStep);
    indicator.classList.toggle('complete', indicatorStep < currentStep);
    indicator.setAttribute('aria-current', indicatorStep === currentStep ? 'step' : 'false');
  });
  elements.softwareAddBack.hidden = currentStep === 1;
  elements.softwareAddNext.hidden = currentStep === 3;
  elements.softwareAddSubmit.hidden = currentStep !== 3;
  if (currentStep === 3) {
    updateAddSoftwareReview();
  }
}

export function validateAddSoftwareStep(step) {
  const input = collectAddSoftwareInput();
  if (step === 1) {
    return validateAddSoftwarePackageInput(input);
  }
  if (step === 2 && input.scriptMode === 'raw' && !input.rawScript.trim()) {
    return 'Custom PowerShell requires install.ps1 content.';
  }
  return '';
}

export async function showSoftwareScriptViewer(software) {
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

export function showSoftwareDetails(software) {
  const usedByProfiles = software.usedByProfiles?.map((profile) => profile.name) ?? [];
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
    : software.scriptMode === 'template' ? 'Guided installer' : software.scriptMode === 'raw' ? 'Custom PowerShell' : software.scriptMode;
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
    ...(software.scriptMode === 'raw' ? [] : [
      ['Silent arguments', software.silentArgs],
      ['Success exit codes', Array.isArray(software.successExitCodes) ? software.successExitCodes.join(',') : software.successExitCodes],
    ]),
    ...(software.scriptMode === 'raw' ? [] : [
      ['Verification', software.verificationMode],
      ['Installed file to verify', software.verifyPath],
    ]),
    ['Dependencies', software.dependsOn?.length ? software.dependsOn.join(', ') : 'none'],
    ['Client network', software.network?.requirement === 'client-internet' ? `required (${software.network.probeHost})` : 'not required'],
    ['Applied profiles', usedByProfiles.length ? usedByProfiles.join(', ') : 'not selected'],
    ['Source path', software.sourcePath],
    ['install.ps1', software.installScript],
  ]);
  openDialog(elements.softwareDetailDialog);
}

export function showAddSoftwareDialog() {
  return new Promise((resolve) => {
    elements.softwareAddForm.reset();
    selectedSoftwareInstallerFile = null;
    elements.softwareAddFile.value = '';
    updateAddSoftwareFileDisplay();
    elements.softwareAddError.textContent = '';
    elements.softwareAddInstallerType.value = 'msi';
    elements.softwareAddModeTemplate.checked = true;
    elements.softwareAddNetworkRequirement.value = 'offline';
    elements.softwareAddNetworkProbeHost.value = '';
    elements.softwareAddDependsOn.replaceChildren();
    for (const software of state.current?.profile?.softwareCatalog ?? []) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = software.id;
      checkbox.id = `software-add-dependency-${software.id}`;
      checkbox.dataset.softwareDependency = 'true';
      checkbox.dataset.softwareName = software.name ?? software.id;
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      label.htmlFor = checkbox.id;
      const name = document.createElement('span');
      name.textContent = `${software.name ?? software.id} (${software.id})`;
      label.append(checkbox, name);
      elements.softwareAddDependsOn.append(label);
    }
    if (!elements.softwareAddDependsOn.childElementCount) {
      const empty = document.createElement('span');
      empty.className = 'field-hint';
      empty.textContent = '目前沒有可選的前置 software。';
      elements.softwareAddDependsOn.append(empty);
    }
    setAddSoftwareTemplateDefaults('msi');
    updateAddSoftwareInstallerTypeDisplay();
    updateAddSoftwareMode();
    let currentStep = 1;
    updateAddSoftwareStep(currentStep);

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
      elements.softwareAddFileBrowse.removeEventListener('click', openAddSoftwareFilePicker);
      elements.softwareAddModeTemplate.removeEventListener('change', updateAddSoftwareMode);
      elements.softwareAddModeRaw.removeEventListener('change', updateAddSoftwareMode);
      elements.softwareAddNetworkRequirement.removeEventListener('change', updateAddSoftwareNetworkMode);
      elements.softwareAddDependsOn.removeEventListener('change', refreshReview);
      elements.softwareAddRawTemplate.removeEventListener('click', insertAddSoftwareRawTemplate);
      elements.softwareAddBack.removeEventListener('click', previous);
      elements.softwareAddNext.removeEventListener('click', next);
      if (isDialogOpen(elements.softwareAddDialog)) {
        closeDialog(elements.softwareAddDialog);
      }
      resolve(value);
    };
    const cancel = (event) => {
      event?.preventDefault();
      done(null);
    };
    const refreshReview = () => {
      if (!elements.softwareAddStepRequirements.hidden) {
        updateAddSoftwareReview();
      }
    };
    const showError = (error) => {
      elements.softwareAddError.textContent = error;
    };
    const next = () => {
      const error = validateAddSoftwareStep(currentStep);
      if (error) {
        showError(error);
        return;
      }
      elements.softwareAddError.textContent = '';
      currentStep = Math.min(3, currentStep + 1);
      updateAddSoftwareStep(currentStep);
    };
    const previous = () => {
      elements.softwareAddError.textContent = '';
      currentStep = Math.max(1, currentStep - 1);
      updateAddSoftwareStep(currentStep);
    };
    const submit = (event) => {
      event.preventDefault();
      if (currentStep !== 3) {
        next();
        return;
      }
      const input = collectAddSoftwareInput();
      const error = validateAddSoftwareInput(input);
      if (error) {
        showError(error);
        return;
      }
      done(input);
    };

    elements.softwareAddForm.addEventListener('submit', submit);
    elements.softwareAddCancel.addEventListener('click', cancel);
    elements.softwareAddCancelSecondary.addEventListener('click', cancel);
    elements.softwareAddDialog.addEventListener('cancel', cancel);
    elements.softwareAddFile.addEventListener('change', updateAddSoftwareInstallerDefaults);
    elements.softwareAddFileBrowse.addEventListener('click', openAddSoftwareFilePicker);
    elements.softwareAddModeTemplate.addEventListener('change', updateAddSoftwareMode);
    elements.softwareAddModeRaw.addEventListener('change', updateAddSoftwareMode);
    elements.softwareAddNetworkRequirement.addEventListener('change', updateAddSoftwareNetworkMode);
    elements.softwareAddDependsOn.addEventListener('change', refreshReview);
    elements.softwareAddRawTemplate.addEventListener('click', insertAddSoftwareRawTemplate);
    elements.softwareAddBack.addEventListener('click', previous);
    elements.softwareAddNext.addEventListener('click', next);
    openDialog(elements.softwareAddDialog);
    elements.softwareAddName.focus();
  });
}

export function showSoftwareAddedDialog(software) {
  return new Promise((resolve) => {
    elements.softwareAddSuccessName.textContent = `${software.name} (${software.id})`;
    let settled = false;
    const done = (action = null) => {
      if (settled) {
        return;
      }
      settled = true;
      elements.softwareAddSuccessAnother.removeEventListener('click', addAnother);
      elements.softwareAddSuccessProfile.removeEventListener('click', openProfile);
      elements.softwareAddSuccessClose.removeEventListener('click', close);
      elements.softwareAddSuccessDialog.removeEventListener('cancel', close);
      if (isDialogOpen(elements.softwareAddSuccessDialog)) {
        closeDialog(elements.softwareAddSuccessDialog);
      }
      resolve(action);
    };
    const addAnother = () => done('another');
    const openProfile = () => done('profile');
    const close = (event) => {
      event?.preventDefault();
      done();
    };
    elements.softwareAddSuccessAnother.addEventListener('click', addAnother);
    elements.softwareAddSuccessProfile.addEventListener('click', openProfile);
    elements.softwareAddSuccessClose.addEventListener('click', close);
    elements.softwareAddSuccessDialog.addEventListener('cancel', close);
    openDialog(elements.softwareAddSuccessDialog);
    elements.softwareAddSuccessProfile.focus();
  });
}

export function showAddScriptDialog() {
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
        scriptId: elements.scriptAddId.value.trim(),
        name: elements.scriptAddName.value.trim(),
        file: elements.scriptAddFile.files?.[0] ?? null,
      };
      const idError = validateHumanCatalogId(input.scriptId, 'Script ID');
      if (idError) {
        elements.scriptAddError.textContent = idError;
        return;
      }
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

export async function handleScriptAdd(input) {
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
        scriptId: input.scriptId,
        name: input.name,
      }),
    });
    state.current = createPayload.state;
    state.selectedRunId = createPayload.state?.selectedRunId ?? state.selectedRunId;
    render();
    showOperationNotice(
      `Added ${createPayload.result.script.name} (${createPayload.result.script.id}) to the custom scripts catalog.`,
      'Select it in a deployment profile before publishing.',
    );
  } catch (error) {
    showOperationError(error);
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
}

export async function handleScriptDelete(script) {
  const usedByProfiles = script.usedByProfiles?.map((profile) => profile.name) ?? [];
  if (usedByProfiles.length) {
    showOperationError({
      message: `Remove ${script.name || script.id} from profiles first.`,
      action: `Used by: ${usedByProfiles.join(', ')}`,
    });
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

export async function showScriptContentViewer(script) {
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

export function confirmAction({ title, message, details = [], confirmLabel = 'Continue', danger = false, severity = null, allowDuringSoftwareTest = false }) {
  return new Promise((resolve) => {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmSubmit.textContent = confirmLabel;
    const resolvedSeverity = severity ?? (danger ? 'danger' : 'neutral');
    elements.confirmSubmit.classList.toggle('danger', resolvedSeverity === 'danger');
    elements.confirmSubmit.classList.toggle('warning', resolvedSeverity === 'warning');
    elements.confirmSubmit.dataset.operationAllowed = allowDuringSoftwareTest ? 'abort' : '';
    elements.confirmSubmit.dataset.operationReady = String(allowDuringSoftwareTest);
    if (allowDuringSoftwareTest) {
      elements.confirmSubmit.disabled = false;
      delete elements.confirmSubmit.dataset.busyDisabled;
    }
    elements.confirmDetails.replaceChildren();
    for (const detail of details) {
      const item = document.createElement('li');
      item.textContent = detail;
      elements.confirmDetails.append(item);
    }
    const close = () => {
      elements.confirmDialog.removeEventListener('close', onClose);
      delete elements.confirmSubmit.dataset.operationAllowed;
      delete elements.confirmSubmit.dataset.operationReady;
      resolve(elements.confirmDialog.returnValue === 'ok');
    };
    const onClose = () => close();
    elements.confirmDialog.addEventListener('close', onClose);
    openDialog(elements.confirmDialog);
  });
}

export async function showPicker(title, rows, onPick, buttonLabel = 'Select') {
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

export async function confirmEndpointSync(choice) {
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
    state.guidedConsoleAttentionAction = 'endpoint-sync';
    state.guidedConsoleAttentionShown = false;
    openDialog(elements.initializationDialog);
    render();
  }
  try {
    await mutate('/api/endpoint', choice, { alertOnError: !returnToInitialization });
  } finally {
    if (returnToInitialization) {
      state.endpointSyncReturnToInitialization = false;
      state.initializationPendingAction = null;
      state.guidedConsoleAttentionAction = null;
      state.guidedConsoleAttentionShown = false;
      openDialog(elements.initializationDialog);
      render();
    }
  }
}
