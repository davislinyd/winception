function selectedSet(selectedIds) {
  if (selectedIds instanceof Set) {
    return new Set([...selectedIds].map(String));
  }
  return new Set((selectedIds ?? []).map(String));
}

export function formatSoftwareCheckboxRow(software, selectedIds) {
  const mark = selectedSet(selectedIds).has(software.id) ? 'x' : ' ';
  return `[${mark}] ${software.id} - ${software.name ?? software.id}`;
}

export function formatSoftwareCheckboxRows(software, selectedIds) {
  return software.map((item) => formatSoftwareCheckboxRow(item, selectedIds));
}

export function orderedSoftwareSelection(software, selectedIds) {
  const selected = selectedSet(selectedIds);
  return software
    .map((item) => item.id)
    .filter((id) => selected.has(id));
}

export function toggleSoftwareSelection(software, selectedIds, softwareId) {
  const selected = selectedSet(selectedIds);
  if (selected.has(softwareId)) {
    selected.delete(softwareId);
  } else {
    selected.add(softwareId);
  }
  return orderedSoftwareSelection(software, selected);
}

export function applySoftwareCheckboxKey(software, selectedIds, keyName, currentSoftwareId) {
  if (keyName === 'space') {
    return currentSoftwareId ? toggleSoftwareSelection(software, selectedIds, currentSoftwareId) : selectedIds;
  }
  if (keyName === 'a') {
    return software.map((item) => item.id);
  }
  if (keyName === 'n') {
    return [];
  }
  return selectedIds;
}

export function formatDeploymentProfileListChoice(profile) {
  const software = profile.softwareIds.length ? profile.softwareIds.join(',') : 'none';
  return `${profile.name} (${profile.id}) software=${software}`;
}

export function formatDeploymentProfileDeleteChoice(profile) {
  return `${profile.name} (${profile.id})`;
}

export function validateProfileTextInput(input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) {
    return { ok: false, message: 'Profile name is required' };
  }
  return { ok: true, name };
}
