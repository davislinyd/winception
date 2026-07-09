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

const iconPaths = {
  add: ['M12 5v14', 'M5 12h14'],
  analytics: ['M4 19V9', 'M10 19V5', 'M16 19v-7', 'M3 19h18'],
  arrow_forward: ['M5 12h14', 'M13 6l6 6-6 6'],
  check: ['M5 13l4 4L19 7'],
  check_circle: ['M9 12l2 2 4-5', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  checklist: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6l1 1 2-2', 'M4 12l1 1 2-2', 'M4 18l1 1 2-2'],
  chevron_left: ['M15 18l-6-6 6-6'],
  chevron_right: ['M9 18l6-6-6-6'],
  close_fullscreen: ['M9 9H5V5', 'M5 9l5-5', 'M15 15h4v4', 'M19 15l-5 5'],
  content_copy: ['M8 8h10v12H8z', 'M6 16H4V4h10v2'],
  delete: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  deployed_code_update: ['M4 8l8-4 8 4-8 4-8-4z', 'M4 12l8 4 8-4', 'M12 16v4', 'M16 18l-4 4-4-4'],
  download: ['M12 4v10', 'M7 9l5 5 5-5', 'M5 20h14'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13 7l4 4'],
  expand_less: ['M6 15l6-6 6 6'],
  expand_more: ['M6 9l6 6 6-6'],
  health_metrics: ['M4 13h4l2-6 4 12 2-6h4'],
  hub: ['M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M12 9V4', 'M12 15v5', 'M9.5 13.5 5 17', 'M14.5 13.5 19 17'],
  keyboard_arrow_down: ['M7 10l5 5 5-5'],
  keyboard_arrow_up: ['M7 14l5-5 5 5'],
  lock: ['M6 10h12v10H6z', 'M8 10V7a4 4 0 0 1 8 0v3'],
  menu_book: ['M4 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4z', 'M20 5h-6a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h6z'],
  open_in_full: ['M4 10V4h6', 'M4 4l7 7', 'M20 14v6h-6', 'M20 20l-7-7'],
  play_arrow: ['M8 5v14l11-7z'],
  playlist_add_check: ['M4 6h10', 'M4 12h8', 'M4 18h8', 'M15 17l2 2 4-5'],
  refresh: ['M20 11a8 8 0 0 0-14-5l-2 2', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14 5l2-2', 'M20 20v-4h-4'],
  remove: ['M5 12h14'],
  remove_done: ['M4 7h10', 'M4 13h8', 'M16 17l2 2 4-5'],
  rocket_launch: ['M5 19l3-1 8-8 2-5-5 2-8 8-1 3z', 'M14 6l4 4', 'M6 18l-2 2', 'M11 13l-4 4'],
  search: ['M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z', 'M21 21l-4.3-4.3'],
  stop: ['M7 7h10v10H7z'],
  sync: ['M4 7h12l-3-3', 'M20 17H8l3 3', 'M16 7l-3 3', 'M8 17l3-3'],
  sync_alt: ['M4 7h14l-4-4', 'M18 7l-4 4', 'M20 17H6l4 4', 'M6 17l4-4'],
  terminal: ['M4 6h16v12H4z', 'M7 10l3 2-3 2', 'M12 15h5'],
  upload_file: ['M12 16V6', 'M7 11l5-5 5 5', 'M5 20h14'],
  warning: ['M12 4l9 16H3z', 'M12 9v5', 'M12 17h.01'],
};

export function makeIcon(name, className = '') {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.dataset.iconName = name;
  icon.classList.add('local-icon');
  className.split(/\s+/u).filter(Boolean).forEach((token) => {
    if (!token.startsWith('text-[')) {
      icon.classList.add(token);
    }
  });
  const paths = iconPaths[name] ?? ['M5 5h14v14H5z'];
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    icon.append(path);
  }
  return icon;
}

export function hydrateStaticIcons(root = document) {
  root.querySelectorAll('.material-symbols-outlined').forEach((placeholder) => {
    const iconName = placeholder.textContent.trim();
    if (!iconName) {
      return;
    }
    const className = [...placeholder.classList]
      .filter((token) => token !== 'material-symbols-outlined' && token !== 'filled')
      .join(' ');
    placeholder.replaceWith(makeIcon(iconName, className));
  });
}

export function hydrateActionIcons(root = document) {
  root.querySelectorAll('button[data-icon], a[data-icon]').forEach((control) => {
    const iconName = control.dataset.icon;
    if (!iconName) {
      return;
    }
    const existing = control.querySelector(':scope > .local-action-icon');
    if (existing?.dataset.iconName === iconName) {
      return;
    }
    existing?.remove();
    const icon = makeIcon(iconName, 'local-action-icon');
    control.prepend(icon);
  });
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
    hydrateActionIcons(button.parentElement ?? document);
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
  const icon = button.querySelector('.local-icon, .material-symbols-outlined');
  if (icon) {
    icon.replaceWith(makeIcon('check', 'local-action-icon'));
  }
  button.title = 'Copied';
  button.setAttribute('aria-label', 'Copied');
  window.setTimeout(() => {
    if (!button.isConnected) {
      return;
    }
    const currentIcon = button.querySelector('.local-icon');
    currentIcon?.replaceWith(makeIcon('content_copy', 'local-action-icon'));
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
