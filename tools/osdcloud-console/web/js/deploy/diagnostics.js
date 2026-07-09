import { elements } from '../dom.js';
import { localCompactDateTime, text } from '../format.js';

function diagnosticsTone(status) {
  if (status === 'fail') {
    return 'fail';
  }
  if (status === 'warn') {
    return 'warn';
  }
  if (status === 'pass') {
    return 'ok';
  }
  return 'neutral';
}

export function makeDiagnosticsButton({
  label = 'Run diagnostics',
  scope = 'full',
  runId = '',
  trigger = 'manual',
  icon = 'health_metrics',
  className = 'warning',
} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.action = 'diagnostics-run';
  button.dataset.diagnosticsScope = scope;
  button.dataset.diagnosticsTrigger = trigger;
  button.dataset.icon = icon;
  if (runId) {
    button.dataset.diagnosticsRunId = runId;
  }
  button.textContent = label;
  return button;
}

export function renderDiagnosticsSummary(appState) {
  if (!elements.diagnosticsStatusBadge || !elements.diagnosticsHeadline || !elements.diagnosticsSummary) {
    return;
  }
  const diagnostics = appState.diagnostics ?? null;
  elements.diagnosticsSummary.replaceChildren();
  elements.diagnosticsDownloadButton.disabled = true;
  delete elements.diagnosticsDownloadButton.dataset.bundleName;

  if (!diagnostics) {
    elements.diagnosticsStatusBadge.textContent = 'No data';
    elements.diagnosticsStatusBadge.className = 'status-pill neutral';
    elements.diagnosticsHeadline.textContent = 'No diagnostics bundle has been generated yet.';
    const empty = document.createElement('div');
    empty.className = 'check-row unknown';
    empty.textContent = 'Run diagnostics to capture a host summary and a shareable ZIP evidence bundle.';
    elements.diagnosticsSummary.append(empty);
    return;
  }

  elements.diagnosticsStatusBadge.textContent = text(diagnostics.overallStatus, 'unknown').toUpperCase();
  elements.diagnosticsStatusBadge.className = `status-pill ${diagnosticsTone(diagnostics.overallStatus)}`;
  elements.diagnosticsHeadline.textContent = diagnostics.headline ?? 'Diagnostics completed.';

  const rows = [
    diagnostics.generatedAt ? `Generated: ${localCompactDateTime(diagnostics.generatedAt)}` : '',
    diagnostics.probableCause ? `Probable cause: ${diagnostics.probableCause}` : '',
    diagnostics.recommendedAction ? `Recommended action: ${diagnostics.recommendedAction}` : '',
    diagnostics.bundleName ? `Bundle: ${diagnostics.bundleName}` : '',
  ].filter(Boolean);
  for (const line of rows) {
    const row = document.createElement('div');
    row.className = `check-row ${diagnosticsTone(diagnostics.overallStatus)}`;
    row.textContent = line;
    elements.diagnosticsSummary.append(row);
  }

  if (diagnostics.bundleName) {
    elements.diagnosticsDownloadButton.disabled = false;
    elements.diagnosticsDownloadButton.dataset.bundleName = diagnostics.bundleName;
  }
}
