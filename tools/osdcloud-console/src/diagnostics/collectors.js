import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { workspaceInfo, webServerConfig } from '../config.js';
import { tailFile } from '../logger.js';
import { isElevated, runPowerShell } from '../windows/powershell.js';
import { localEndpointOverlayStatus, osImageDeployableStatus, profilePayloadStatus } from '../controller/helpers.js';
import { redactJson, redactText } from './redact.js';
import { diagnosticsTimestamp, runCategoryForStage } from './shared.js';

function readCommandVersion(command, args) {
  try {
    const result = spawnSync(command, args, {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      return { ok: true, value: String(result.stdout ?? '').trim() };
    }
    return {
      ok: false,
      error: String(result.stderr ?? '').trim() || String(result.stdout ?? '').trim() || `${command} exited with code ${result.status}`,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function probePowerShellModules() {
  const script = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
function ModuleRows($name) {
  @(Get-Module -ListAvailable -Name $name | Select-Object Name,Version,Path | ForEach-Object {
    [pscustomobject]@{
      name = $_.Name
      version = $_.Version.ToString()
      path = $_.Path
    }
  })
}
$imports = [ordered]@{}
foreach ($name in @('OSD','OSDCloud')) {
  try {
    Import-Module $name -Force -ErrorAction Stop
    $loaded = Get-Module -Name $name | Select-Object -First 1
    $imports[$name] = [pscustomobject]@{
      ok = $true
      version = if ($loaded) { $loaded.Version.ToString() } else { $null }
    }
  }
  catch {
    $imports[$name] = [pscustomobject]@{
      ok = $false
      error = ($_ | Format-List * -Force | Out-String).Trim()
    }
  }
}
$catalog = [ordered]@{ ok = $false; count = $null; error = $null }
try {
  Import-Module OSD -Force -ErrorAction Stop
  $catalog.ok = $true
  $catalog.count = @(Get-OSDCloudOperatingSystems -ErrorAction Stop).Count
}
catch {
  $catalog.error = ($_ | Format-List * -Force | Out-String).Trim()
}
[pscustomobject]@{
  powershellVersion = $PSVersionTable.PSVersion.ToString()
  modules = [ordered]@{
    OSD = @(ModuleRows 'OSD')
    OSDCloud = @(ModuleRows 'OSDCloud')
  }
  imports = $imports
  catalog = $catalog
} | ConvertTo-Json -Depth 8 -Compress
`;
  try {
    const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      powershellVersion: null,
      modules: { OSD: [], OSDCloud: [] },
      imports: {
        OSD: { ok: false, error: error.message },
        OSDCloud: { ok: false, error: error.message },
      },
      catalog: { ok: false, count: null, error: error.message },
      error: error.message,
    };
  }
}

function safeReadText(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

function parseJsonLines(lines = []) {
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function selectRun(appState = {}, requestedRunId = null) {
  const runs = appState.fleet?.runs ?? [];
  if (requestedRunId) {
    return runs.find((run) => run.runId === requestedRunId) ?? null;
  }
  return runs[0] ?? null;
}

function screenshotMetadataForRun(statusRoot, runId, maxLines = 5) {
  const filePath = path.join(statusRoot, `${runId}.screenshots.jsonl`);
  return parseJsonLines(tailFile(filePath, maxLines));
}

export async function collectDiagnosticsContext(config = {}, options = {}) {
  const now = options.now ?? new Date();
  const appState = options.appState ?? {};
  const workspace = workspaceInfo(config);
  const web = webServerConfig(config);
  const elevated = Object.hasOwn(options, 'elevated')
    ? options.elevated
    : await isElevated().catch(() => false);
  const moduleProbe = options.moduleProbe ?? await probePowerShellModules();
  const npmVersion = options.npmVersion ?? readCommandVersion('npm', ['--version']);
  const runtime = appState.runtime ?? null;
  const endpoint = localEndpointOverlayStatus(config);
  const profilePayload = options.profilePayload ?? { ok: false, detail: 'Deployment profile payload has not been evaluated.' };
  const preflight = Array.isArray(options.preflight) ? options.preflight : [];
  const hostLogTail = Array.isArray(options.hostLogTail)
    ? options.hostLogTail
    : tailFile(options.hostLogPath ?? config.dhcp?.logPath, 160);
  const operationLogTail = Array.isArray(options.operationLogTail)
    ? options.operationLogTail
    : [];
  const profileStatus = profilePayloadStatus(profilePayload);
  const osImageStatus = osImageDeployableStatus(appState.osImage);

  const hostArtifacts = [
    {
      label: 'Host overview',
      relativePath: 'artifacts/host/overview.json',
      kind: 'json',
      content: redactJson({
        generatedAt: now.toISOString(),
        workspace,
        web,
        elevated,
        nodeVersion: process.version,
        npmVersion,
        powershellVersion: moduleProbe.powershellVersion,
      }),
      redacted: true,
    },
    {
      label: 'PowerShell module probe',
      relativePath: 'artifacts/host/module-probe.json',
      kind: 'json',
      content: redactJson(moduleProbe),
      redacted: true,
    },
    {
      label: 'Runtime readiness snapshot',
      relativePath: 'artifacts/host/runtime-readiness.json',
      kind: 'json',
      content: redactJson(runtime),
      redacted: true,
    },
    {
      label: 'Preflight snapshot',
      relativePath: 'artifacts/host/preflight.json',
      kind: 'json',
      content: redactJson(preflight),
      redacted: true,
    },
    {
      label: 'Host services log tail',
      relativePath: 'artifacts/host/host-services.log.tail.txt',
      kind: 'text',
      content: redactText(hostLogTail.join('\n')),
      redacted: true,
    },
    {
      label: 'Operation log tail',
      relativePath: 'artifacts/host/operation.log.tail.txt',
      kind: 'text',
      content: redactText(operationLogTail.join('\n')),
      redacted: true,
    },
  ];

  const run = options.scope === 'host' ? null : selectRun(appState, options.runId ?? null);
  let runContext = null;
  if (run) {
    const statusRoot = config.http?.statusRoot ?? '';
    const logsDir = config.paths?.logsDir ?? path.join(config.paths?.osdCloudRoot ?? 'C:\\OSDCloud', 'logs');
    const summaryPath = path.join(statusRoot, `${run.runId}.summary.json`);
    const latestPath = path.join(statusRoot, `${run.runId}.latest.json`);
    const eventsPath = path.join(statusRoot, `${run.runId}.jsonl`);
    const screenshotsPath = path.join(statusRoot, `${run.runId}.screenshots.jsonl`);
    const deploymentLogPath = path.join(logsDir, 'runs', run.runId, 'deployment.log');
    const summary = safeReadJson(summaryPath);
    const latest = safeReadJson(latestPath);
    const screenshotEntries = screenshotMetadataForRun(statusRoot, run.runId, 5);
    const latestScreenshots = screenshotEntries
      .map((entry) => entry.filePath)
      .filter((filePath) => filePath && fs.existsSync(filePath))
      .slice(-3);

    const runArtifacts = [
      {
        label: 'Run summary',
        relativePath: 'artifacts/run/summary.json',
        kind: 'json',
        content: redactJson(summary),
        sourcePath: summaryPath,
        redacted: true,
      },
      {
        label: 'Run latest status',
        relativePath: 'artifacts/run/latest.json',
        kind: 'json',
        content: redactJson(latest),
        sourcePath: latestPath,
        redacted: true,
      },
      {
        label: 'Run status events tail',
        relativePath: 'artifacts/run/status-events.tail.json',
        kind: 'json',
        content: redactJson(parseJsonLines(tailFile(eventsPath, 120))),
        sourcePath: eventsPath,
        redacted: true,
      },
      {
        label: 'Run screenshot metadata tail',
        relativePath: 'artifacts/run/screenshots.tail.json',
        kind: 'json',
        content: redactJson(screenshotEntries),
        sourcePath: screenshotsPath,
        redacted: true,
      },
      {
        label: 'Run deployment log tail',
        relativePath: 'artifacts/run/deployment.log.tail.txt',
        kind: 'text',
        content: redactText(tailFile(deploymentLogPath, 160).join('\n')),
        sourcePath: deploymentLogPath,
        redacted: true,
      },
      ...latestScreenshots.map((filePath, index) => ({
        label: `Run screenshot ${index + 1}`,
        relativePath: `artifacts/run/screenshots/${path.basename(filePath)}`,
        kind: 'binary',
        sourcePath: filePath,
        redacted: false,
      })),
    ];

    runContext = {
      run,
      summary,
      latest,
      latestStage: summary?.latestStage ?? latest?.stage ?? run.latestStage ?? null,
      category: runCategoryForStage(summary?.latestStage ?? latest?.stage ?? run.latestStage),
      artifacts: runArtifacts,
      screenshotEntries,
    };
  }

  return {
    generatedAt: now.toISOString(),
    trigger: options.trigger ?? 'manual',
    scope: options.scope ?? 'full',
    host: {
      workspace,
      web,
      elevated,
      nodeVersion: process.version,
      npmVersion,
      moduleProbe,
      runtime,
      endpoint,
      osImageStatus,
      profileStatus,
      preflight,
      hostLogPath: options.hostLogPath ?? config.dhcp?.logPath ?? null,
      hostLogTail,
      operationLogTail,
    },
    run: runContext,
    artifacts: [
      ...hostArtifacts,
      ...(runContext?.artifacts ?? [{
        label: 'Run diagnostics not applicable',
        relativePath: 'artifacts/run/not-applicable.json',
        kind: 'json',
        content: { scope: options.scope ?? 'full', detail: 'No deployment run was available for diagnostics.' },
        redacted: false,
      }]),
    ],
  };
}
