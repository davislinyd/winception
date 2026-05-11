import blessed from 'blessed';
import fs from 'node:fs';
import { applyServiceEndpoint, loadConfig, mediaHttpServerConfig, saveConfig } from './config.js';
import { DhcpResponder } from './dhcp.js';
import { TftpResponder } from './tftp.js';
import { MediaHttpServer } from './httpServer.js';
import { formatLogLine, RingBuffer, tailFile } from './logger.js';
import { getServiceBindIps, listIpv4ServiceInterfaces, removeStatusFiles, runPreflight, syncIpxeEndpoint } from './windows.js';
import { formatFleetClientRows, formatFleetCounts, formatFleetRunDetail, formatScreenshotMetadata, formatStatusEventLine, readFleetStatus, readRecentScreenshotMetadata, readRunLatestScreenshot, readStatusEvents, summarizeValidation } from './status.js';
import { formatDisplayLogLine } from './timeFormat.js';
import { isCancelKey, isConfirmKey } from './confirmKeys.js';
import { computeLayout } from './layout.js';
import { wrapLinesWithIndent } from './textWrap.js';
import { focusOrder, focusShortcutKeyNames, formatPanelLabel, resolveFocusShortcutRequest, resolveShortcutHintRequest, resolveTabFocusTarget } from './focusKeys.js';
import { startWindowsAltKeyWatcher } from './altKeyWatcher.js';
import { nextLogAutoFollowState, resolveMouseFocusTarget, wheelDeltaForAction } from './mouseInteractions.js';
import { bindFallbackKeyboardInput, ensureKeyboardInput } from './keyboardInput.js';
import {
  createDeploymentProfile,
  deleteDeploymentProfile,
  formatSoftwareList,
  publishDeploymentProfile,
  resolveDeploymentProfileState,
  updateDeploymentProfile,
} from './deploymentProfiles.js';
import {
  applySoftwareCheckboxKey,
  formatDeploymentProfileDeleteChoice,
  formatDeploymentProfileListChoice,
  formatSoftwareCheckboxRows,
  orderedSoftwareSelection,
  validateProfileTextInput,
} from './profileEditor.js';
import { appVersion } from './version.js';

const config = loadConfig();
const dhcp = new DhcpResponder(config.dhcp);
const tftp = new TftpResponder(config.tftp);
const http = new MediaHttpServer(mediaHttpServerConfig(config));
const runtimeLog = new RingBuffer(500);
let preflightResults = [];
let dialogOpen = false;
let lastLayoutSignature = '';
let lastActionItemsSignature = '';
let wasTooSmall = false;
let selectedRunId = null;
let currentFleetRuns = [];
let renderTimer = null;
let focusedPanelId = 'actions';
let shortcutHintsVisible = false;
let shortcutHintsTimer = null;
let altKeyWatcher = null;
let logAutoFollow = true;
let observedKeypressCount = 0;
let stopKeyboardFallback = null;
let endpointUpdateStatus = [];

const horizontalPanelPadding = { left: 1, right: 1 };
const panelLabelLeftInset = 1;
const shortcutHintDurationMs = 1500;

function panelLabel(text, shortcut = '') {
  return formatPanelLabel(text, shortcut, shortcutHintsVisible);
}

function serviceActionLabel(service, label) {
  return `${service.running ? 'Stop' : 'Start'} ${label}`;
}

function getActionItems() {
  return [
    'Run preflight',
    'Select service interface',
    'Select deployment profile',
    'Add deployment profile',
    'Edit deployment profile',
    'Delete deployment profile',
    serviceActionLabel(http, 'HTTP/status'),
    serviceActionLabel(tftp, 'TFTP'),
    serviceActionLabel(dhcp, 'DHCP'),
    'Start all services',
    'Stop all services',
    'Clear status files',
    'Refresh validation',
    'Quit',
  ];
}

function pinPanelLabel(element) {
  if (element._label) {
    element._label.rleft = panelLabelLeftInset;
    // Labels need tags even when the panel body, such as Clients, stays tags:false.
    element._label.parseTags = true;
    element._label.parseContent?.();
  }
}

const screen = blessed.screen({
  smartCSR: true,
  resizeTimeout: 100,
  title: `OSDCloud iPXE TUI v${appVersion}`,
  fullUnicode: true,
});

screen.on('resize', handleTerminalResize);

const title = blessed.box({
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  wrap: false,
  style: { fg: 'white', bg: 'blue' },
  content: ` OSDCloud iPXE TUI v${appVersion} - physical laptop deployment host console`,
});

const menu = blessed.list({
  top: 3,
  left: 0,
  width: 34,
  height: '100%-3',
  keys: true,
  mouse: true,
  focusable: true,
  vi: true,
  wrap: false,
  border: 'line',
  padding: horizontalPanelPadding,
  label: panelLabel('Actions', 'A'),
  style: {
    selected: { bg: 'blue', fg: 'white' },
    item: { fg: 'white' },
    border: { fg: 'cyan' },
  },
  items: getActionItems(),
});

const servicesBox = blessed.box({
  top: 3,
  left: 34,
  width: 66,
  height: 13,
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  focusable: true,
  tags: true,
  wrap: false,
  label: panelLabel('Services', 'S'),
  style: { border: { fg: 'cyan' } },
});

const clientsBox = blessed.list({
  top: 3,
  left: 100,
  width: '100%-100',
  height: 13,
  border: 'line',
  padding: horizontalPanelPadding,
  keys: true,
  mouse: true,
  focusable: true,
  vi: true,
  tags: false,
  wrap: false,
  label: panelLabel('Clients', 'C'),
  style: {
    selected: { bg: 'blue', fg: 'white' },
    item: { fg: 'white' },
    border: { fg: 'cyan' },
  },
});

const preflightBox = blessed.box({
  top: 16,
  left: 34,
  width: 66,
  height: '38%',
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  focusable: true,
  tags: true,
  wrap: false,
  label: panelLabel('Preflight', 'P'),
  style: { border: { fg: 'cyan' } },
});

const detailsBox = blessed.box({
  top: 16,
  left: 100,
  width: '100%-100',
  height: '38%',
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  keys: true,
  mouse: true,
  focusable: true,
  tags: true,
  wrap: false,
  label: panelLabel('Client Detail', 'D'),
  style: { border: { fg: 'cyan' } },
});

const validationBox = blessed.box({
  top: 16,
  left: 34,
  width: 66,
  height: '38%',
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  keys: true,
  mouse: true,
  focusable: true,
  tags: true,
  wrap: false,
  label: panelLabel('Validation', 'V'),
  style: { border: { fg: 'cyan' } },
});

const logBox = blessed.log({
  bottom: 0,
  left: 100,
  width: '100%-100',
  height: '100%-16-38%',
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  focusable: true,
  tags: true,
  wrap: false,
  label: panelLabel('Logs', 'L'),
  style: { border: { fg: 'cyan' } },
});

const sizeWarningBox = blessed.box({
  top: 3,
  left: 0,
  width: '100%',
  height: '100%-3',
  tags: false,
  hidden: true,
  align: 'center',
  valign: 'middle',
  style: { fg: 'yellow', bg: 'black' },
});

screen.append(title);
screen.append(menu);
screen.append(servicesBox);
screen.append(clientsBox);
screen.append(preflightBox);
screen.append(detailsBox);
screen.append(validationBox);
screen.append(logBox);
screen.append(sizeWarningBox);
for (const element of [menu, servicesBox, clientsBox, preflightBox, detailsBox, validationBox, logBox]) {
  pinPanelLabel(element);
}
menu.focus();

const panelLabelSpecs = [
  [menu, 'Actions', 'A'],
  [servicesBox, 'Services', 'S'],
  [clientsBox, 'Clients', 'C'],
  [preflightBox, 'Preflight', 'P'],
  [detailsBox, 'Client Detail', 'D'],
  [validationBox, 'Validation', 'V'],
  [logBox, 'Logs', 'L'],
];

const focusTargets = {
  actions: menu,
  services: servicesBox,
  clients: clientsBox,
  preflight: preflightBox,
  details: detailsBox,
  validation: validationBox,
  logs: logBox,
};

function setFocusedPanel(targetId, { focus = true } = {}) {
  if (!focusOrder.includes(targetId)) {
    return;
  }
  const element = focusTargets[targetId];
  if (!element) {
    return;
  }
  focusedPanelId = targetId;
  if (focus) {
    element.focus();
  }
  requestRender({ immediate: true });
}

function applyFocusStyles() {
  for (const [targetId, element] of Object.entries(focusTargets)) {
    element.style.border.fg = targetId === focusedPanelId ? 'yellow' : 'cyan';
  }
}

function setPanelLabels() {
  for (const [element, title, shortcut] of panelLabelSpecs) {
    element.setLabel(panelLabel(title, shortcut));
    pinPanelLabel(element);
  }
}

function setShortcutHintsVisible(visible) {
  if (shortcutHintsVisible === visible) {
    return;
  }
  shortcutHintsVisible = visible;
  requestRender({ immediate: true });
}

function clearShortcutHints() {
  if (shortcutHintsTimer) {
    clearTimeout(shortcutHintsTimer);
    shortcutHintsTimer = null;
  }
  setShortcutHintsVisible(false);
}

function activateShortcutHints() {
  if (dialogOpen) {
    clearShortcutHints();
    return;
  }
  setShortcutHintsVisible(true);
  if (shortcutHintsTimer) {
    clearTimeout(shortcutHintsTimer);
  }
  shortcutHintsTimer = setTimeout(() => {
    shortcutHintsTimer = null;
    setShortcutHintsVisible(false);
  }, shortcutHintDurationMs);
  shortcutHintsTimer.unref?.();
}

function setAltKeyPressed(isPressed) {
  if (dialogOpen) {
    clearShortcutHints();
    return;
  }
  if (isPressed) {
    if (shortcutHintsTimer) {
      clearTimeout(shortcutHintsTimer);
      shortcutHintsTimer = null;
    }
    setShortcutHintsVisible(true);
  } else {
    clearShortcutHints();
  }
}

function focusPanelFromMouse(targetId) {
  const target = resolveMouseFocusTarget(targetId, { dialogOpen });
  if (target) {
    setFocusedPanel(target);
  }
}

function scrollBoxPanel(targetId, element, action) {
  if (dialogOpen) {
    return;
  }
  focusPanelFromMouse(targetId);
  const delta = wheelDeltaForAction(action);
  if (delta) {
    element.scroll(delta);
  }
  requestRender({ immediate: true });
}

function handleLogWheel(action) {
  if (dialogOpen) {
    return;
  }
  focusPanelFromMouse('logs');
  logAutoFollow = nextLogAutoFollowState({
    current: logAutoFollow,
    action,
    scrollPercent: logBox.getScrollPerc(),
  });
  const delta = wheelDeltaForAction(action);
  if (delta) {
    logBox.scroll(delta);
  }
  logAutoFollow = nextLogAutoFollowState({
    current: logAutoFollow,
    action,
    scrollPercent: logBox.getScrollPerc(),
  });
  requestRender({ immediate: true });
}

function updateClientSelectionFromMouse() {
  selectFleetRunByIndex(clientsBox.selected);
  focusPanelFromMouse('clients');
  requestRender({ immediate: true });
}

for (const [targetId, element] of Object.entries(focusTargets)) {
  element.on('focus', () => {
    focusedPanelId = targetId;
    requestRender({ immediate: true });
  });
  element.on('mousedown', () => focusPanelFromMouse(targetId));
}

menu.removeAllListeners('element wheelup');
menu.removeAllListeners('element wheeldown');
menu.on('element wheelup', () => focusPanelFromMouse('actions'));
menu.on('element wheeldown', () => focusPanelFromMouse('actions'));
for (const element of [servicesBox, preflightBox, detailsBox, validationBox, logBox]) {
  element.removeAllListeners('wheelup');
  element.removeAllListeners('wheeldown');
}
for (const [targetId, element] of [
  ['services', servicesBox],
  ['preflight', preflightBox],
  ['details', detailsBox],
  ['validation', validationBox],
]) {
  element.on('wheelup', () => scrollBoxPanel(targetId, element, 'wheelup'));
  element.on('wheeldown', () => scrollBoxPanel(targetId, element, 'wheeldown'));
}
clientsBox.on('element wheelup', updateClientSelectionFromMouse);
clientsBox.on('element wheeldown', updateClientSelectionFromMouse);
logBox.on('wheelup', () => handleLogWheel('wheelup'));
logBox.on('wheeldown', () => handleLogWheel('wheeldown'));
logBox.on('keypress', (_ch, key) => {
  if (dialogOpen) {
    return;
  }
  if (key?.name === 'end') {
    logBox.setScrollPerc(100);
    logAutoFollow = nextLogAutoFollowState({ current: logAutoFollow, action: 'end' });
    requestRender({ immediate: true });
  }
});
screen.program.setMouse({ vt200Mouse: true, sgrMouse: true, cellMotion: true }, true);

function applyBoxLayout(element, spec) {
  element.rtop = spec.top;
  element.rleft = spec.left;
  element.width = spec.width;
  element.height = spec.height;
  if (spec.hidden) {
    element.hide();
  } else {
    element.show();
  }
}

function applyLayout() {
  const layout = computeLayout(screen.width, screen.height);
  applyBoxLayout(title, layout.title);
  title.setContent(` OSDCloud iPXE TUI v${appVersion} - physical laptop deployment host console`);

  if (layout.tooSmall) {
    for (const element of [menu, servicesBox, clientsBox, preflightBox, detailsBox, validationBox, logBox]) {
      element.hide();
    }
    applyBoxLayout(sizeWarningBox, layout.warning);
    sizeWarningBox.setContent([
      'Terminal window is too small for the OSDCloud iPXE TUI.',
      '',
      `Current : ${screen.width} columns x ${screen.height} rows`,
      `Minimum : ${layout.minimum.columns} columns x ${layout.minimum.rows} rows`,
      '',
      'Resize the window to restore the locked dashboard layout.',
    ].join('\n'));
    return layout;
  }

  sizeWarningBox.hide();
  applyBoxLayout(menu, layout.menu);
  applyBoxLayout(servicesBox, layout.services);
  applyBoxLayout(clientsBox, layout.clients);
  applyBoxLayout(preflightBox, layout.preflight);
  applyBoxLayout(detailsBox, layout.details);
  applyBoxLayout(validationBox, layout.validation);
  applyBoxLayout(logBox, layout.logs);
  return layout;
}

function layoutSignature(layout) {
  return JSON.stringify(layout);
}

function resetTerminalForFullRedraw() {
  screen.realloc();
}

function innerWidth(element) {
  return Math.max(1, element.width - element.iwidth);
}

function setWrappedContent(element, lines, indent = 2) {
  element.setContent(wrapLinesWithIndent(lines, innerWidth(element), indent).join('\n'));
}

function requestRender({ forceRedraw = false, immediate = false } = {}) {
  if (forceRedraw || immediate) {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderAll({ forceRedraw });
    return;
  }

  if (renderTimer) {
    return;
  }
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderAll();
  }, 100);
  renderTimer.unref?.();
}

function addLog(message) {
  const line = formatLogLine(message);
  runtimeLog.push(line);
  requestRender();
}

function endpointStatusMark(state) {
  return {
    fail: '{red-fg}FAIL{/red-fg}',
    ok: '{green-fg}OK{/green-fg}',
    run: '{yellow-fg}RUN{/yellow-fg}',
  }[state] ?? '{cyan-fg}INFO{/cyan-fg}';
}

function addEndpointUpdateStatus(message, state = 'info') {
  endpointUpdateStatus.push(`${endpointStatusMark(state)} ${message}`);
  endpointUpdateStatus = endpointUpdateStatus.slice(-14);
  addLog(`[endpoint] ${message}`);
  requestRender({ immediate: true });
}

function createLogStreamer(prefix) {
  let pending = '';
  const emit = (line) => {
    const text = line.trim();
    if (text) {
      addLog(`${prefix} ${text}`);
    }
  };

  return {
    flush() {
      emit(pending);
      pending = '';
    },
    write(chunk) {
      pending += String(chunk).replace(/\r/gu, '\n');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        emit(line);
      }
    },
  };
}

for (const [name, service] of [['DHCP', dhcp], ['TFTP', tftp], ['HTTP', http]]) {
  service.on('log', (line) => {
    runtimeLog.push(formatDisplayLogLine(`[${name}] ${line}`));
    requestRender();
  });
  service.on('error', (error) => addLog(`[${name}] ERROR ${error.message}`));
}

http.on('status', ({ records }) => {
  for (const record of records) {
    addLog(`[RUN] ${record.type} run=${record.runId} stage=${record.stage ?? ''} message=${record.message ?? ''}`);
  }
});

function serviceState(service) {
  return service.running ? '{green-fg}running{/green-fg}' : '{red-fg}stopped{/red-fg}';
}

function renderServices() {
  const serviceIps = getServiceBindIps(config);
  const serviceIpText = serviceIps.length === 0
    ? 'all IPv4 interfaces'
    : serviceIps.map((ip) => (
      ip === config.adapter.serverIp ? `${ip}/${config.adapter.prefixLength}` : ip
    )).join(', ');
  let profileLines = [];
  try {
    const profileState = resolveDeploymentProfileState(config);
    profileLines = [
      `Profile     : ${profileState.activeProfile.name} (${profileState.activeProfile.id})`,
      `Software    : ${formatSoftwareList(profileState.selectedSoftware)}`,
    ];
  } catch (error) {
    profileLines = [
      'Profile     : {red-fg}invalid{/red-fg}',
      `Software    : ${error.message}`,
    ];
  }

  servicesBox.setContent([
    `Version     : ${appVersion}`,
    `HTTP/status : ${serviceState(http)} ${config.http.host}:${config.http.port}`,
    `TFTP        : ${serviceState(tftp)} ${config.tftp.listenIp}:${config.tftp.port}`,
    `DHCP        : ${serviceState(dhcp)} ${config.dhcp.listenIp}:${config.dhcp.listenPort}`,
    '',
    `Service IP  : ${serviceIpText}`,
    `Service NIC : ${config.adapter.interfaceAlias}`,
    `DHCP pool   : ${config.dhcp.leaseStartIp}-${config.dhcp.leaseEndIp}`,
    `DHCP router : ${config.dhcp.router}`,
    '',
    ...profileLines,
  ].join('\n'));
}

function selectFleetRunByIndex(index) {
  const run = currentFleetRuns[index] ?? null;
  selectedRunId = run?.runId ?? null;
}

function selectedFleetRun(fleet) {
  if (!fleet.runs.length) {
    selectedRunId = null;
    return null;
  }

  const selected = fleet.runs.find((run) => run.runId === selectedRunId);
  if (selected) {
    return selected;
  }

  selectedRunId = fleet.runs[0].runId;
  return fleet.runs[0];
}

function renderClients(fleet) {
  currentFleetRuns = fleet.runs;
  const selected = selectedFleetRun(fleet);
  const selectedIndex = selected ? fleet.runs.findIndex((run) => run.runId === selected.runId) : 0;
  clientsBox.setItems(formatFleetClientRows(fleet.runs, innerWidth(clientsBox)));
  if (fleet.runs.length > 0) {
    clientsBox.select(Math.max(0, selectedIndex));
  }
}

function renderClientDetail(fleet) {
  const selected = selectedFleetRun(fleet);
  setWrappedContent(detailsBox, formatFleetRunDetail(selected, readRunLatestScreenshot(config, selected?.runId)));
}

function renderPreflight() {
  if (endpointUpdateStatus.length > 0) {
    const lines = [
      'Endpoint update:',
      ...endpointUpdateStatus,
      '',
    ];
    if (preflightResults.length === 0) {
      lines.push('Preflight results will appear after endpoint sync completes.');
    } else {
      lines.push('Preflight:');
      lines.push(...preflightResults.map((item) => {
        const mark = item.ok ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
        return `${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`;
      }));
    }
    setWrappedContent(preflightBox, lines);
    return;
  }

  if (preflightResults.length === 0) {
    setWrappedContent(preflightBox, ['Run preflight to validate adapter, files, ports, SMB, and status paths.']);
    return;
  }
  setWrappedContent(preflightBox, preflightResults.map((item) => {
    const mark = item.ok ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
    return `${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`;
  }));
}

function renderValidation() {
  const fleet = readFleetStatus(config);
  const rows = summarizeValidation(config).map((item) => {
    const mark = item.ok ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
    return `${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`;
  });
  const statusTail = readStatusEvents(config, 6).map((line) => formatStatusEventLine(line));
  const screenshotTail = readRecentScreenshotMetadata(config, 3).map(formatScreenshotMetadata);
  setWrappedContent(validationBox, [
    `Fleet: total=${fleet.total} ${formatFleetCounts(fleet.counts)}`,
    '',
    ...rows,
    '',
    'Recent screenshots:',
    ...(screenshotTail.length ? screenshotTail : ['none']),
    '',
    'Recent status events:',
    ...(statusTail.length ? statusTail : ['none']),
  ]);
}

function renderLogs() {
  setWrappedContent(logBox, runtimeLog.lines());
  if (logAutoFollow) {
    logBox.setScrollPerc(100);
  }
}

function renderActionMenu() {
  const items = getActionItems();
  const signature = items.join('\n');
  if (signature === lastActionItemsSignature) {
    return;
  }

  const selected = Number.isInteger(menu.selected) ? menu.selected : 0;
  menu.setItems(items);
  menu.select(Math.min(selected, items.length - 1));
  lastActionItemsSignature = signature;
}

function renderAll({ forceRedraw = false } = {}) {
  const layout = applyLayout();
  const signature = layoutSignature(layout);
  const sizeModeChanged = layout.tooSmall !== wasTooSmall;
  if (forceRedraw || signature !== lastLayoutSignature || sizeModeChanged) {
    resetTerminalForFullRedraw();
    lastLayoutSignature = signature;
  }
  wasTooSmall = layout.tooSmall;

  if (layout.tooSmall) {
    screen.render();
    return;
  }
  renderActionMenu();
  const fleet = readFleetStatus(config);
  renderServices();
  renderClients(fleet);
  renderClientDetail(fleet);
  renderPreflight();
  renderValidation();
  renderLogs();
  setPanelLabels();
  applyFocusStyles();
  screen.render();
}

function handleTerminalResize() {
  renderAll({ forceRedraw: true });
}

function confirmPrompt(message) {
  return new Promise((resolve) => {
    dialogOpen = true;
    clearShortcutHints();
    const previousFocus = screen.focused;
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      padding: horizontalPanelPadding,
      height: 9,
      width: '70%',
      top: 'center',
      left: 'center',
      label: panelLabel('Confirm'),
      tags: true,
      keys: true,
      mouse: true,
      focusable: true,
      content: `${message}\n\n{bold}Y{/bold} / {bold}Enter{/bold}: continue    {bold}N{/bold} / {bold}Esc{/bold}: cancel`,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    pinPanelLabel(modal);

    const done = (answer) => {
      modal.destroy();
      if (previousFocus?.focus) {
        previousFocus.focus();
      } else {
        menu.focus();
      }
      screen.render();
      setTimeout(() => {
        dialogOpen = false;
      }, 0);
      resolve(answer);
    };

    modal.on('keypress', (ch, key) => {
      if (isConfirmKey(ch, key)) {
        done(true);
      } else if (isCancelKey(ch, key)) {
        done(false);
      }
    });

    modal.focus();
    screen.render();
  });
}

function formatInterfaceChoice(choice) {
  const gateway = choice.gateway ? ` gw=${choice.gateway}` : ' gw=none';
  const description = choice.interfaceDescription ? ` ${choice.interfaceDescription}` : '';
  return `${choice.interfaceAlias} ${choice.ipAddress}/${choice.prefixLength}${gateway}${description}`;
}

function formatDeploymentProfileChoice(profile) {
  return formatDeploymentProfileListChoice(profile);
}

function selectInterfacePrompt(choices) {
  return new Promise((resolve) => {
    dialogOpen = true;
    clearShortcutHints();
    const previousFocus = screen.focused;
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      padding: horizontalPanelPadding,
      height: Math.min(Math.max(choices.length + 6, 10), 18),
      width: '82%',
      top: 'center',
      left: 'center',
      label: panelLabel('Select Interface'),
      tags: true,
      keys: true,
      mouse: true,
      focusable: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    pinPanelLabel(modal);

    const list = blessed.list({
      parent: modal,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      keys: true,
      mouse: true,
      vi: true,
      tags: false,
      items: choices.map(formatInterfaceChoice),
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });
    blessed.box({
      parent: modal,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      content: '{bold}Enter{/bold}: select    {bold}Esc{/bold}: cancel',
    });

    const done = (choice) => {
      modal.destroy();
      if (previousFocus?.focus) {
        previousFocus.focus();
      } else {
        menu.focus();
      }
      screen.render();
      setTimeout(() => {
        dialogOpen = false;
      }, 0);
      resolve(choice);
    };

    list.on('select', (_, index) => done(choices[index] ?? null));
    modal.on('keypress', (ch, key) => {
      if (isCancelKey(ch, key)) {
        done(null);
      }
    });
    list.on('keypress', (ch, key) => {
      if (isCancelKey(ch, key)) {
        done(null);
      }
    });

    list.focus();
    screen.render();
  });
}

function selectDeploymentProfilePrompt(choices) {
  return new Promise((resolve) => {
    dialogOpen = true;
    clearShortcutHints();
    const previousFocus = screen.focused;
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      padding: horizontalPanelPadding,
      height: Math.min(Math.max(choices.length + 6, 10), 18),
      width: '82%',
      top: 'center',
      left: 'center',
      label: panelLabel('Select Profile'),
      tags: true,
      keys: true,
      mouse: true,
      focusable: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    pinPanelLabel(modal);

    const list = blessed.list({
      parent: modal,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      keys: true,
      mouse: true,
      vi: true,
      tags: false,
      items: choices.map(formatDeploymentProfileChoice),
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });
    blessed.box({
      parent: modal,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      content: '{bold}Enter{/bold}: publish    {bold}Esc{/bold}: cancel',
    });

    const done = (choice) => {
      modal.destroy();
      if (previousFocus?.focus) {
        previousFocus.focus();
      } else {
        menu.focus();
      }
      screen.render();
      setTimeout(() => {
        dialogOpen = false;
      }, 0);
      resolve(choice);
    };

    list.on('select', (_, index) => done(choices[index] ?? null));
    modal.on('keypress', (ch, key) => {
      if (isCancelKey(ch, key)) {
        done(null);
      }
    });
    list.on('keypress', (ch, key) => {
      if (isCancelKey(ch, key)) {
        done(null);
      }
    });

    list.focus();
    screen.render();
  });
}

function textInputPrompt({ titleText, promptText, initialValue = '' }) {
  return new Promise((resolve) => {
    dialogOpen = true;
    clearShortcutHints();
    const previousFocus = screen.focused;
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      padding: horizontalPanelPadding,
      height: 10,
      width: '70%',
      top: 'center',
      left: 'center',
      label: panelLabel(titleText),
      tags: true,
      keys: true,
      mouse: true,
      focusable: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    pinPanelLabel(modal);

    blessed.box({
      parent: modal,
      top: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: false,
      content: promptText,
    });
    const input = blessed.textbox({
      parent: modal,
      top: 2,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      inputOnFocus: true,
      keys: true,
      mouse: true,
      focusable: true,
      value: initialValue,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' },
        focus: { border: { fg: 'yellow' } },
      },
    });
    blessed.box({
      parent: modal,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      content: '{bold}Enter{/bold}: continue    {bold}Esc{/bold}: cancel',
    });

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      modal.destroy();
      if (previousFocus?.focus) {
        previousFocus.focus();
      } else {
        menu.focus();
      }
      screen.render();
      setTimeout(() => {
        dialogOpen = false;
      }, 0);
      resolve(value);
    };

    input.on('submit', (value) => done(String(value ?? input.getValue() ?? '')));
    input.on('cancel', () => done(null));
    input.key(['escape'], () => done(null));
    modal.key(['escape'], () => done(null));

    input.focus();
    input.readInput();
    screen.render();
  });
}

function editDeploymentProfilePrompt(profileState) {
  return new Promise((resolve) => {
    dialogOpen = true;
    clearShortcutHints();
    const previousFocus = screen.focused;
    const software = profileState.catalog.software;
    let selectedIds = [...profileState.activeProfile.softwareIds];
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      padding: horizontalPanelPadding,
      height: Math.min(Math.max(software.length + 7, 11), 20),
      width: '82%',
      top: 'center',
      left: 'center',
      label: panelLabel('Edit Profile'),
      tags: true,
      keys: true,
      mouse: true,
      focusable: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    pinPanelLabel(modal);

    blessed.box({
      parent: modal,
      top: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: false,
      content: `${profileState.activeProfile.name} (${profileState.activeProfile.id})`,
    });
    const list = blessed.list({
      parent: modal,
      top: 2,
      left: 0,
      width: '100%',
      height: '100%-5',
      keys: true,
      mouse: true,
      vi: true,
      tags: false,
      items: formatSoftwareCheckboxRows(software, selectedIds),
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });
    blessed.box({
      parent: modal,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      content: '{bold}Space{/bold}: toggle    {bold}A{/bold}: all    {bold}N{/bold}: none    {bold}Enter{/bold}: save    {bold}Esc{/bold}: cancel',
    });

    const refresh = () => {
      const selectedIndex = Math.min(Math.max(list.selected ?? 0, 0), Math.max(software.length - 1, 0));
      list.setItems(formatSoftwareCheckboxRows(software, selectedIds));
      if (software.length > 0) {
        list.select(selectedIndex);
      }
      screen.render();
    };

    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      modal.destroy();
      if (previousFocus?.focus) {
        previousFocus.focus();
      } else {
        menu.focus();
      }
      screen.render();
      setTimeout(() => {
        dialogOpen = false;
      }, 0);
      resolve(value);
    };

    const save = () => done(orderedSoftwareSelection(software, selectedIds));
    const applyKey = (keyName) => {
      const currentSoftwareId = software[list.selected]?.id ?? null;
      const nextIds = applySoftwareCheckboxKey(software, selectedIds, keyName, currentSoftwareId);
      if (nextIds !== selectedIds) {
        selectedIds = nextIds;
        refresh();
      }
    };

    list.key(['space'], () => applyKey('space'));
    list.key(['a', 'A'], () => applyKey('a'));
    list.key(['n', 'N'], () => applyKey('n'));
    list.key(['enter'], save);
    list.key(['escape'], () => done(null));
    modal.key(['escape'], () => done(null));

    list.focus();
    screen.render();
  });
}

function deleteDeploymentProfilePrompt(choices) {
  return new Promise((resolve) => {
    dialogOpen = true;
    clearShortcutHints();
    const previousFocus = screen.focused;
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      padding: horizontalPanelPadding,
      height: Math.min(Math.max(choices.length + 6, 10), 18),
      width: '70%',
      top: 'center',
      left: 'center',
      label: panelLabel('Delete Profile'),
      tags: true,
      keys: true,
      mouse: true,
      focusable: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });
    pinPanelLabel(modal);

    const list = blessed.list({
      parent: modal,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      keys: true,
      mouse: true,
      vi: true,
      tags: false,
      items: choices.map(formatDeploymentProfileDeleteChoice),
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });
    blessed.box({
      parent: modal,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      content: '{bold}Enter{/bold}: choose    {bold}Esc{/bold}: cancel',
    });

    let settled = false;
    const done = (choice) => {
      if (settled) {
        return;
      }
      settled = true;
      modal.destroy();
      if (previousFocus?.focus) {
        previousFocus.focus();
      } else {
        menu.focus();
      }
      screen.render();
      setTimeout(() => {
        dialogOpen = false;
      }, 0);
      resolve(choice);
    };

    list.key(['enter'], () => done(choices[list.selected] ?? null));
    list.key(['escape'], () => done(null));
    modal.key(['escape'], () => done(null));

    list.focus();
    screen.render();
  });
}

async function withBusy(label, action) {
  addLog(label);
  try {
    await action();
    addLog(`${label} complete`);
  } catch (error) {
    addLog(`${label} failed: ${error.message}`);
  } finally {
    renderAll();
  }
}

async function stopServicesForInterfaceChange() {
  if (!dhcp.running && !tftp.running && !http.running) {
    return true;
  }
  if (!(await confirmPrompt('Stop running services before changing the service interface?'))) {
    return false;
  }
  await withBusy('Stopping services for interface change', async () => {
    await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
  });
  return true;
}

async function stopServicesForDeploymentProfileChange() {
  if (!dhcp.running && !tftp.running && !http.running) {
    return true;
  }
  if (!(await confirmPrompt('Stop running services before publishing a deployment profile?'))) {
    return false;
  }
  await withBusy('Stopping services for profile change', async () => {
    await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
  });
  return true;
}

async function toggleService({ service, startPrompt, stopPrompt, startLabel, stopLabel }) {
  const wasRunning = service.running;
  const prompt = wasRunning ? stopPrompt : startPrompt;
  const label = wasRunning ? stopLabel : startLabel;
  if (await confirmPrompt(prompt)) {
    await withBusy(label, () => (wasRunning ? service.stop() : service.start()));
  }
}

async function runAction(index) {
  switch (index) {
    case 0:
      await withBusy('Running preflight', async () => {
        preflightResults = await runPreflight(config, { dhcp, tftp, http });
      });
      break;
    case 1:
      if (!(await stopServicesForInterfaceChange())) {
        break;
      }
      {
        let choices = [];
        await withBusy('Listing service interfaces', async () => {
          choices = await listIpv4ServiceInterfaces();
        });
        if (choices.length === 0) {
          addLog('No enabled non-APIPA IPv4 interfaces found');
          break;
        }
        const selected = await selectInterfacePrompt(choices);
        if (!selected) {
          addLog('Interface selection cancelled');
          break;
        }
        endpointUpdateStatus = [];
        preflightResults = [];
        addEndpointUpdateStatus(`Selected ${selected.interfaceAlias} ${selected.ipAddress}/${selected.prefixLength}`);
        await withBusy('Applying service interface endpoint', async () => {
          try {
            addEndpointUpdateStatus('Updating TUI config for DHCP, TFTP, HTTP/status, and SMB', 'run');
            const previousReservations = Array.isArray(config.dhcp.reservations)
              ? config.dhcp.reservations.length
              : 0;
            const previousEndpoint = `${config.adapter.interfaceAlias} ${config.adapter.serverIp}/${config.adapter.prefixLength}`;
            const previousBootUrl = config.dhcp.ipxeBootUrl;

            applyServiceEndpoint(config, selected);
            const savedPath = saveConfig(config);
            const currentReservations = Array.isArray(config.dhcp.reservations)
              ? config.dhcp.reservations.length
              : 0;

            addEndpointUpdateStatus(`Saved ${savedPath}`, 'ok');
            addEndpointUpdateStatus(`Endpoint ${previousEndpoint} -> ${config.adapter.interfaceAlias} ${config.adapter.serverIp}/${config.adapter.prefixLength}`, 'ok');
            addEndpointUpdateStatus(`iPXE boot URL ${previousBootUrl} -> ${config.dhcp.ipxeBootUrl}`, 'ok');
            if (currentReservations < previousReservations) {
              addEndpointUpdateStatus(`Removed ${previousReservations - currentReservations} stale DHCP reservation(s) outside ${config.adapter.serverIp}/${config.adapter.prefixLength}`, 'ok');
            }

            addEndpointUpdateStatus('Syncing boot.ipxe, autoexec, SetupComplete, WinPE status/SMB endpoint, SMB firewall, boot.wim, and osdcloud-assets', 'run');
            const stream = createLogStreamer('[endpoint-sync]');
            try {
              await syncIpxeEndpoint(config, {
                commitWinPe: true,
                syncAssets: true,
                hashLargeArtifacts: true,
                onOutput: stream.write,
              });
            } finally {
              stream.flush();
            }
            addEndpointUpdateStatus('Endpoint files synced and published boot.wim verified', 'ok');

            addEndpointUpdateStatus('Running preflight against the new endpoint', 'run');
            preflightResults = await runPreflight(config, { dhcp, tftp, http });
            const failures = preflightResults.filter((item) => !item.ok).length;
            addEndpointUpdateStatus(failures === 0 ? 'Preflight passed' : `Preflight completed with ${failures} failure(s)`, failures === 0 ? 'ok' : 'fail');
          } catch (error) {
            addEndpointUpdateStatus(`Endpoint update failed: ${error.message}`, 'fail');
            throw error;
          }
        });
      }
      break;
    case 2:
      if (!(await stopServicesForDeploymentProfileChange())) {
        break;
      }
      {
        let profileState = null;
        await withBusy('Loading deployment profiles', async () => {
          profileState = resolveDeploymentProfileState(config);
        });
        if (!profileState) {
          break;
        }
        const selected = await selectDeploymentProfilePrompt(profileState.profiles);
        if (!selected) {
          addLog('Deployment profile selection cancelled');
          break;
        }
        preflightResults = [];
        await withBusy('Publishing deployment profile', async () => {
          const result = publishDeploymentProfile(config, selected.id);
          config.deploymentProfiles ??= {};
          config.deploymentProfiles.activeProfile = selected.id;
          const savedPath = saveConfig(config);
          addLog(`Saved ${savedPath}`);
          addLog(`Published deployment profile ${result.profile.id}: ${formatSoftwareList(result.selectedSoftware)}`);
          preflightResults = await runPreflight(config, { dhcp, tftp, http });
        });
      }
      break;
    case 3:
      {
        const nameValue = await textInputPrompt({
          titleText: 'Add Profile',
          promptText: 'Profile name',
        });
        if (nameValue === null) {
          addLog('Deployment profile creation cancelled');
          break;
        }
        const validation = validateProfileTextInput({ name: nameValue });
        if (!validation.ok) {
          addLog(`Deployment profile not created: ${validation.message}`);
          break;
        }
        await withBusy('Creating deployment profile', async () => {
          const created = createDeploymentProfile(config, validation);
          addLog(`Created deployment profile ${created.profile.id}: ${created.profile.softwareIds.join(', ') || 'none'}`);
        });
      }
      break;
    case 4:
      {
        let profileState = null;
        await withBusy('Loading deployment profile editor', async () => {
          profileState = resolveDeploymentProfileState(config);
        });
        if (!profileState) {
          break;
        }
        const nameValue = await textInputPrompt({
          titleText: 'Edit Profile',
          promptText: 'Profile name',
          initialValue: profileState.activeProfile.name,
        });
        if (nameValue === null) {
          addLog('Deployment profile edit cancelled');
          break;
        }
        const profileName = String(nameValue).trim();
        if (!profileName) {
          addLog('Deployment profile not saved: Profile name is required');
          break;
        }
        const selectedSoftwareIds = await editDeploymentProfilePrompt(profileState);
        if (!selectedSoftwareIds) {
          addLog('Deployment profile edit cancelled');
          break;
        }
        if (!(await stopServicesForDeploymentProfileChange())) {
          break;
        }
        preflightResults = [];
        await withBusy('Saving deployment profile', async () => {
          const updated = updateDeploymentProfile(config, profileState.activeProfile.id, {
            name: profileName,
            softwareIds: selectedSoftwareIds,
          });
          const result = publishDeploymentProfile(config, updated.profile.id);
          addLog(`Saved deployment profile ${updated.profile.id}: ${formatSoftwareList(result.selectedSoftware)}`);
          preflightResults = await runPreflight(config, { dhcp, tftp, http });
        });
      }
      break;
    case 5:
      {
        let profileState = null;
        await withBusy('Loading deployment profiles', async () => {
          profileState = resolveDeploymentProfileState(config);
        });
        if (!profileState) {
          break;
        }
        const candidates = profileState.profiles.filter((profile) => profile.id !== profileState.activeProfile.id);
        if (candidates.length === 0) {
          addLog('No inactive deployment profiles can be deleted');
          break;
        }
        const selected = await deleteDeploymentProfilePrompt(candidates);
        if (!selected) {
          addLog('Deployment profile deletion cancelled');
          break;
        }
        if (!(await confirmPrompt(`Delete deployment profile ${selected.name} (${selected.id})?`))) {
          addLog('Deployment profile deletion cancelled');
          break;
        }
        await withBusy('Deleting deployment profile', async () => {
          const deleted = deleteDeploymentProfile(config, selected.id);
          addLog(`Deleted deployment profile ${deleted.profile.id}`);
        });
      }
      break;
    case 6:
      await toggleService({
        service: http,
        startPrompt: `Start HTTP/status server on ${config.http.host}:${config.http.port}?`,
        stopPrompt: 'Stop HTTP/status server?',
        startLabel: 'Starting HTTP/status server',
        stopLabel: 'Stopping HTTP/status server',
      });
      break;
    case 7:
      await toggleService({
        service: tftp,
        startPrompt: `Start TFTP responder on ${config.tftp.listenIp}:${config.tftp.port}?`,
        stopPrompt: 'Stop TFTP responder?',
        startLabel: 'Starting TFTP responder',
        stopLabel: 'Stopping TFTP responder',
      });
      break;
    case 8:
      await toggleService({
        service: dhcp,
        startPrompt: `Start DHCP responder on ${config.dhcp.listenIp}:${config.dhcp.listenPort}? Confirm the real DHCP server is disabled first.`,
        stopPrompt: 'Stop DHCP responder?',
        startLabel: 'Starting DHCP responder',
        stopLabel: 'Stopping DHCP responder',
      });
      break;
    case 9:
      if (await confirmPrompt('Start HTTP, TFTP, and DHCP services? Confirm the real DHCP server is disabled first.')) {
        await withBusy('Starting all services', async () => {
          await http.start();
          await tftp.start();
          await dhcp.start();
        });
      }
      break;
    case 10:
      await withBusy('Stopping all services', async () => {
        await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
      });
      break;
    case 11:
      if (await confirmPrompt(`Delete status .json/.jsonl files under ${config.http.statusRoot}?`)) {
        await withBusy('Clearing status files', async () => {
          const removed = removeStatusFiles(config);
          addLog(`Removed ${removed} status files`);
        });
      }
      break;
    case 12:
      addLog('Refreshing validation');
      renderAll();
      break;
    case 13:
      await quit();
      break;
    default:
      break;
  }
}

async function quit() {
  if ((dhcp.running || tftp.running || http.running) && !(await confirmPrompt('Stop services and quit?'))) {
    return;
  }
  altKeyWatcher?.stop();
  await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
  screen.destroy();
  process.exit(0);
}

menu.on('select', (_, index) => {
  if (dialogOpen) {
    return;
  }
  runAction(index);
});

clientsBox.on('keypress', (_ch, key) => {
  if (dialogOpen) {
    return;
  }
  if (['up', 'down', 'j', 'k'].includes(key?.name)) {
    setTimeout(() => {
      selectFleetRunByIndex(clientsBox.selected);
      requestRender();
    }, 0);
  }
});

clientsBox.on('select', (_item, index) => {
  selectFleetRunByIndex(index);
  requestRender();
});

function handleFocusShortcut(key) {
  const target = resolveFocusShortcutRequest(key, { dialogOpen });
  if (target) {
    setFocusedPanel(target);
  }
}

screen.key(focusShortcutKeyNames, (_ch, key) => {
  activateShortcutHints();
  handleFocusShortcut(key);
});

screen.on('keypress', (_ch, key) => {
  observedKeypressCount += 1;
  const isShortcutRequest = resolveShortcutHintRequest(key, { dialogOpen });
  if (isShortcutRequest) {
    activateShortcutHints();
    handleFocusShortcut(key);
  }
});

screen.key(['tab', 'S-tab'], (_ch, key) => {
  const target = resolveTabFocusTarget(focusedPanelId, key, { dialogOpen });
  if (target) {
    setFocusedPanel(target);
  }
});

screen.key(['r'], () => {
  if (!dialogOpen) {
    runAction(0);
  }
});
screen.key(['q', 'C-c'], () => {
  if (!dialogOpen) {
    quit();
  }
});

process.on('SIGINT', () => {
  if (!dialogOpen) {
    void quit();
  }
});

ensureKeyboardInput(screen, menu);
stopKeyboardFallback = bindFallbackKeyboardInput(screen, {
  getObservedKeypressCount: () => observedKeypressCount,
});

setInterval(() => {
  requestRender();
}, 1000).unref();

for (const line of [
  ...tailFile(config.dhcp.logPath, 5).map((line) => formatDisplayLogLine(`[DHCP] ${line}`)),
  ...tailFile(config.tftp.logPath, 5).map((line) => formatDisplayLogLine(`[TFTP] ${line}`)),
  ...tailFile(config.http.logPath, 5).map((line) => formatDisplayLogLine(`[HTTP] ${line}`)),
]) {
  runtimeLog.push(line);
}

altKeyWatcher = startWindowsAltKeyWatcher({
  onChange: setAltKeyPressed,
  onError: (message) => runtimeLog.push(`[KEY] Alt watcher: ${message}`),
});
process.once('exit', () => altKeyWatcher?.stop());
process.once('exit', () => stopKeyboardFallback?.());

fs.mkdirSync(config.http.statusRoot, { recursive: true });
renderAll({ forceRedraw: true });
const startupRedrawTimer = setTimeout(() => renderAll({ forceRedraw: true }), 75);
startupRedrawTimer.unref?.();
