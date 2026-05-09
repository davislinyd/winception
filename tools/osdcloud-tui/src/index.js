import blessed from 'blessed';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { DhcpResponder } from './dhcp.js';
import { TftpResponder } from './tftp.js';
import { MediaHttpServer } from './httpServer.js';
import { RingBuffer, tailFile } from './logger.js';
import { configurePhysicalNic, removeStatusFiles, runPreflight } from './windows.js';
import { formatDeploymentStatus, formatScreenshotMetadata, readLatestScreenshot, readLatestStatus, readLatestSummary, readScreenshotMetadata, readStatusEvents, resolveDeploymentSummary, summarizeValidation } from './status.js';
import { isCancelKey, isConfirmKey } from './confirmKeys.js';
import { computeLayout } from './layout.js';
import { wrapLinesWithIndent } from './textWrap.js';

const packageInfo = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const appVersion = packageInfo.version ?? 'unknown';
const config = loadConfig();
const dhcp = new DhcpResponder(config.dhcp);
const tftp = new TftpResponder(config.tftp);
const http = new MediaHttpServer(config.http);
const runtimeLog = new RingBuffer(500);
let preflightResults = [];
let dialogOpen = false;
let lastLayoutSignature = '';
let wasTooSmall = false;
let terminalDefaultsRestored = false;

const terminalControl = {
  alternateBuffer: '\x1b[?1049h',
  clearScreenAndScrollback: '\x1b[H\x1b[2J\x1b[3J',
  disableAutoWrap: '\x1b[?7l',
  enableAutoWrap: '\x1b[?7h',
  hideCursor: '\x1b[?25l',
};

const horizontalPanelPadding = { left: 1, right: 1 };
const panelLabelLeftInset = 1;

function panelLabel(text) {
  return `  ${text}  `;
}

function pinPanelLabel(element) {
  if (element._label) {
    element._label.rleft = panelLabelLeftInset;
  }
}

const screen = blessed.screen({
  smartCSR: true,
  resizeTimeout: 100,
  title: `OSDCloud iPXE TUI v${appVersion}`,
  fullUnicode: true,
});

screen.program.removeAllListeners('resize');
screen.program.on('resize', handleTerminalResize);

enterStableTerminal({ clear: true });
process.once('exit', restoreTerminalDefaults);

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
  vi: true,
  wrap: false,
  border: 'line',
  padding: horizontalPanelPadding,
  label: panelLabel('Actions'),
  style: {
    selected: { bg: 'blue', fg: 'white' },
    item: { fg: 'white' },
    border: { fg: 'cyan' },
  },
  items: [
    'Run preflight',
    'Configure physical NIC',
    'Start HTTP/status',
    'Start TFTP',
    'Start DHCP',
    'Start all services',
    'Stop all services',
    'Clear status files',
    'Refresh validation',
    'Quit',
  ],
});

const servicesBox = blessed.box({
  top: 3,
  left: 34,
  width: 66,
  height: 13,
  border: 'line',
  padding: horizontalPanelPadding,
  tags: true,
  wrap: false,
  label: panelLabel('Services'),
  style: { border: { fg: 'cyan' } },
});

const deploymentBox = blessed.box({
  top: 3,
  left: 100,
  width: '100%-100',
  height: 13,
  border: 'line',
  padding: horizontalPanelPadding,
  tags: false,
  wrap: false,
  label: panelLabel('Deployment'),
  style: { border: { fg: 'cyan' } },
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
  tags: true,
  wrap: false,
  label: panelLabel('Preflight'),
  style: { border: { fg: 'cyan' } },
});

const validationBox = blessed.box({
  top: 16,
  left: 100,
  width: '100%-100',
  height: '38%',
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  keys: true,
  tags: true,
  wrap: false,
  label: panelLabel('Validation'),
  style: { border: { fg: 'cyan' } },
});

const logBox = blessed.log({
  bottom: 0,
  left: 34,
  width: '100%-34',
  height: '100%-16-38%',
  border: 'line',
  padding: horizontalPanelPadding,
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  tags: true,
  wrap: false,
  label: panelLabel('Logs'),
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
screen.append(deploymentBox);
screen.append(preflightBox);
screen.append(validationBox);
screen.append(logBox);
screen.append(sizeWarningBox);
for (const element of [menu, servicesBox, deploymentBox, preflightBox, validationBox, logBox]) {
  pinPanelLabel(element);
}
menu.focus();

menu.removeAllListeners('element wheelup');
menu.removeAllListeners('element wheeldown');

screen.on('wheelup', () => renderAll());
screen.on('wheeldown', () => renderAll());
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
    for (const element of [menu, servicesBox, deploymentBox, preflightBox, validationBox, logBox]) {
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
  applyBoxLayout(deploymentBox, layout.deployment);
  applyBoxLayout(preflightBox, layout.preflight);
  applyBoxLayout(validationBox, layout.validation);
  applyBoxLayout(logBox, layout.logs);
  return layout;
}

function layoutSignature(layout) {
  return JSON.stringify(layout);
}

function writeTerminalControl(sequence) {
  screen.program.output.write(sequence);
}

function enterStableTerminal({ clear = false } = {}) {
  screen.program.isAlt = true;
  writeTerminalControl([
    terminalControl.alternateBuffer,
    terminalControl.disableAutoWrap,
    terminalControl.hideCursor,
    clear ? terminalControl.clearScreenAndScrollback : '',
  ].join(''));
  screen.program.csr(0, Math.max(0, screen.height - 1));
}

function restoreTerminalDefaults() {
  if (terminalDefaultsRestored) {
    return;
  }
  terminalDefaultsRestored = true;
  writeTerminalControl(terminalControl.enableAutoWrap);
}

function resetTerminalForFullRedraw() {
  enterStableTerminal({ clear: true });
  screen.realloc();
}

function innerWidth(element) {
  return Math.max(1, element.width - element.iwidth);
}

function setWrappedContent(element, lines, indent = 2) {
  element.setContent(wrapLinesWithIndent(lines, innerWidth(element), indent).join('\n'));
}

function addLog(message) {
  const line = `${new Date().toISOString()} ${message}`;
  runtimeLog.push(line);
  renderAll();
}

for (const [name, service] of [['DHCP', dhcp], ['TFTP', tftp], ['HTTP', http]]) {
  service.on('log', (line) => {
    runtimeLog.push(`[${name}] ${line}`);
    renderAll();
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
  servicesBox.setContent([
    `Version     : ${appVersion}`,
    `HTTP/status : ${serviceState(http)} ${config.http.host}:${config.http.port}`,
    `TFTP        : ${serviceState(tftp)} ${config.tftp.listenIp}:${config.tftp.port}`,
    `DHCP        : ${serviceState(dhcp)} ${config.dhcp.listenIp}:${config.dhcp.listenPort}`,
    '',
    `Adapter     : ${config.adapter.interfaceAlias}`,
    `Host IP     : ${config.adapter.serverIp}/${config.adapter.prefixLength}`,
  ].join('\n'));
}

function renderDeployment() {
  const latest = readLatestStatus(config);
  const summary = resolveDeploymentSummary(config, latest, readLatestSummary(config));
  setWrappedContent(deploymentBox, formatDeploymentStatus(latest, summary, readLatestScreenshot(config)));
}

function renderPreflight() {
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
  const rows = summarizeValidation(config).map((item) => {
    const mark = item.ok ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
    return `${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`;
  });
  const statusTail = readStatusEvents(config, 6);
  const screenshotTail = readScreenshotMetadata(config, 3).map(formatScreenshotMetadata);
  setWrappedContent(validationBox, [
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
  logBox.setScrollPerc(100);
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
  renderServices();
  renderDeployment();
  renderPreflight();
  renderValidation();
  renderLogs();
  screen.render();
}

function handleTerminalResize() {
  renderAll({ forceRedraw: true });
}

function confirmPrompt(message) {
  return new Promise((resolve) => {
    dialogOpen = true;
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

async function runAction(index) {
  switch (index) {
    case 0:
      await withBusy('Running preflight', async () => {
        preflightResults = await runPreflight(config, { dhcp, tftp, http });
      });
      break;
    case 1:
      if (await confirmPrompt(`Configure adapter ${config.adapter.interfaceAlias} as ${config.adapter.serverIp}/${config.adapter.prefixLength}?`)) {
        await withBusy('Configuring physical NIC', async () => {
          const output = await configurePhysicalNic(config);
          if (output) {
            addLog(output.replace(/\r?\n/g, ' | '));
          }
        });
      }
      break;
    case 2:
      if (await confirmPrompt(`Start HTTP/status server on ${config.http.host}:${config.http.port}?`)) {
        await withBusy('Starting HTTP/status server', () => http.start());
      }
      break;
    case 3:
      if (await confirmPrompt(`Start TFTP responder on ${config.tftp.listenIp}:${config.tftp.port}?`)) {
        await withBusy('Starting TFTP responder', () => tftp.start());
      }
      break;
    case 4:
      if (await confirmPrompt(`Start DHCP responder on ${config.dhcp.listenIp}:${config.dhcp.listenPort}? Confirm the real DHCP server is disabled first.`)) {
        await withBusy('Starting DHCP responder', () => dhcp.start());
      }
      break;
    case 5:
      if (await confirmPrompt('Start HTTP, TFTP, and DHCP services? Confirm the real DHCP server is disabled first.')) {
        await withBusy('Starting all services', async () => {
          await http.start();
          await tftp.start();
          await dhcp.start();
        });
      }
      break;
    case 6:
      await withBusy('Stopping all services', async () => {
        await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
      });
      break;
    case 7:
      if (await confirmPrompt(`Delete status .json/.jsonl files under ${config.http.statusRoot}?`)) {
        await withBusy('Clearing status files', async () => {
          const removed = removeStatusFiles(config);
          addLog(`Removed ${removed} status files`);
        });
      }
      break;
    case 8:
      addLog('Refreshing validation');
      renderAll();
      break;
    case 9:
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
  await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
  restoreTerminalDefaults();
  screen.destroy();
  process.exit(0);
}

menu.on('select', (_, index) => {
  if (dialogOpen) {
    return;
  }
  runAction(index);
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

setInterval(() => {
  renderAll();
}, 1000).unref();

for (const line of [
  ...tailFile(config.dhcp.logPath, 5).map((line) => `[DHCP] ${line}`),
  ...tailFile(config.tftp.logPath, 5).map((line) => `[TFTP] ${line}`),
  ...tailFile(config.http.logPath, 5).map((line) => `[HTTP] ${line}`),
]) {
  runtimeLog.push(line);
}

fs.mkdirSync(config.http.statusRoot, { recursive: true });
renderAll();
