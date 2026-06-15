import { $, $$, elements } from './dom.js';
import { text } from './format.js';
import { state } from './state.js';

export function setControlsDisabled(disabled) {
  $$('button[data-action], dialog button, dialog input, dialog select, dialog textarea').forEach((control) => {
    if (control instanceof HTMLButtonElement && control.value === 'cancel') {
      return;
    }
    if (disabled) {
      if (!control.disabled) {
        control.dataset.busyDisabled = 'true';
      }
      control.disabled = true;
    } else if (control.dataset.busyDisabled === 'true') {
      control.disabled = false;
      delete control.dataset.busyDisabled;
    }
  });
}

export function setDefinitionList(element, rows) {
  element.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = text(value);
    element.append(dt, dd);
  }
}

export function setDefinitionListNodes(element, rows) {
  element.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (value instanceof Node) {
      dd.append(value);
    } else {
      dd.textContent = text(value);
    }
    element.append(dt, dd);
  }
}

export function makeStatusPill(label, status = 'neutral') {
  const pill = document.createElement('span');
  pill.className = `status-pill ${status}`;
  pill.textContent = label;
  return pill;
}

export function makeIcon(name, className = '') {
  const icon = document.createElement('span');
  icon.className = `material-symbols-outlined ${className}`.trim();
  icon.textContent = name;
  return icon;
}

export function actionButtons(action) {
  return $$(`button[data-action="${action}"]`);
}

export function setActionLabel(action, label) {
  actionButtons(action).forEach((button) => {
    button.textContent = label;
  });
}

export function setActionIcon(action, icon) {
  actionButtons(action).forEach((button) => {
    button.dataset.icon = icon;
  });
}

export function setActionRunning(action, running) {
  actionButtons(action).forEach((button) => {
    button.classList.toggle('is-running', running);
    button.dataset.running = running ? 'true' : 'false';
  });
}

export function setActionDanger(action, danger) {
  actionButtons(action).forEach((button) => {
    button.classList.toggle('danger', danger);
  });
}

export function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('Copy failed.');
  }
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose Clipboard API but deny this call.
    }
  }
  fallbackCopyText(text);
}

export async function copyConsoleLog(button) {
  const logText = elements.logs?.textContent ?? '';
  if (!logText) {
    return;
  }
  await copyText(logText);
  const icon = button.querySelector('.material-symbols-outlined');
  if (icon) {
    icon.textContent = 'done';
  }
  button.title = 'Copied';
  button.setAttribute('aria-label', 'Copied');
  window.setTimeout(() => {
    if (!button.isConnected) {
      return;
    }
    if (icon) {
      icon.textContent = 'content_copy';
    }
    button.title = 'Copy log';
    button.setAttribute('aria-label', 'Copy log');
  }, 1200);
}

export function setSetupRailCollapsed(collapsed) {
  state.setupRailCollapsed = collapsed;
  if (elements.deployGrid) {
    elements.deployGrid.classList.toggle('setup-collapsed', collapsed);
  }
  elements.setupRailCollapse?.setAttribute('aria-expanded', String(!collapsed));
}

export function setConsoleDockCollapsed(collapsed) {
  state.consoleDockCollapsed = collapsed;
  if (elements.consoleDock) {
    elements.consoleDock.classList.toggle('collapsed', collapsed);
  }
  elements.consoleDockHead?.setAttribute('aria-expanded', String(!collapsed));
  if (!collapsed && elements.logs) {
    elements.logs.scrollTop = elements.logs.scrollHeight;
  }
}

export function renderConsoleDock(appState) {
  if (!elements.consoleDock) {
    return;
  }
  const operation = appState.operation ?? null;
  const pending = state.initializationPendingAction;
  const running = operation?.running === true || Boolean(pending);
  const label = operation?.label ?? (pending ? 'Starting operation...' : '');
  elements.consoleOpLabel.textContent = label;
  let statusText = 'Idle';
  let statusClass = 'neutral';
  if (running) {
    statusText = 'Running';
    statusClass = 'working';
  } else if (operation?.status === 'failed') {
    statusText = 'Failed';
    statusClass = 'fail';
  } else if (operation?.status === 'completed') {
    statusText = 'Completed';
    statusClass = 'ok';
  }
  elements.consoleOpBadge.textContent = statusText;
  elements.consoleOpBadge.className = `status-pill ${statusClass}`;
  if (elements.consoleOpError) {
    const showError = Boolean(operation?.error) && !running;
    elements.consoleOpError.hidden = !showError;
    elements.consoleOpError.textContent = showError ? operation.error : '';
  }
  // Auto-expand once per operation so output is visible without leaving the view;
  // a manual collapse during the run is respected until the next operation starts.
  const operationKey = operation
    ? `${operation.label}|${operation.startedAt ?? ''}`
    : pending ? `pending:${pending}` : '';
  if (running && operationKey !== state.consoleDockOperationKey) {
    state.consoleDockOperationKey = operationKey;
    setConsoleDockCollapsed(false);
    return;
  }
  state.consoleDockOperationKey = operationKey;
  elements.consoleDock.classList.toggle('collapsed', state.consoleDockCollapsed);
  elements.consoleDockHead?.setAttribute('aria-expanded', String(!state.consoleDockCollapsed));
}

// Setup steps that remain re-runnable after initial completion
