import blessed from 'blessed';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { DhcpResponder } from './dhcp.js';
import { TftpResponder } from './tftp.js';
import { MediaHttpServer } from './httpServer.js';
import { RingBuffer, tailFile } from './logger.js';
import { configurePhysicalNic, removeStatusFiles, runPreflight } from './windows.js';
import { formatDeploymentStatus, readLatestStatus, readStatusEvents, summarizeValidation } from './status.js';
import { isCancelKey, isConfirmKey } from './confirmKeys.js';

const config = loadConfig();
const dhcp = new DhcpResponder(config.dhcp);
const tftp = new TftpResponder(config.tftp);
const http = new MediaHttpServer(config.http);
const runtimeLog = new RingBuffer(500);
let preflightResults = [];
let dialogOpen = false;

const screen = blessed.screen({
  smartCSR: true,
  title: 'OSDCloud iPXE TUI',
  fullUnicode: true,
});

const title = blessed.box({
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  style: { fg: 'white', bg: 'blue' },
  content: ' OSDCloud iPXE TUI - physical laptop deployment host console',
});

const menu = blessed.list({
  top: 3,
  left: 0,
  width: 34,
  height: '100%-3',
  keys: true,
  mouse: true,
  vi: true,
  border: 'line',
  label: ' Actions ',
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
  height: 9,
  border: 'line',
  tags: true,
  label: ' Services ',
  style: { border: { fg: 'cyan' } },
});

const deploymentBox = blessed.box({
  top: 3,
  left: 100,
  width: '100%-100',
  height: 9,
  border: 'line',
  tags: false,
  label: ' Deployment ',
  style: { border: { fg: 'cyan' } },
});

const preflightBox = blessed.box({
  top: 12,
  left: 34,
  width: 66,
  height: '38%',
  border: 'line',
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  tags: true,
  label: ' Preflight ',
  style: { border: { fg: 'cyan' } },
});

const validationBox = blessed.box({
  top: 12,
  left: 100,
  width: '100%-100',
  height: '38%',
  border: 'line',
  scrollable: true,
  keys: true,
  mouse: true,
  tags: true,
  label: ' Validation ',
  style: { border: { fg: 'cyan' } },
});

const logBox = blessed.log({
  bottom: 0,
  left: 34,
  width: '100%-34',
  height: '100%-12-38%',
  border: 'line',
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  tags: true,
  label: ' Logs ',
  style: { border: { fg: 'cyan' } },
});

screen.append(title);
screen.append(menu);
screen.append(servicesBox);
screen.append(deploymentBox);
screen.append(preflightBox);
screen.append(validationBox);
screen.append(logBox);
menu.focus();

function addLog(message) {
  const line = `${new Date().toISOString()} ${message}`;
  runtimeLog.push(line);
  logBox.log(line);
  screen.render();
}

for (const [name, service] of [['DHCP', dhcp], ['TFTP', tftp], ['HTTP', http]]) {
  service.on('log', (line) => {
    runtimeLog.push(line);
    logBox.log(`[${name}] ${line}`);
    screen.render();
  });
  service.on('error', (error) => addLog(`[${name}] ERROR ${error.message}`));
}

function serviceState(service) {
  return service.running ? '{green-fg}running{/green-fg}' : '{red-fg}stopped{/red-fg}';
}

function renderServices() {
  servicesBox.setContent([
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
  deploymentBox.setContent(formatDeploymentStatus(latest).join('\n'));
}

function renderPreflight() {
  if (preflightResults.length === 0) {
    preflightBox.setContent('Run preflight to validate adapter, files, ports, SMB, and status paths.');
    return;
  }
  preflightBox.setContent(preflightResults.map((item) => {
    const mark = item.ok ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
    return `${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`;
  }).join('\n'));
}

function renderValidation() {
  const rows = summarizeValidation(config).map((item) => {
    const mark = item.ok ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
    return `${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`;
  });
  const statusTail = readStatusEvents(config, 6);
  validationBox.setContent([
    ...rows,
    '',
    'Recent status events:',
    ...(statusTail.length ? statusTail : ['none']),
  ].join('\n'));
}

function renderAll() {
  renderServices();
  renderDeployment();
  renderPreflight();
  renderValidation();
  screen.render();
}

function confirmPrompt(message) {
  return new Promise((resolve) => {
    dialogOpen = true;
    const previousFocus = screen.focused;
    const modal = blessed.box({
      parent: screen,
      border: 'line',
      height: 9,
      width: '70%',
      top: 'center',
      left: 'center',
      label: ' Confirm ',
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
  logBox.log(line);
}

fs.mkdirSync(config.http.statusRoot, { recursive: true });
renderAll();
