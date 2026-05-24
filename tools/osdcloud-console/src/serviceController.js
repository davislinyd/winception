import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyServiceEndpoint,
  loadConfig,
  mediaHttpServerConfig,
  saveConfig,
  webServerConfig,
} from './config.js';
import { DhcpResponder } from './dhcp.js';
import { TftpResponder } from './tftp.js';
import { MediaHttpServer } from './httpServer.js';
import {
  createSoftwarePackage,
  createDeploymentProfile,
  createCustomScript,
  deleteDeploymentProfile,
  deleteSoftwarePackage,
  deleteCustomScript,
  evaluateDeploymentProfilePayload,
  formatSoftwareList,
  openSoftwareInstallScript,
  publishDeploymentProfile,
  readCustomScriptContent,
  readSoftwareInstallScript,
  resolveDeploymentProfileState,
  updateDeploymentProfile,
  uploadCustomScript,
  uploadSoftwareInstaller,
} from './deploymentProfiles.js';
import {
  deleteCachedOsImage,
  downloadOsImageFromCatalog,
  formatOsImageLabel,
  importUploadedOsImage,
  listOsDownloadCatalog,
  publishSelectedOsImage,
  resolveOsImageState,
  uploadOsImageFile,
} from './osImages.js';
import { formatLogLine, RingBuffer, tailFile } from './logger.js';
import {
  listIpv4ServiceInterfaces,
  removeStatusFiles,
  runPreflight,
  prepareRuntimeArtifacts,
  syncIpxeEndpoint,
} from './windows.js';
import {
  getRuntimeReadiness,
} from './runtimeArtifacts.js';
import {
  deleteStatusRun,
  readFleetStatus,
  readRecentScreenshotMetadata,
  readRunLatestScreenshot,
  readRunStatusEvents,
  readStatusEvents,
  summarizeValidation,
} from './status.js';
import { formatDisplayLogLine } from './timeFormat.js';
import { appVersion } from './version.js';

function errorWithStatus(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function makeOutputLogger(writeLine, prefix) {
  let pending = '';
  return {
    write(chunk, stream = 'stdout') {
      pending += String(chunk ?? '');
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          writeLine(`${prefix} ${stream}: ${line}`);
        }
      }
    },
    flush() {
      if (pending.trim()) {
        writeLine(`${prefix} ${pending}`);
      }
      pending = '';
    },
  };
}

function serviceSummary(service, config) {
  return {
    running: Boolean(service?.running),
    ...config,
  };
}

function safeRead(callback, fallback = null) {
  try {
    return { value: callback(), error: null };
  } catch (error) {
    return { value: fallback, error: error.message };
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  return raw.trim() ? JSON.parse(raw) : {};
}

function repoRootForConfig(config) {
  if (config.paths?.repoRoot) {
    return path.resolve(config.paths.repoRoot);
  }
  if (config.__configPath) {
    return path.resolve(path.dirname(config.__configPath), '..');
  }
  return process.cwd();
}

function deploymentSecretsPath(config) {
  const configured = config.deploymentSecrets?.path;
  if (configured) {
    return path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(repoRootForConfig(config), configured);
  }
  return path.join(repoRootForConfig(config), 'config', 'osdcloud-secrets.json');
}

function hasSecretValue(value) {
  const text = String(value ?? '').trim();
  return text !== '' && !/^<[^>]+>$/u.test(text);
}

function deploymentSecretsStatus(config, env = process.env) {
  const filePath = deploymentSecretsPath(config);
  let fileSecrets = {};
  let fileError = null;
  const fileExists = fs.existsSync(filePath);
  if (fileExists) {
    try {
      fileSecrets = readJsonFile(filePath);
    } catch (error) {
      fileError = error.message;
    }
  }

  const fields = [
    ['davisPassword', 'OSDCLOUD_DAVIS_PASSWORD'],
    ['pxeinstallPassword', 'OSDCLOUD_PXEINSTALL_PASSWORD'],
  ];
  const status = {};
  const missing = [];
  for (const [jsonName, envName] of fields) {
    const fromFile = !fileError && hasSecretValue(fileSecrets?.[jsonName]);
    const fromEnv = hasSecretValue(env?.[envName]);
    status[jsonName] = {
      present: fromFile || fromEnv,
      source: fromFile ? 'file' : fromEnv ? 'environment' : 'missing',
    };
    if (!status[jsonName].present) {
      missing.push(jsonName);
    }
  }

  return {
    ready: missing.length === 0,
    filePath,
    fileExists,
    fileError,
    missing,
    status,
  };
}

function writeDeploymentSecrets(config, input = {}) {
  const davisPassword = String(input.davisPassword ?? '').trim();
  const pxeinstallPassword = String(input.pxeinstallPassword ?? '').trim();
  if (!hasSecretValue(davisPassword)) {
    throw errorWithStatus('davisPassword is required.', 400);
  }
  if (!hasSecretValue(pxeinstallPassword)) {
    throw errorWithStatus('pxeinstallPassword is required.', 400);
  }

  const filePath = deploymentSecretsPath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ davisPassword, pxeinstallPassword }, null, 2)}\n`, 'utf8');
  return deploymentSecretsStatus(config);
}

function localEndpointOverlayStatus(config) {
  const filePath = config.__localConfigPath
    ? path.resolve(config.__localConfigPath)
    : path.join(repoRootForConfig(config), 'config', 'osdcloud-console.local.json');
  if (!fs.existsSync(filePath)) {
    return {
      ready: false,
      filePath,
      detail: 'No local endpoint overlay has been written by Web endpoint sync.',
    };
  }
  try {
    const overlay = readJsonFile(filePath);
    const hasEndpoint = Boolean(
      overlay.adapter?.serverIp
      && overlay.adapter?.interfaceAlias
      && overlay.http?.host
      && overlay.tftp?.listenIp
      && overlay.dhcp?.ipxeBootUrl
      && overlay.smb?.share,
    );
    return {
      ready: hasEndpoint,
      filePath,
      detail: hasEndpoint
        ? `${overlay.adapter.interfaceAlias} ${overlay.adapter.serverIp}/${overlay.adapter.prefixLength ?? ''}`.trim()
        : 'Local overlay exists, but endpoint sections have not been written by Web endpoint sync.',
    };
  } catch (error) {
    return {
      ready: false,
      filePath,
      detail: `Unable to read local endpoint overlay: ${error.message}`,
    };
  }
}

function osImageDeployableStatus(osImage) {
  const active = osImage?.activeImage;
  const selected = osImage?.selectedOs;
  if (!active) {
    return { ready: false, detail: 'No active OS image selected.' };
  }
  if (!active.cached) {
    return { ready: false, detail: `Active OS image is not cached: ${active.fileName ?? active.id}` };
  }
  if (!selected) {
    return { ready: false, detail: `selected-os.json not published: ${osImage?.selectedOsPath ?? ''}`.trim() };
  }
  const selectedIndex = Number(selected.imageIndex ?? selected.osImageIndex);
  const activeIndex = Number(active.imageIndex);
  const stale = selected.id !== active.id || selected.fileName !== active.fileName || selectedIndex !== activeIndex;
  if (stale) {
    return { ready: false, detail: `selected-os.json is stale for active image ${active.id}.` };
  }
  if (!String(active.fileName ?? '').toLowerCase().endsWith('.wim')) {
    return { ready: false, detail: 'Active OS image must be an exported single WIM.' };
  }
  return { ready: true, detail: `${active.id} -> ${active.fileName} index ${active.imageIndex}` };
}

function profilePayloadStatus(profilePayload) {
  if (!profilePayload) {
    return { ready: false, detail: 'Deployment profile payload has not been evaluated.' };
  }
  return {
    ready: profilePayload.ok === true,
    detail: profilePayload.detail || (profilePayload.ok ? 'Active profile payload is published.' : 'Active profile payload is not published.'),
  };
}

function preflightStatus(preflight) {
  if (!Array.isArray(preflight) || preflight.length === 0) {
    return { ready: false, detail: 'Preflight has not been run in this Web session.' };
  }
  const failures = preflight.filter((check) => check.ok === false);
  if (failures.length > 0) {
    return { ready: false, detail: `${failures.length} preflight check(s) are blocking service start.` };
  }
  const unknown = preflight.filter((check) => check.ok !== true);
  return {
    ready: unknown.length === 0,
    detail: unknown.length === 0
      ? `${preflight.length} preflight check(s) passed.`
      : `${unknown.length} preflight check(s) need review.`,
  };
}

function runtimeInitializationDetailItems(runtime) {
  if (!runtime || runtime.ready === true || runtime.error || !Array.isArray(runtime.missing)) {
    return undefined;
  }
  const items = runtime.missing.map((artifact) => {
    const targets = Array.isArray(artifact.targets) ? artifact.targets : [];
    const firstTarget = targets[0] ?? {};
    const reason = firstTarget.reason ?? 'needs preparation';
    const filePath = firstTarget.filePath ?? '';
    const targetCount = targets.length > 1 ? ` (${targets.length} targets)` : '';
    const targetText = targets.length > 0
      ? `${reason}${filePath ? ` ${filePath}` : ''}${targetCount}`.trim()
      : '';
    const blockedBy = Array.isArray(artifact.blockedBy) ? artifact.blockedBy : [];
    const blockedByText = blockedBy.length > 0
      ? `blocked by ${blockedBy.map((dependency) => dependency.name ?? dependency.id).join(', ')}`
      : '';
    const prepareVerb = artifact.sourceType === 'download'
      ? 'download'
      : artifact.sourceType === 'osd-catalog'
        ? 'prepare'
        : 'rebuild';
    const prepareText = artifact.prepareGroup
      ? `Prepare runtime will ${prepareVerb} ${artifact.prepareGroup}`
      : '';
    const details = [
      targetText,
      blockedByText,
      prepareText,
      artifact.prepareReason,
    ].filter(Boolean);
    const item = {
      title: artifact.name ?? artifact.id,
      meta: [artifact.kind, artifact.sourceType, artifact.prepareGroup].filter(Boolean).join(' / '),
      detail: details.join('; '),
    };
    if (artifact.status) {
      item.status = artifact.status;
    }
    return item;
  });
  return items.length > 0 ? items : undefined;
}

function runtimeReadinessFailureMessage(readiness) {
  const missing = Array.isArray(readiness?.missing) ? readiness.missing : [];
  if (missing.length === 0) {
    return 'Runtime prepare finished, but runtime readiness is still blocked.';
  }
  const details = missing.slice(0, 5).map((artifact) => {
    const target = Array.isArray(artifact.targets) ? artifact.targets[0] : null;
    const targetText = target
      ? `${target.reason ?? 'not-ready'}${target.filePath ? ` ${target.filePath}` : ''}`
      : (artifact.status ?? 'not-ready');
    const blockedBy = Array.isArray(artifact.blockedBy) && artifact.blockedBy.length > 0
      ? ` blocked by ${artifact.blockedBy.map((dependency) => dependency.name ?? dependency.id).join(', ')}`
      : '';
    return `${artifact.name ?? artifact.id}: ${targetText}${blockedBy}`;
  });
  const remaining = missing.length > details.length ? `; ${missing.length - details.length} more` : '';
  return `Runtime prepare finished, but ${missing.length} artifact group(s) are still not ready: ${details.join('; ')}${remaining}`;
}

function buildInitializationState({ config, secrets, runtime, endpoint, osImage, profilePayload, preflight }) {
  const web = webServerConfig(config);
  const webReady = Boolean(web.host) && Number.isInteger(web.port) && web.port >= 0;
  const osImageStatus = osImageDeployableStatus(osImage);
  const profileStatus = profilePayloadStatus(profilePayload);
  const finalPreflight = preflightStatus(preflight);
  const steps = [
    {
      id: 'web',
      label: 'Web service IP',
      required: true,
      done: webReady,
      action: 'setup',
      detail: webReady ? `${web.host}:${web.port}` : 'Set web.host and web.port in the local overlay.',
    },
    {
      id: 'secrets',
      label: 'Deployment secrets',
      required: true,
      done: secrets.ready,
      action: 'secrets',
      detail: secrets.ready ? 'davisPassword and pxeinstallPassword are present.' : `Missing: ${secrets.missing.join(', ')}`,
    },
    {
      id: 'runtime',
      label: 'Prepare runtime',
      required: true,
      done: runtime?.ready === true,
      action: 'prepare-runtime',
      detail: runtime?.ready
        ? `${runtime.readyCount}/${runtime.requiredCount} required artifact group(s) are ready.`
        : runtime?.error ?? `${runtime?.missingCount ?? 'Unknown'} runtime artifact group(s) need preparation.`,
      detailItems: runtimeInitializationDetailItems(runtime),
    },
    {
      id: 'endpoint',
      label: 'PXE/service endpoint',
      required: true,
      done: endpoint.ready,
      action: 'interfaces',
      detail: endpoint.detail,
    },
    {
      id: 'os-image',
      label: 'OS Image Cache',
      required: true,
      done: osImageStatus.ready,
      action: 'os-images',
      detail: osImageStatus.detail,
    },
    {
      id: 'profile',
      label: 'Publish profile',
      required: true,
      done: profileStatus.ready,
      action: 'profiles',
      detail: profileStatus.detail,
    },
    {
      id: 'preflight',
      label: 'Run preflight',
      required: false,
      done: finalPreflight.ready,
      action: 'preflight',
      detail: finalPreflight.detail,
    },
  ];
  const requiredSteps = steps.filter((step) => step.required);
  const nextStep = requiredSteps.find((step) => !step.done) ?? steps.find((step) => !step.done) ?? null;
  return {
    initialized: requiredSteps.every((step) => step.done),
    nextStepId: nextStep?.id ?? null,
    secrets,
    steps,
  };
}

function profileSummary(state) {
  const usageBySoftware = new Map();
  const usageByScript = new Map();
  for (const profile of state.profiles) {
    for (const softwareId of profile.softwareIds) {
      const usedByProfiles = usageBySoftware.get(softwareId) ?? [];
      usedByProfiles.push({ id: profile.id, name: profile.name });
      usageBySoftware.set(softwareId, usedByProfiles);
    }
    for (const entry of profile.customScripts ?? []) {
      const usedByProfiles = usageByScript.get(entry.id) ?? [];
      usedByProfiles.push({ id: profile.id, name: profile.name });
      usageByScript.set(entry.id, usedByProfiles);
    }
  }
  return {
    activeProfile: state.activeProfile,
    softwareCatalog: (state.catalog?.software ?? []).map((software) => ({
      id: software.id,
      name: software.name,
      source: software.source,
      sourcePath: software.sourcePath,
      installScript: software.installScript,
      scriptMode: software.scriptMode,
      installerType: software.installerType,
      installerFileName: software.installerFileName,
      silentArgs: software.silentArgs,
      successExitCodes: software.successExitCodes,
      verifyPath: software.verifyPath,
      verificationMode: software.verificationMode,
      installerBytes: software.installerBytes,
      installerSha256: software.installerSha256,
      usedByProfiles: usageBySoftware.get(software.id) ?? [],
    })),
    customScriptCatalog: (state.scriptCatalog?.scripts ?? []).map((script) => ({
      id: script.id,
      name: script.name,
      source: script.source,
      sourcePath: script.sourcePath,
      scriptFile: script.scriptFile,
      fileName: script.fileName,
      defaultPhase: script.defaultPhase,
      bytes: script.bytes,
      sha256: script.sha256,
      usedByProfiles: usageByScript.get(script.id) ?? [],
    })),
    selectedSoftware: state.selectedSoftware.map((software) => ({
      id: software.id,
      name: software.name,
    })),
    selectedSoftwareText: formatSoftwareList(state.selectedSoftware),
    selectedScripts: (state.selectedScripts ?? []).map((script) => ({
      id: script.id,
      name: script.name,
      phase: script.phase,
    })),
    profiles: state.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      softwareIds: profile.softwareIds,
      customScripts: (profile.customScripts ?? []).map((entry) => ({ id: entry.id, phase: entry.phase })),
      osImageId: profile.osImageId,
    })),
  };
}

function retailOnlyCatalogFilters(filters = {}) {
  const requestedActivation = Array.isArray(filters.activation) ? filters.activation : [];
  const requestedRetail = requestedActivation
    .map((value) => String(value).trim().toLowerCase())
    .some((value) => value === 'retail');
  if (requestedActivation.length > 0 && !requestedRetail) {
    return {
      ...filters,
      activation: ['__retail_only_no_match__'],
    };
  }
  return {
    ...filters,
    activation: ['Retail'],
  };
}

function osImageSummary(state, profileUsage = new Map()) {
  const images = state.images.map((image) => ({
    ...image,
    usedByProfiles: profileUsage.get(image.id) ?? [],
  }));
  return {
    activeImage: state.activeImage,
    activeImageId: state.activeImageId,
    activeLabel: formatOsImageLabel(state.activeImage),
    catalogPath: state.catalogPath,
    downloadSourcesPath: state.downloadSourcesPath,
    cacheRoot: state.cacheRoot,
    downloadStagingRoot: state.downloadStagingRoot,
    selectedOsPath: state.selectedOsPath,
    cacheLogPath: state.cacheLogPath,
    selectedOs: state.selectedOs,
    images,
    cachedFiles: state.cachedFiles,
  };
}

function osImageUsageFromProfiles(profileState) {
  const usage = new Map();
  if (!profileState?.profiles) {
    return usage;
  }
  for (const profile of profileState.profiles) {
    if (!profile.osImageId) continue;
    const usedBy = usage.get(profile.osImageId) ?? [];
    usedBy.push({ id: profile.id, name: profile.name });
    usage.set(profile.osImageId, usedBy);
  }
  return usage;
}

export class ServiceController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dependencies = {
      applyServiceEndpoint,
      createDeploymentProfile,
      createSoftwarePackage,
      createCustomScript,
      deleteDeploymentProfile,
      deleteSoftwarePackage,
      deleteCustomScript,
      evaluateDeploymentProfilePayload,
      deleteStatusRun,
      deleteCachedOsImage,
      downloadOsImageFromCatalog,
      importUploadedOsImage,
      listOsDownloadCatalog,
      listIpv4ServiceInterfaces,
      openSoftwareInstallScript,
      publishSelectedOsImage,
      publishDeploymentProfile,
      prepareRuntimeArtifacts,
      readCustomScriptContent,
      readSoftwareInstallScript,
      readFleetStatus,
      readRecentScreenshotMetadata,
      readRunLatestScreenshot,
      readRunStatusEvents,
      readStatusEvents,
      removeStatusFiles,
      resolveDeploymentProfileState,
      resolveOsImageState,
      runPreflight,
      saveConfig,
      summarizeValidation,
      syncIpxeEndpoint,
      getRuntimeReadiness,
      getDeploymentSecretsStatus: deploymentSecretsStatus,
      tailFile,
      updateDeploymentProfile,
      uploadCustomScript,
      uploadSoftwareInstaller,
      uploadOsImageFile,
      writeDeploymentSecrets,
      ...options.dependencies,
    };
    this.config = options.config ?? loadConfig(options.configPath);
    this.services = options.services ?? {
      dhcp: new DhcpResponder(this.config.dhcp),
      tftp: new TftpResponder(this.config.tftp),
      http: new MediaHttpServer(mediaHttpServerConfig(this.config)),
    };
    this.runtimeLog = new RingBuffer(options.logLimit ?? 500);
    this.preflightResults = [];
    this.endpointUpdateStatus = [];
    this.selectedRunId = null;
    this.osDownloadStatus = null;
    this.osDownloadPromise = null;
    this.osImportStatus = null;
    this.operation = null;
    this.bindServiceEvents();
    for (const line of this.initialLogTail()) {
      this.runtimeLog.push(line);
    }
  }

  bindServiceEvents() {
    for (const [name, service] of Object.entries(this.services)) {
      service.on?.('log', (line) => this.addServiceLog(name.toUpperCase(), line));
      service.on?.('error', (error) => this.addLog(`[${name.toUpperCase()}] ERROR ${error.message}`));
    }
    this.services.http.on?.('status', ({ records }) => {
      for (const record of records ?? []) {
        this.addLog(`[RUN] ${record.type} run=${record.runId} stage=${record.stage ?? ''} message=${record.message ?? ''}`);
      }
    });
    this.services.http.on?.('screenshot', (metadata) => {
      this.addLog(`[SHOT] run=${metadata.runId} stage=${metadata.stage} file=${metadata.filePath}`);
    });
    this.services.http.on?.('driver-pack-cache', (result) => {
      this.addLog(`[DRIVER] ${result.status ?? 'updated'} ${result.fileName ?? ''}`.trim());
    });
  }

  initialLogTail() {
    return [
      ...this.dependencies.tailFile(this.config.dhcp?.logPath, 5).map((line) => formatDisplayLogLine(`[DHCP] ${line}`)),
      ...this.dependencies.tailFile(this.config.tftp?.logPath, 5).map((line) => formatDisplayLogLine(`[TFTP] ${line}`)),
      ...this.dependencies.tailFile(this.config.http?.logPath, 5).map((line) => formatDisplayLogLine(`[HTTP] ${line}`)),
    ];
  }

  addLog(message) {
    const line = formatLogLine(message);
    this.runtimeLog.push(line);
    if (this.operation?.running) {
      this.operation.lines.push(line);
    }
    this.emit('log', line);
    return line;
  }

  addServiceLog(name, line) {
    const display = formatDisplayLogLine(`[${name}] ${line}`);
    this.runtimeLog.push(display);
    if (this.operation?.running) {
      this.operation.lines.push(display);
    }
    this.emit('log', display);
    return display;
  }

  refreshServiceConfigs() {
    if (this.services.dhcp) {
      this.services.dhcp.config = this.config.dhcp;
      this.services.dhcp.refreshLeasePool?.();
    }
    if (this.services.tftp) {
      this.services.tftp.config = this.config.tftp;
    }
    if (this.services.http) {
      this.services.http.config = mediaHttpServerConfig(this.config);
    }
  }

  serviceByName(name) {
    const service = this.services[name];
    if (!service) {
      throw errorWithStatus(`Unknown service: ${name}`, 404);
    }
    return service;
  }

  async runOperation(label, action, options = {}) {
    if (this.operation?.running) {
      throw errorWithStatus(`Operation already running: ${this.operation.label}`, 409);
    }

    this.operation = {
      label,
      mutating: options.mutating !== false,
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      error: null,
      lines: [],
    };
    this.addLog(`[WEB] ${label}`);
    this.emit('operation', this.operation);

    try {
      const result = await action();
      this.operation = {
        ...this.operation,
        running: false,
        finishedAt: new Date().toISOString(),
        status: 'completed',
      };
      this.addLog(`[WEB] ${label} complete`);
      this.emit('operation', this.operation);
      return result;
    } catch (error) {
      this.operation = {
        ...this.operation,
        running: false,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: error.message,
      };
      this.addLog(`[WEB] ${label} failed: ${error.message}`);
      this.emit('operation', this.operation);
      throw error;
    }
  }

  servicesState() {
    return {
      http: serviceSummary(this.services.http, {
        host: this.config.http.host,
        port: this.config.http.port ?? 80,
        root: this.config.http.root,
        statusRoot: this.config.http.statusRoot,
      }),
      tftp: serviceSummary(this.services.tftp, {
        listenIp: this.config.tftp.listenIp,
        port: this.config.tftp.port ?? 69,
        root: this.config.tftp.root,
      }),
      dhcp: serviceSummary(this.services.dhcp, {
        listenIp: this.config.dhcp.listenIp,
        listenPort: this.config.dhcp.listenPort ?? 67,
        leaseStartIp: this.config.dhcp.leaseStartIp,
        leaseEndIp: this.config.dhcp.leaseEndIp,
        router: this.config.dhcp.router,
        bootFile: this.config.dhcp.bootFile,
        ipxeBootUrl: this.config.dhcp.ipxeBootUrl,
      }),
    };
  }

  getLogs(maxLines = 160) {
    return this.runtimeLog.lines().slice(-maxLines);
  }

  getProfiles() {
    const state = this.dependencies.resolveDeploymentProfileState(this.config);
    return profileSummary(state);
  }

  getOsImages() {
    const state = this.dependencies.resolveOsImageState(this.config);
    let usage = new Map();
    try {
      const profileState = this.dependencies.resolveDeploymentProfileState(this.config);
      usage = osImageUsageFromProfiles(profileState);
    } catch {}
    return osImageSummary(state, usage);
  }

  async getOsDownloadCatalog(filters = {}) {
    const rows = await this.dependencies.listOsDownloadCatalog(this.config, {
      filters: retailOnlyCatalogFilters(filters),
    });
    return rows.map((image) => ({
      ...image,
      label: formatOsImageLabel(image),
    }));
  }

  getState(options = {}) {
    if (options.selectedRunId !== undefined) {
      this.selectedRunId = options.selectedRunId || null;
    }

    const fleetResult = safeRead(() => this.dependencies.readFleetStatus(this.config), {
      total: 0,
      counts: {},
      runs: [],
    });
    const fleet = fleetResult.value;
    if (!this.selectedRunId && fleet.runs?.length) {
      this.selectedRunId = fleet.runs[0].runId;
    }
    const selectedRun = fleet.runs?.find((run) => run.runId === this.selectedRunId) ?? fleet.runs?.[0] ?? null;
    if (selectedRun) {
      this.selectedRunId = selectedRun.runId;
    }

    const profileResult = safeRead(() => this.getProfiles(), null);
    const osImageResult = safeRead(() => this.getOsImages(), null);
    const runtimeResult = safeRead(() => this.dependencies.getRuntimeReadiness(this.config), null);
    const secretsResult = safeRead(() => this.dependencies.getDeploymentSecretsStatus(this.config), {
      ready: false,
      missing: ['davisPassword', 'pxeinstallPassword'],
      status: {},
    });
    const endpointResult = safeRead(() => localEndpointOverlayStatus(this.config), {
      ready: false,
      detail: 'Unable to read local endpoint overlay.',
    });
    const profilePayloadResult = safeRead(() => this.dependencies.evaluateDeploymentProfilePayload(this.config), {
      name: 'Deployment profile',
      ok: false,
      detail: 'Deployment profile payload has not been evaluated.',
    });
    const validationResult = safeRead(() => this.dependencies.summarizeValidation(this.config), []);
    const statusEventsResult = safeRead(() => this.dependencies.readStatusEvents(this.config, 80), []);
    const selectedRunEventsResult = safeRead(
      () => this.dependencies.readRunStatusEvents(this.config, selectedRun?.runId, 2000),
      [],
    );
    const screenshotsResult = safeRead(() => this.dependencies.readRecentScreenshotMetadata(this.config, 5), []);
    const selectedScreenshotResult = safeRead(
      () => this.dependencies.readRunLatestScreenshot(this.config, selectedRun?.runId),
      null,
    );

    const state = {
      generatedAt: new Date().toISOString(),
      app: {
        version: appVersion,
      },
      web: webServerConfig(this.config),
      config: {
        adapter: this.config.adapter,
        dhcp: {
          listenIp: this.config.dhcp.listenIp,
          leaseStartIp: this.config.dhcp.leaseStartIp,
          leaseEndIp: this.config.dhcp.leaseEndIp,
          subnetMask: this.config.dhcp.subnetMask,
          router: this.config.dhcp.router,
          dnsServers: this.config.dhcp.dnsServers ?? [],
          bootFile: this.config.dhcp.bootFile,
          ipxeBootUrl: this.config.dhcp.ipxeBootUrl,
        },
        http: {
          host: this.config.http.host,
          port: this.config.http.port ?? 80,
          root: this.config.http.root,
          statusRoot: this.config.http.statusRoot,
        },
        tftp: {
          listenIp: this.config.tftp.listenIp,
          port: this.config.tftp.port ?? 69,
          root: this.config.tftp.root,
        },
        smb: this.config.smb,
      },
      services: this.servicesState(),
      profile: profileResult.error ? { error: profileResult.error } : profileResult.value,
      osImage: osImageResult.error ? { error: osImageResult.error } : osImageResult.value,
      runtime: runtimeResult.error ? { ready: false, error: runtimeResult.error } : runtimeResult.value,
      osDownloadStatus: this.osDownloadStatus,
      osImportStatus: this.osImportStatus,
      preflight: this.preflightResults,
      endpointUpdateStatus: this.endpointUpdateStatus,
      operation: this.operation,
      fleetError: fleetResult.error,
      fleet,
      selectedRunId: this.selectedRunId,
      selectedRun,
      selectedScreenshot: selectedScreenshotResult.value,
      validationError: validationResult.error,
      validation: validationResult.value,
      screenshotsError: screenshotsResult.error,
      screenshots: screenshotsResult.value,
      statusEventsError: statusEventsResult.error,
      statusEvents: statusEventsResult.value,
      selectedRunEventsError: selectedRunEventsResult.error,
      selectedRunEvents: selectedRunEventsResult.value,
      logs: this.getLogs(options.logLines ?? 160),
    };
    state.initialization = buildInitializationState({
      config: this.config,
      secrets: secretsResult.value,
      runtime: state.runtime,
      endpoint: endpointResult.value,
      osImage: osImageResult.error ? null : osImageResult.value,
      profilePayload: profilePayloadResult.value,
      preflight: this.preflightResults,
    });
    return state;
  }

  async listInterfaces() {
    return this.dependencies.listIpv4ServiceInterfaces();
  }

  async runPreflight() {
    return this.runOperation('Running preflight', async () => {
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      return this.preflightResults;
    });
  }

  async prepareRuntime() {
    return this.runOperation('Preparing runtime artifacts', async () => {
      const stream = makeOutputLogger((line) => this.addLog(line), '[runtime]');
      try {
        const output = await this.dependencies.prepareRuntimeArtifacts(this.config, {
          onOutput: stream.write,
        });
        const readiness = this.dependencies.getRuntimeReadiness(this.config);
        if (readiness.ready !== true) {
          throw errorWithStatus(runtimeReadinessFailureMessage(readiness), 500);
        }
        return {
          output,
          readiness,
        };
      } finally {
        stream.flush();
      }
    });
  }

  async saveDeploymentSecrets(input) {
    return this.runOperation('Saving deployment secrets', async () => this.dependencies.writeDeploymentSecrets(this.config, input));
  }

  async startService(name) {
    return this.runOperation(`Starting ${name}`, async () => {
      await this.serviceByName(name).start();
      return this.servicesState()[name];
    });
  }

  async stopService(name) {
    return this.runOperation(`Stopping ${name}`, async () => {
      await this.serviceByName(name).stop();
      return this.servicesState()[name];
    });
  }

  async startAll() {
    return this.runOperation('Starting all services', async () => {
      await this.services.http.start();
      await this.services.tftp.start();
      await this.services.dhcp.start();
      return this.servicesState();
    });
  }

  async stopAll() {
    return this.runOperation('Stopping all services', async () => {
      await this.stopAllServices();
      return this.servicesState();
    });
  }

  async stopAllServices() {
    await Promise.allSettled([
      this.services.dhcp.stop(),
      this.services.tftp.stop(),
      this.services.http.stop(),
    ]);
  }

  async changeEndpoint(choice) {
    return this.runOperation('Applying service endpoint', async () => {
      this.endpointUpdateStatus = [];
      this.addEndpointStatus(`Selected ${choice.interfaceAlias ?? choice.InterfaceAlias} ${choice.ipAddress ?? choice.IPAddress}/${choice.prefixLength ?? choice.PrefixLength}`, 'run');
      await this.stopAllServices();
      this.addEndpointStatus('Stopped running services before endpoint sync', 'ok');
      const previousEndpoint = `${this.config.adapter.interfaceAlias} ${this.config.adapter.serverIp}/${this.config.adapter.prefixLength}`;
      const previousBootUrl = this.config.dhcp.ipxeBootUrl;

      this.addEndpointStatus('Updating config for DHCP, TFTP, HTTP/status, and SMB', 'run');
      this.dependencies.applyServiceEndpoint(this.config, choice);
      const savedPath = this.dependencies.saveConfig(this.config);
      this.refreshServiceConfigs();
      this.addEndpointStatus(`Saved ${savedPath}`, 'ok');
      this.addEndpointStatus(`Endpoint ${previousEndpoint} -> ${this.config.adapter.interfaceAlias} ${this.config.adapter.serverIp}/${this.config.adapter.prefixLength}`, 'ok');
      this.addEndpointStatus(`iPXE boot URL ${previousBootUrl} -> ${this.config.dhcp.ipxeBootUrl}`, 'ok');

      this.addEndpointStatus('Syncing boot.ipxe, WinPE endpoint, SMB firewall, boot.wim, and osdcloud-assets', 'run');
      const stream = makeOutputLogger((line) => this.addLog(line), '[endpoint-sync]');
      try {
        await this.dependencies.syncIpxeEndpoint(this.config, {
          commitWinPe: true,
          syncAssets: true,
          hashLargeArtifacts: true,
          onOutput: stream.write,
        });
      } finally {
        stream.flush();
      }
      this.addEndpointStatus('Endpoint files synced and published boot.wim verified', 'ok');

      this.addEndpointStatus('Running preflight against the new endpoint', 'run');
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      const failures = this.preflightResults.filter((item) => !item.ok).length;
      this.addEndpointStatus(failures === 0 ? 'Preflight passed' : `Preflight completed with ${failures} failure(s)`, failures === 0 ? 'ok' : 'fail');
      return {
        configPath: savedPath,
        preflight: this.preflightResults,
        endpointUpdateStatus: this.endpointUpdateStatus,
      };
    });
  }

  addEndpointStatus(message, status = 'info') {
    const line = `[${status}] ${message}`;
    this.endpointUpdateStatus.push(line);
    this.addLog(`[endpoint] ${message}`);
  }

  async changeDeploymentProfile(profileId) {
    return this.runOperation('Publishing deployment profile', async () => {
      await this.stopAllServices();
      this.preflightResults = [];
      const result = await this.dependencies.publishDeploymentProfile(this.config, profileId, {
        publishOsImage: this.dependencies.publishSelectedOsImage,
      });
      this.config.deploymentProfiles ??= {};
      this.config.deploymentProfiles.activeProfile = result.profile.id;
      const savedPath = this.dependencies.saveConfig(this.config);
      this.addLog(`Published deployment profile ${result.profile.id}: ${formatSoftwareList(result.selectedSoftware)}`);
      if (result.osImage?.image) {
        this.addLog(`Published OS image ${result.osImage.image.id}: ${formatOsImageLabel(result.osImage.image)}`);
      }
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      return {
        configPath: savedPath,
        profile: result.profile,
        selectedSoftware: result.selectedSoftware,
        appsRoot: result.appsRoot,
        osImage: result.osImage,
        preflight: this.preflightResults,
      };
    });
  }

  async downloadOsImage(catalogId) {
    const job = this.startOsDownload(catalogId);
    return job.promise;
  }

  async deleteOsImage(imageId) {
    if (this.osDownloadStatus?.running) {
      throw errorWithStatus(`Operation already running: Downloading OS image ${this.osDownloadStatus.catalogId}`, 409);
    }
    return this.runOperation('Deleting OS image', async () => {
      let referencedByProfiles = [];
      try {
        const profileState = this.dependencies.resolveDeploymentProfileState(this.config);
        referencedByProfiles = profileState.profiles
          .filter((profile) => profile.osImageId === imageId)
          .map((profile) => ({ id: profile.id, name: profile.name }));
      } catch {}
      const result = await this.dependencies.deleteCachedOsImage(this.config, imageId, {
        referencedByProfiles,
      });
      this.addLog(`Deleted OS image ${result.image.id}: ${result.fileDeleted ? result.filePath : 'catalog entry only'}`);
      return result;
    });
  }

  startOsDownload(catalogId) {
    if (this.osDownloadStatus?.running) {
      throw errorWithStatus(`Operation already running: Downloading OS image ${this.osDownloadStatus.catalogId}`, 409);
    }

    const jobId = `os-download-${Date.now()}`;
    this.osDownloadStatus = {
      jobId,
      catalogId,
      status: 'starting',
      running: true,
      bytes: 0,
      totalBytes: null,
      fileName: null,
      imageId: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    this.addLog(`[WEB] Downloading OS image ${catalogId}`);
    this.emit('operation', this.operation);

    const promise = Promise.resolve().then(() => this.dependencies.downloadOsImageFromCatalog(this.config, catalogId, {
      onProgress: (progress) => {
        this.osDownloadStatus = {
          ...this.osDownloadStatus,
          ...progress,
          jobId,
          catalogId,
          running: true,
          error: null,
        };
        this.emit('operation', this.operation);
      },
    })).then((result) => {
      this.osDownloadStatus = {
        ...this.osDownloadStatus,
        jobId,
        catalogId,
        status: result.status,
        running: false,
        bytes: result.bytes,
        fileName: result.image.fileName,
        imageId: result.image.id,
        finishedAt: new Date().toISOString(),
        error: null,
      };
      this.addLog(`OS image ${result.status}: ${result.image.id} ${result.image.fileName}`);
      return result;
    }).catch((error) => {
      this.osDownloadStatus = {
        ...this.osDownloadStatus,
        jobId,
        catalogId,
        status: 'failed',
        running: false,
        finishedAt: new Date().toISOString(),
        error: error.message,
      };
      this.addLog(`[WEB] Downloading OS image failed: ${error.message}`);
      throw error;
    }).finally(() => {
      if (this.osDownloadPromise === promise) {
        this.osDownloadPromise = null;
      }
    });
    promise.catch(() => {});
    this.osDownloadPromise = promise;
    return {
      ...this.osDownloadStatus,
      promise,
    };
  }

  async uploadOsImage(input) {
    return this.runOperation('Uploading OS image source', async () => {
      this.osImportStatus = {
        sourcePath: input?.fileName,
        status: 'uploading',
        bytes: 0,
        totalBytes: input?.size ?? null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
      try {
        const result = await this.dependencies.uploadOsImageFile(this.config, input, {
          onProgress: (progress) => {
            this.osImportStatus = {
              ...this.osImportStatus,
              ...progress,
            };
            this.emit('operation', this.operation);
          },
        });
        this.osImportStatus = {
          ...this.osImportStatus,
          status: 'uploaded',
          bytes: result.bytes,
          fileName: result.originalFileName,
          uploadId: result.uploadId,
          sourcePath: result.sourcePath,
          finishedAt: new Date().toISOString(),
        };
        this.addLog(`OS image uploaded: ${result.uploadId} ${result.originalFileName}`);
        return result;
      } catch (error) {
        this.osImportStatus = {
          ...this.osImportStatus,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: error.message,
        };
        throw error;
      }
    });
  }

  async importUploadedOsImage(input) {
    return this.runOperation('Importing uploaded OS image', async () => {
      this.osImportStatus = {
        uploadId: input?.uploadId,
        imageIndex: input?.imageIndex ?? input?.index,
        status: 'starting',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
      try {
        const result = await this.dependencies.importUploadedOsImage(this.config, input);
        this.osImportStatus = {
          ...this.osImportStatus,
          status: result.status,
          bytes: result.bytes,
          fileName: result.image.fileName,
          imageId: result.image.id,
          finishedAt: new Date().toISOString(),
        };
        this.addLog(`OS image ${result.status}: ${result.image.id} ${result.image.fileName}`);
        return result;
      } catch (error) {
        this.osImportStatus = {
          ...this.osImportStatus,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: error.message,
        };
        throw error;
      }
    });
  }

  async addDeploymentProfile(input) {
    return this.runOperation('Creating deployment profile', async () => {
      const created = this.dependencies.createDeploymentProfile(this.config, input);
      this.addLog(`Created deployment profile ${created.profile.id}: ${created.profile.softwareIds.join(', ') || 'none'}`);
      return created;
    });
  }

  async uploadSoftwareInstaller(input) {
    return this.runOperation('Uploading software installer', async () => {
      const uploaded = await this.dependencies.uploadSoftwareInstaller(this.config, input);
      this.addLog(`Uploaded software installer ${uploaded.fileName}: ${uploaded.bytes} bytes sha256=${uploaded.sha256}`);
      return uploaded;
    });
  }

  async addSoftwarePackage(input) {
    return this.runOperation('Adding software package', async () => {
      const created = await this.dependencies.createSoftwarePackage(this.config, input);
      this.addLog(`Added software package ${created.software.id}: ${created.software.installerFileName}`);
      return created;
    });
  }

  async removeSoftwarePackage(softwareId) {
    return this.runOperation('Deleting software package', async () => {
      const deleted = this.dependencies.deleteSoftwarePackage(this.config, softwareId);
      this.addLog(`Deleted software package ${deleted.software.id}: ${deleted.software.source}`);
      return deleted;
    });
  }

  async uploadCustomScript(input) {
    return this.runOperation('Uploading custom script', async () => {
      const uploaded = await this.dependencies.uploadCustomScript(this.config, input);
      this.addLog(`Uploaded custom script ${uploaded.fileName}: ${uploaded.bytes} bytes sha256=${uploaded.sha256}`);
      return uploaded;
    });
  }

  async addCustomScript(input) {
    return this.runOperation('Adding custom script', async () => {
      const created = await this.dependencies.createCustomScript(this.config, input);
      this.addLog(`Added custom script ${created.script.id}: ${created.script.fileName} (${created.script.defaultPhase})`);
      return created;
    });
  }

  async removeCustomScript(scriptId) {
    return this.runOperation('Deleting custom script', async () => {
      const deleted = this.dependencies.deleteCustomScript(this.config, scriptId);
      this.addLog(`Deleted custom script ${deleted.script?.id ?? scriptId}`);
      return deleted;
    });
  }

  readCustomScriptContent(scriptId) {
    return this.dependencies.readCustomScriptContent(this.config, scriptId);
  }

  readSoftwareInstallScript(softwareId) {
    return this.dependencies.readSoftwareInstallScript(this.config, softwareId);
  }

  async openSoftwareInstallScript(softwareId) {
    return this.runOperation('Opening software install script', async () => {
      const result = await this.dependencies.openSoftwareInstallScript(this.config, softwareId);
      this.addLog(`Opened software install script ${result.softwareId}: ${result.filePath}`);
      return result;
    });
  }

  async updateActiveDeploymentProfileSoftware(softwareIds) {
    return this.updateActiveDeploymentProfile({ softwareIds });
  }

  async updateActiveDeploymentProfile(input = {}) {
    return this.runOperation('Saving deployment profile', async () => {
      const state = this.dependencies.resolveDeploymentProfileState(this.config);
      const activeId = state.activeProfile.id;
      const targetId = input.profileId ?? input.id ?? activeId;
      const editingActive = targetId === activeId;
      const updateInput = {
        name: input.name,
        description: input.description,
        softwareIds: input.softwareIds ?? input.software,
        customScripts: input.customScripts,
        osImageId: input.osImageId,
      };
      if (!editingActive) {
        const updated = this.dependencies.updateDeploymentProfile(this.config, targetId, updateInput);
        this.addLog(`Saved inactive deployment profile ${updated.profile.id}: ${updated.profile.softwareIds.join(', ') || 'none'}`);
        return { profile: updated.profile };
      }
      await this.stopAllServices();
      this.preflightResults = [];
      const updated = this.dependencies.updateDeploymentProfile(this.config, activeId, updateInput);
      const result = await this.dependencies.publishDeploymentProfile(this.config, updated.profile.id, {
        publishOsImage: this.dependencies.publishSelectedOsImage,
      });
      this.addLog(`Saved deployment profile ${updated.profile.id}: ${formatSoftwareList(result.selectedSoftware)}`);
      if (result.osImage?.image) {
        this.addLog(`Published OS image ${result.osImage.image.id}: ${formatOsImageLabel(result.osImage.image)}`);
      }
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      return {
        profile: updated.profile,
        selectedSoftware: result.selectedSoftware,
        appsRoot: result.appsRoot,
        osImage: result.osImage,
        preflight: this.preflightResults,
      };
    });
  }

  async removeDeploymentProfile(profileId) {
    return this.runOperation('Deleting deployment profile', async () => {
      const deleted = this.dependencies.deleteDeploymentProfile(this.config, profileId);
      this.addLog(`Deleted deployment profile ${deleted.profile.id}`);
      return deleted;
    });
  }

  async clearStatusFiles() {
    return this.runOperation('Clearing status files', async () => {
      const removed = this.dependencies.removeStatusFiles(this.config);
      this.selectedRunId = null;
      this.addLog(`Removed ${removed} status files`);
      return { removed };
    });
  }

  async deleteStatusRun(runId) {
    return this.runOperation('Deleting status run', async () => {
      const deleted = this.dependencies.deleteStatusRun(this.config, runId);
      if (this.selectedRunId === deleted.runId) {
        this.selectedRunId = null;
      }
      this.addLog(`Deleted deployment run ${deleted.runId}: removed ${deleted.removed} artifacts`);
      return deleted;
    });
  }

  async shutdown() {
    await this.stopAllServices();
  }
}
