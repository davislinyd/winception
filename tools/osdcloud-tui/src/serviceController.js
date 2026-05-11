import { EventEmitter } from 'node:events';
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
import { formatSoftwareList, publishDeploymentProfile, resolveDeploymentProfileState } from './deploymentProfiles.js';
import { formatLogLine, RingBuffer, tailFile } from './logger.js';
import {
  listIpv4ServiceInterfaces,
  removeStatusFiles,
  runPreflight,
  syncIpxeEndpoint,
} from './windows.js';
import {
  readFleetStatus,
  readRecentScreenshotMetadata,
  readRunLatestScreenshot,
  readStatusEvents,
  summarizeValidation,
} from './status.js';
import { formatDisplayLogLine } from './timeFormat.js';

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

function profileSummary(state) {
  return {
    activeProfile: state.activeProfile,
    selectedSoftware: state.selectedSoftware.map((software) => ({
      id: software.id,
      name: software.name,
    })),
    selectedSoftwareText: formatSoftwareList(state.selectedSoftware),
    profiles: state.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      softwareIds: profile.softwareIds,
    })),
  };
}

export class ServiceController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dependencies = {
      applyServiceEndpoint,
      listIpv4ServiceInterfaces,
      publishDeploymentProfile,
      readFleetStatus,
      readRecentScreenshotMetadata,
      readRunLatestScreenshot,
      readStatusEvents,
      removeStatusFiles,
      resolveDeploymentProfileState,
      runPreflight,
      saveConfig,
      summarizeValidation,
      syncIpxeEndpoint,
      tailFile,
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
    const validationResult = safeRead(() => this.dependencies.summarizeValidation(this.config), []);
    const statusEventsResult = safeRead(() => this.dependencies.readStatusEvents(this.config, 80), []);
    const screenshotsResult = safeRead(() => this.dependencies.readRecentScreenshotMetadata(this.config, 5), []);
    const selectedScreenshotResult = safeRead(
      () => this.dependencies.readRunLatestScreenshot(this.config, selectedRun?.runId),
      null,
    );

    return {
      generatedAt: new Date().toISOString(),
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
      logs: this.getLogs(options.logLines ?? 160),
    };
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
      const result = this.dependencies.publishDeploymentProfile(this.config, profileId);
      this.config.deploymentProfiles ??= {};
      this.config.deploymentProfiles.activeProfile = result.profile.id;
      const savedPath = this.dependencies.saveConfig(this.config);
      this.addLog(`Published deployment profile ${result.profile.id}: ${formatSoftwareList(result.selectedSoftware)}`);
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      return {
        configPath: savedPath,
        profile: result.profile,
        selectedSoftware: result.selectedSoftware,
        appsRoot: result.appsRoot,
        preflight: this.preflightResults,
      };
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

  async shutdown() {
    await this.stopAllServices();
  }
}
