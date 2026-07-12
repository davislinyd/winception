import { api, loadInterfaces, loadOsDownloadCatalog, mutate, refresh } from './api.js';
import { currentInterfaceChoice, fillImportMetadataDefaults, importMetadataFromInputs, showValidationEvidence } from './deploy.js';
import { closeDialog, confirmAction, confirmEndpointSync, handleScriptAdd, openDialog, showAddProfileDialog, showAddScriptDialog, showAddSoftwareDialog, showPicker, showSoftwareAddedDialog, showSoftwareDialog, showSoftwareTestDialog } from './dialogs.js';
import { $, elements } from './dom.js';
import { visibleFleetRuns } from './fleet.js';
import { osImageLabel } from './format.js';
import { render, renderFleetExpandedState } from './render.js';
import { confirmPrepareRuntime } from './setup.js';
import { state } from './state.js';
import { setControlsDisabled, setSetupRailCollapsed } from './ui.js';

export function setFleetExpanded(expanded) {
  if (state.fleetExpanded === expanded) {
    return;
  }
  state.fleetExpanded = expanded;
  renderFleetExpandedState();
}

export function switchToView(viewName) {
  const normalizedView = viewName === 'prepare' || viewName === 'guided' ? 'dashboard' : viewName;
  if (state.currentView === normalizedView) {
    if (viewName === 'prepare' || viewName === 'guided') {
      setSetupRailCollapsed(false);
      state.guidedStepCollapsed = false;
      render();
    }
    return;
  }
  state.currentView = normalizedView;
  localStorage.setItem('winception-view', normalizedView);
  if (viewName === 'prepare' || viewName === 'guided') {
    setSetupRailCollapsed(false);
    state.guidedStepCollapsed = false;
  }
  if ((viewName === 'guided' || viewName === 'prepare') && !state.selectedGuidedStepId && state.current?.initialization?.nextStepId) {
    state.selectedGuidedStepId = state.current.initialization.nextStepId;
  }
  render();
}

export async function handleProfileDelete(profile) {
  const ok = await confirmAction({
    title: 'Delete inactive profile',
    message: 'This removes only an inactive deployment profile JSON file. Active profiles cannot be deleted.',
    details: [`Profile: ${profile.name}`],
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) {
    await mutate('/api/profiles/delete', { profileId: profile.id });
  }
}

export async function handleProfileSelect(profile) {
  const ok = await confirmAction({
    title: 'Select deployment profile',
    message: 'This stops services, writes the active profile, replaces the live Apps payload, and reruns preflight.',
    details: [`Profile: ${profile.name}`, `Software: ${profile.softwareIds?.join(', ') || 'none'}`],
    confirmLabel: 'Set active',
    severity: 'warning',
  });
  if (ok) {
    await mutate('/api/profile', { profileId: profile.id });
  }
}

export async function handleOsImageDelete(image) {
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

export async function handleOsImageReexport(image) {
  const ok = await confirmAction({
    title: 'Re-export OS image',
    message: 'This replaces the cached WIM by re-exporting from the already-downloaded source ESD using the corrected edition index. Profile references are preserved — no need to delete the image first.',
    details: [`OS: ${osImageLabel(image)}`, `File: ${image.fileName}`],
    confirmLabel: 'Re-export',
    severity: 'warning',
  });
  if (ok) {
    if (state.osDownloadStarting || state.current?.osDownloadStatus?.running) {
      return;
    }
    state.osDownloadStarting = true;
    render();
    try {
      const payload = await api('/api/os-image-reexport', {
        method: 'POST',
        body: JSON.stringify({ imageId: image.id }),
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

export async function handleOsImageDownload(image) {
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

export async function handleOsImageUploadInspect() {
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

export async function handleOsImageImport(row) {
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

export async function handleSoftwareAdd(input) {
  const ok = await confirmAction({
    title: '加入 Software Catalog',
    message: '這只會建立 Softwares folder 與 catalog entry；不會 publish Apps，也不會改變 active profile。',
    details: [
      `Software: ${input.name}`,
      `Software ID: ${input.softwareId}`,
      `Installer payload: ${input.file.name}`,
      `安裝方式: ${input.scriptMode === 'template' ? 'Guided installer' : 'Custom PowerShell'}`,
      `前置 software: ${input.dependsOn?.length ? input.dependsOn.join(', ') : '無'}`,
      `Client 網路: ${input.network?.requirement === 'client-internet' ? `必須可連外 (${input.network.probeHost})` : 'Host 預載 payload'}`,
      `安裝後驗證: ${
        input.scriptMode === 'template'
          ? (input.verifyPath || '只信任 installer 回傳碼')
          : 'Custom install.ps1'
      }`,
    ],
    confirmLabel: '加入 Catalog',
    severity: 'warning',
  });
  if (!ok || state.busy) {
    return;
  }

  state.busy = true;
  setControlsDisabled(true);
  let addedSoftware = null;
  try {
    const uploadPayload = await api(`/api/software-upload?fileName=${encodeURIComponent(input.file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: input.file,
    });
    const installationFields = input.scriptMode === 'template'
      ? {
          silentArgs: input.silentArgs,
          successExitCodes: input.successExitCodes,
          verifyPath: input.verifyPath,
        }
      : { rawScript: input.rawScript };
    const createPayload = await api('/api/software/create', {
      method: 'POST',
      body: JSON.stringify({
        uploadId: uploadPayload.result.uploadId,
        softwareId: input.softwareId,
        name: input.name,
        scriptMode: input.scriptMode,
        installerType: input.installerType,
        ...installationFields,
        dependsOn: input.dependsOn,
        network: input.network,
      }),
    });
    state.current = createPayload.state;
    state.selectedRunId = createPayload.state?.selectedRunId ?? state.selectedRunId;
    render();
    addedSoftware = createPayload.result.software;
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.busy = false;
    setControlsDisabled(false);
  }
  if (!addedSoftware) {
    return;
  }
  const followUp = await showSoftwareAddedDialog(addedSoftware);
  if (followUp === 'profile') {
    openDialog(elements.deploymentProfilesDialog);
    return;
  }
  if (followUp === 'another') {
    const nextInput = await showAddSoftwareDialog();
    if (nextInput) {
      await handleSoftwareAdd(nextInput);
    }
  }
}

export async function handleSoftwareDelete(software) {
  const usedByProfiles = software.usedByProfiles?.map((profile) => profile.name) ?? [];
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

export async function handleStatusRunDelete(runId) {
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

// ---- Activity multi-select (bulk delete / archive / restore) ----

export function clearFleetSelection() {
  state.selectedRunIds = [];
  state.selectAnchorRunId = null;
}

export function toggleFleetSelection(runId) {
  if (!runId) {
    return;
  }
  const selected = new Set(state.selectedRunIds);
  if (selected.has(runId)) {
    selected.delete(runId);
  } else {
    selected.add(runId);
  }
  state.selectedRunIds = [...selected];
  state.selectAnchorRunId = runId;
}

// Resolve which card click handling to apply. Plain click focuses a card and
// resets the multi-selection; shift extends a range from the anchor; ctrl/meta
// toggles a single card. Range order follows exactly what the user sees.
export function selectFleetCard(runId, event) {
  if (!runId) {
    return;
  }
  if (state.fleetFilter === 'archived') {
    state.selectedArchivedRunId = runId;
  } else {
    state.selectedRunId = runId;
  }

  if (event?.shiftKey && state.selectAnchorRunId) {
    const order = visibleFleetRuns(state.current ?? {}).runs.map((run) => run.runId);
    const from = order.indexOf(state.selectAnchorRunId);
    const to = order.indexOf(runId);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      state.selectedRunIds = order.slice(lo, hi + 1);
      return;
    }
  }
  if (event && (event.ctrlKey || event.metaKey)) {
    toggleFleetSelection(runId);
    return;
  }
  state.selectedRunIds = [runId];
  state.selectAnchorRunId = runId;
}

function uniqueRunIds(runIds) {
  return [...new Set((runIds ?? []).filter(Boolean))];
}

function runIdDetails(runIds) {
  const shown = runIds.slice(0, 8).map((id) => `Run: ${id}`);
  if (runIds.length > 8) {
    shown.push(`…and ${runIds.length - 8} more`);
  }
  return shown;
}

function reportBulkFailures(payload, verb) {
  const failed = (payload?.result?.results ?? []).filter((item) => !item.ok);
  if (failed.length) {
    window.alert(`${failed.length} run(s) could not be ${verb}:\n${failed.map((item) => `${item.runId}: ${item.error}`).join('\n')}`);
  }
}

export async function handleStatusRunsDelete(runIds) {
  const ids = uniqueRunIds(runIds);
  if (!ids.length) {
    return;
  }
  const ok = await confirmAction({
    title: `Delete ${ids.length} client run${ids.length === 1 ? '' : 's'}`,
    message: 'This permanently removes the selected Client Fleet rows and their per-run status artifacts. Clients still reporting may reappear. To keep the evidence, archive them instead.',
    details: runIdDetails(ids),
    confirmLabel: `Delete ${ids.length}`,
    danger: true,
  });
  if (!ok) {
    return;
  }
  const payload = await mutate('/api/status/runs/delete', { runIds: ids });
  if (payload?.state) {
    clearFleetSelection();
    state.clientFleetSignature = '';
    closeDialog(elements.validationEvidenceDialog);
    reportBulkFailures(payload, 'deleted');
    render();
  }
}

export async function handleStatusRunsArchive(runIds) {
  const ids = uniqueRunIds(runIds);
  if (!ids.length) {
    return;
  }
  const ok = await confirmAction({
    title: `Archive ${ids.length} client run${ids.length === 1 ? '' : 's'}`,
    message: 'Archived runs move out of Activity but keep all their status artifacts. Restore them anytime from the Archived filter.',
    details: runIdDetails(ids),
    confirmLabel: `Archive ${ids.length}`,
    severity: 'warning',
  });
  if (!ok) {
    return;
  }
  const payload = await mutate('/api/status/runs/archive', { runIds: ids });
  if (payload?.state) {
    clearFleetSelection();
    state.clientFleetSignature = '';
    closeDialog(elements.validationEvidenceDialog);
    reportBulkFailures(payload, 'archived');
    render();
  }
}

export async function handleStatusRunsRestore(runIds) {
  const ids = uniqueRunIds(runIds);
  if (!ids.length) {
    return;
  }
  const ok = await confirmAction({
    title: `Restore ${ids.length} archived run${ids.length === 1 ? '' : 's'}`,
    message: 'Restored runs move back into the active Activity list.',
    details: runIdDetails(ids),
    confirmLabel: `Restore ${ids.length}`,
    severity: 'warning',
  });
  if (!ok) {
    return;
  }
  const payload = await mutate('/api/status/runs/restore', { runIds: ids });
  if (payload?.state) {
    clearFleetSelection();
    state.clientFleetSignature = '';
    reportBulkFailures(payload, 'restored');
    render();
  }
}

export async function handleArchivedRunsDelete(runIds) {
  const ids = uniqueRunIds(runIds);
  if (!ids.length) {
    return;
  }
  const ok = await confirmAction({
    title: `Permanently delete ${ids.length} archived run${ids.length === 1 ? '' : 's'}`,
    message: 'This permanently removes the selected archived runs and their status artifacts. This cannot be undone.',
    details: runIdDetails(ids),
    confirmLabel: `Delete ${ids.length}`,
    danger: true,
  });
  if (!ok) {
    return;
  }
  const payload = await mutate('/api/status/archive/delete', { runIds: ids });
  if (payload?.state) {
    clearFleetSelection();
    reportBulkFailures(payload, 'deleted');
    render();
  }
}

async function handleDiagnosticsRun(source) {
  const scope = source?.dataset?.diagnosticsScope ?? 'full';
  const runId = source?.dataset?.diagnosticsRunId ?? source?.dataset?.runId ?? undefined;
  const trigger = source?.dataset?.diagnosticsTrigger ?? (scope === 'run' ? 'manual-run' : 'manual');
  await mutate('/api/diagnostics/run', {
    scope,
    ...(runId ? { runId } : {}),
    trigger,
  });
}

function handleDiagnosticsDownload(source) {
  const bundleName = source?.dataset?.bundleName ?? state.current?.diagnostics?.bundleName;
  if (!bundleName) {
    window.alert('No diagnostics ZIP is available yet.');
    return;
  }
  window.open(`/api/diagnostics/download?name=${encodeURIComponent(bundleName)}`, '_blank', 'noopener');
}

export async function handleFleetBulkAction(action) {
  if (action === 'bulk-select-all') {
    const order = visibleFleetRuns(state.current ?? {}).runs.map((run) => run.runId);
    state.selectedRunIds = order;
    state.selectAnchorRunId = order[0] ?? null;
    render();
    return;
  }
  if (action === 'bulk-clear') {
    clearFleetSelection();
    render();
    return;
  }
  const ids = [...state.selectedRunIds];
  if (action === 'bulk-archive') {
    await handleStatusRunsArchive(ids);
  } else if (action === 'bulk-delete') {
    await handleStatusRunsDelete(ids);
  } else if (action === 'bulk-restore') {
    await handleStatusRunsRestore(ids);
  } else if (action === 'bulk-archived-delete') {
    await handleArchivedRunsDelete(ids);
  }
}

export async function handleAction(action, source = null) {
  const services = state.current?.services ?? {};
  if (action === 'run-evidence') {
    const runId = source?.dataset?.runId ?? source?.closest?.('[data-run-id]')?.dataset?.runId;
    showValidationEvidence(runId);
  } else if (action === 'initialization') {
    openDialog(elements.initializationDialog);
  } else if (action === 'preflight') {
    await mutate('/api/preflight');
  } else if (action === 'diagnostics-run') {
    await handleDiagnosticsRun(source);
  } else if (action === 'diagnostics-download') {
    handleDiagnosticsDownload(source);
  } else if (action === 'offline-iso-create') {
    const outputDirectory = state.current?.offlineIsoStatus?.outputDirectory
      ?? `${state.current?.config?.workspace?.runtimeRoot ?? 'C:\\OSDCloud'}\\Exports`;
    const ok = await confirmAction({
      title: 'Create offline ISO',
      message: 'This creates a host-side ISO snapshot from the current active deployment state. The output media contains extractable deployment credentials.',
      details: [
        `Output folder: ${outputDirectory}`,
        'Source: active profile + active deployable OS image',
      ],
      confirmLabel: 'Create ISO',
      severity: 'warning',
    });
    if (ok) {
      await mutate('/api/offline-iso/create', {});
    }
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
  } else if (action === 'software-test-toggle') {
    const expanded = elements.softwareTestContent.hidden;
    elements.softwareTestContent.hidden = !expanded;
    elements.softwareTestToggle.textContent = expanded ? '收合' : '展開';
    elements.softwareTestToggle.setAttribute('aria-expanded', String(expanded));
  } else if (action === 'software-test-settings') {
    const input = await showSoftwareTestDialog(state.current?.softwareTest?.configuration ?? {});
    if (input) {
      await mutate('/api/software-test/config', input);
    }
  } else if (action === 'profile-test') {
    const profileId = source?.dataset?.profileId;
    const profile = state.current?.profile?.profiles?.find((item) => item.id === profileId);
    if (!profile) {
      window.alert('找不到 Deployment profile。');
      return;
    }
    const ok = await confirmAction({
      title: '測試此 profile 的 software',
      message: '系統會還原專用乾淨 VM、以 SYSTEM 執行此 profile 的 software、收集安全摘要，再還原快照。不會 publish live Apps，也不會變更 active profile。',
      details: [
        'Profile：' + profile.name,
        'Software：' + (profile.softwareIds?.join(', ') || '無'),
        'Test VM：' + (state.current?.softwareTest?.configuration?.vmName || '-'),
      ],
      confirmLabel: '開始測試',
      severity: 'warning',
    });
    if (ok) {
      await mutate('/api/software-test/run', { profileId: profile.id });
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
              `Profile: ${profileUpdate.name}`,
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
      title: profile.name,
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
  } else if (action === 'torrent-release') {
    const runId = source?.dataset?.runId;
    if (runId) {
      await mutate('/api/torrent/release', { runId });
    }
  } else if (action === 'torrent-settings') {
    const input = source?.closest('.torrent-seed-settings')?.querySelector('[data-torrent-seed-setting]');
    await mutate('/api/torrent/settings', { seedMinutes: Number(input?.value) });
    state.torrentSeedMinutesDraft = '';
  } else if (action === 'torrent-extend') {
    const runId = source?.dataset?.runId;
    const input = source?.closest('td')?.querySelector(`[data-torrent-extension-run-id="${runId}"]`);
    if (runId) {
      await mutate('/api/torrent/extend', { runId, additionalMinutes: Number(input?.value) });
      delete state.torrentExtensionMinutesByRun[runId];
    }
  } else if (action === 'torrent-release-all') {
    const ok = await confirmAction({
      title: 'Continue all waiting clients',
      message: 'This stops torrent seeding on every waiting WinPE client and allows them to reboot.',
      confirmLabel: 'Continue all',
      severity: 'warning',
    });
    if (ok) {
      await mutate('/api/torrent/release', { allWaiting: true });
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
  } else if (action === 'status-run-archive') {
    await handleStatusRunsArchive([source?.dataset?.runId]);
  } else if (action === 'status-run-restore') {
    await handleStatusRunsRestore([source?.dataset?.runId]);
  } else if (action === 'archived-run-delete') {
    await handleArchivedRunsDelete([source?.dataset?.runId]);
  } else if (action === 'fleet-expand-toggle') {
    setFleetExpanded(!state.fleetExpanded);
  }
}
