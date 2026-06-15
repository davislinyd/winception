import { api, loadInterfaces, loadOsDownloadCatalog, mutate, refresh } from './api.js';
import { currentInterfaceChoice, fillImportMetadataDefaults, importMetadataFromInputs, showValidationEvidence } from './deploy.js';
import { closeDialog, confirmAction, confirmEndpointSync, handleScriptAdd, openDialog, showAddProfileDialog, showAddScriptDialog, showAddSoftwareDialog, showPicker, showSoftwareDialog } from './dialogs.js';
import { $, elements } from './dom.js';
import { osImageLabel } from './format.js';
import { render, renderFleetExpandedState } from './render.js';
import { confirmPrepareRuntime } from './setup.js';
import { state } from './state.js';
import { setControlsDisabled } from './ui.js';

export function setFleetExpanded(expanded) {
  if (state.fleetExpanded === expanded) {
    return;
  }
  state.fleetExpanded = expanded;
  renderFleetExpandedState();
}

export function switchToView(viewName) {
  if (state.currentView === viewName) {
    return;
  }
  state.currentView = viewName;
  localStorage.setItem('winception-view', viewName);
  if (viewName === 'guided' && !state.selectedGuidedStepId && state.current?.initialization?.nextStepId) {
    state.selectedGuidedStepId = state.current.initialization.nextStepId;
  }
  render();
}

export async function handleProfileDelete(profile) {
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

export async function handleProfileSelect(profile) {
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

export async function handleSoftwareDelete(software) {
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

export async function handleAction(action, source = null) {
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
