import { renderBootMode, renderDashboardTiles, renderDiagnosticsSummary, renderDhcpMode, renderDriverPackCache, renderEndpointSummary, renderInterfaces, renderLiveMetrics, renderLogs, renderNetworkTopology, renderOfflineIso, renderOperation, renderOsImageSummary, renderOsImages, renderPayload, renderPipeline, renderPreflightSummary, renderProfileSummary, renderProfiles, renderRuntimeReadiness, renderScriptCatalog, renderServices, renderSoftwareCatalog, renderStatusStrip, renderSummaryBar, renderSync, renderTopology, renderValidation, renderWarningBanner } from './deploy.js';
import { $, elements } from './dom.js';
import { renderFleetCards } from './fleet.js';
import { endpointLabel, localTime } from './format.js';
import { renderInitialization } from './setup.js';
import { state } from './state.js';
import { hydrateActionIcons, renderConsoleDock, setControlsDisabled } from './ui.js';

export function renderFleetExpandedState() {
  document.body.classList.toggle('fleet-expanded', state.fleetExpanded);
  if (elements.fleetBackdrop) {
    elements.fleetBackdrop.hidden = !state.fleetExpanded;
  }
  if (!elements.fleetExpandToggle) {
    return;
  }
  elements.fleetExpandToggle.setAttribute('aria-expanded', String(state.fleetExpanded));
  elements.fleetExpandToggle.dataset.icon = state.fleetExpanded ? 'close_fullscreen' : 'open_in_full';
  elements.fleetExpandToggle.textContent = state.fleetExpanded ? 'Collapse fleet' : 'Expand fleet';
  elements.fleetExpandToggle.title = state.fleetExpanded ? 'Return to dashboard overview' : 'Expand Client Fleet';
}

function updateStatusText(update) {
  if (state.updateCheckRunning || update?.checkStatus === 'checking') {
    return 'Checking updates...';
  }
  if (state.updateCheckRequestFailed || update?.checkStatus === 'unavailable') {
    return update?.lastSuccessfulAt
      ? `Update unavailable · last verified ${localTime(update.lastSuccessfulAt)}`
      : 'Update check unavailable';
  }
  if (update?.availability === 'available' && update.latest?.version) {
    return `Update v${update.latest.version} available`;
  }
  if (update?.availability === 'current') {
    return update?.lastSuccessfulAt
      ? `No newer release · ${localTime(update.lastSuccessfulAt)}`
      : 'No newer release';
  }
  if (update?.checkStatus === 'success') {
    return 'No stable release published';
  }
  return 'Check updates';
}

function renderUpdateStatus(appState) {
  if (!elements.updateCheckButton || !elements.updateStatus || !elements.updateReleaseLink) {
    return;
  }
  const update = appState.app?.update;
  const available = update?.availability === 'available' && Boolean(update.latest?.htmlUrl);
  elements.updateCheckButton.disabled = state.updateCheckRunning;
  elements.updateCheckButton.classList.toggle('available', available);
  elements.updateCheckButton.classList.toggle('unavailable', state.updateCheckRequestFailed || update?.checkStatus === 'unavailable');
  elements.updateStatus.textContent = updateStatusText(update);
  elements.updateCheckButton.title = update?.lastSuccessfulAt
    ? `Check for updates. Last verified ${localTime(update.lastSuccessfulAt)}.`
    : 'Check for updates.';
  elements.updateReleaseLink.hidden = !available;
  elements.updateReleaseLink.href = available ? update.latest.htmlUrl : '#';
}

export function render() {
  const appState = state.current;
  if (!appState) {
    return;
  }
  renderFleetExpandedState();
  elements.appVersion.textContent = appState.app?.version ? `v${appState.app.version}` : '';
  renderUpdateStatus(appState);
  elements.endpointLine.textContent = endpointLabel(appState.config);
  elements.updatedAt.textContent = `Updated ${localTime(appState.generatedAt)}`;
  renderWarningBanner(appState);
  renderOperation(appState);
  renderEndpointSummary(appState);
  renderRuntimeReadiness(appState);
  renderDiagnosticsSummary(appState);
  renderOfflineIso(appState);
  renderServices(appState);
  renderProfileSummary(appState);
  renderOsImageSummary(appState);
  renderPreflightSummary(appState.preflight);
  renderDriverPackCache(appState);
  renderInitialization(appState);
  renderInterfaces(appState);
  renderProfiles(appState);
  renderSoftwareCatalog(appState);
  renderScriptCatalog(appState);
  renderOsImages(appState);
  renderPayload(appState);
  renderSync(appState);
  renderBootMode(appState);
  renderDhcpMode(appState);
  renderNetworkTopology(appState);
  renderValidation(appState);
  renderLogs(appState);
  renderConsoleDock(appState);
  renderPipeline(appState);
  renderTopology(appState);
  renderLiveMetrics(appState);
  renderStatusStrip(appState);
  renderSummaryBar(appState);
  renderDashboardTiles(appState);
  renderFleetCards(appState);
  hydrateActionIcons();
  setControlsDisabled(state.busy || appState.operation?.running === true, {
    preserveSoftwareTestControls: appState.softwareTest?.active?.runId != null,
  });
}
