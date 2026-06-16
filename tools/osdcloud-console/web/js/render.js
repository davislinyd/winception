import { renderBootMode, renderDashboardTiles, renderDhcpMode, renderDriverPackCache, renderEndpointSummary, renderInterfaces, renderLiveMetrics, renderLogs, renderOperation, renderOsImageSummary, renderOsImages, renderPayload, renderPipeline, renderPreflightSummary, renderProfileSummary, renderProfiles, renderRuntimeReadiness, renderScriptCatalog, renderServices, renderSoftwareCatalog, renderStatusStrip, renderSummaryBar, renderSync, renderTopology, renderValidation, renderWarningBanner } from './deploy.js';
import { $, elements } from './dom.js';
import { renderFleetCards } from './fleet.js';
import { endpointLabel, localTime } from './format.js';
import { renderInitialization } from './setup.js';
import { state } from './state.js';
import { renderConsoleDock, setControlsDisabled } from './ui.js';

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

export function render() {
  const appState = state.current;
  if (!appState) {
    return;
  }
  renderFleetExpandedState();
  elements.appVersion.textContent = appState.app?.version ? `v${appState.app.version}` : '';
  elements.endpointLine.textContent = endpointLabel(appState.config);
  elements.updatedAt.textContent = `Updated ${localTime(appState.generatedAt)}`;
  renderWarningBanner(appState);
  renderOperation(appState);
  renderEndpointSummary(appState);
  renderRuntimeReadiness(appState);
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
  setControlsDisabled(state.busy || appState.operation?.running === true);
}
