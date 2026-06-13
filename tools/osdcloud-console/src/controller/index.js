import path from 'node:path';
import { applyProjectRoot, applyServiceEndpoint, loadConfig, mediaHttpServerConfig, saveConfig, torrentServerConfig, webServerConfig, workspaceInfo } from '../config.js';
import { DhcpResponder } from '../dhcp.js';
import { summarizeDriverPackCache } from '../driverPackCache.js';
import { MediaHttpServer } from '../httpServer.js';
import { RingBuffer, appendLog, tailFile } from '../logger.js';
import { formatOsImageLabel, publishSelectedOsImage, resolveOsImageState } from '../osimages/catalog.js';
import { downloadOsImageFromCatalog, listOsDownloadCatalog } from '../osimages/download.js';
import { deleteCachedOsImage } from '../osimages/maintenance.js';
import { importUploadedOsImage, uploadOsImageFile } from '../osimages/transfer.js';
import { createDeploymentProfile, deleteDeploymentProfile, evaluateDeploymentProfilePayload, resolveDeploymentProfileState, updateDeploymentProfile } from '../profiles/profiles.js';
import { publishDeploymentProfile } from '../profiles/publish.js';
import { createCustomScript, deleteCustomScript, readCustomScriptContent, uploadCustomScript } from '../profiles/scripts.js';
import { createSoftwarePackage, deleteSoftwarePackage, formatSoftwareList, openSoftwareInstallScript, readSoftwareInstallScript, uploadSoftwareInstaller } from '../profiles/software.js';
import { getRuntimeReadiness } from '../runtimeArtifacts.js';
import { deleteStatusRun, readFleetStatus, readRecentScreenshotMetadata, readRunLatestScreenshot, readRunStatusEvents, readStatusEvents, summarizeValidation } from '../status.js';
import { TftpResponder } from '../tftp.js';
import { formatDisplayLogLine } from '../timeFormat.js';
import { TorrentSeeder, TorrentTracker, createOsImageTorrent } from '../torrent.js';
import { appVersion } from '../version.js';
import { syncIpxeEndpoint } from '../windows/bootArtifacts.js';
import { listIpv4ServiceInterfaces } from '../windows/network.js';
import { isElevatedSync } from '../windows/powershell.js';
import { prepareRuntimeArtifacts, removeStatusFiles, runPreflight } from '../windows/preflight.js';
import { EventEmitter } from 'node:events';
import { deploymentSecretsStatus, errorWithStatus, isBenignObjectSecurityTypeDataLine, localEndpointOverlayStatus, makeOutputLogger, safeRead, serviceSummary, softwarePayloadLogLines, writeDeploymentSecrets } from './helpers.js';
import { buildInitializationState, osImageSummary, osImageUsageFromProfiles, profileSummary, retailOnlyCatalogFilters, runtimeReadinessFailureMessage } from './state.js';

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
      summarizeDriverPackCache,
      summarizeValidation,
      syncIpxeEndpoint,
      createOsImageTorrent,
      isElevated: isElevatedSync,
      getRuntimeReadiness,
      getDeploymentSecretsStatus: deploymentSecretsStatus,
      tailFile,
      appendLog,
      updateDeploymentProfile,
      uploadCustomScript,
      uploadSoftwareInstaller,
      uploadOsImageFile,
      writeDeploymentSecrets,
      applyProjectRoot,
      ...options.dependencies,
    };
    this.config = options.config ?? loadConfig(options.configPath);
    this.services = options.services ?? {
      dhcp: new DhcpResponder(this.config.dhcp),
      tftp: new TftpResponder(this.config.tftp),
      http: new MediaHttpServer(mediaHttpServerConfig(this.config)),
      torrent: new TorrentTracker(torrentServerConfig(this.config)),
      torrentSeeder: new TorrentSeeder(torrentServerConfig(this.config)),
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

  hostLogPath() {
    return this.config.dhcp?.logPath || path.join(this.config.paths?.logsDir || 'C:\\OSDCloud\\logs', 'host-services.log');
  }

  initialLogTail() {
    const logPath = this.hostLogPath();
    return this.dependencies.tailFile(logPath, 15).map((line) => formatDisplayLogLine(line));
  }

  addLog(message) {
    const logPath = this.hostLogPath();
    const line = this.dependencies.appendLog(logPath, message, { appName: 'WEB-OP' });
    const display = formatDisplayLogLine(line);
    this.runtimeLog.push(display);
    if (this.operation?.running) {
      this.operation.lines.push(display);
    }
    this.emit('log', display);
    return line;
  }

  addOperationVerboseLog(message, logPath, appName = 'WEB-OP') {
    const line = this.dependencies.appendLog(logPath, message, { appName });
    const display = formatDisplayLogLine(line);
    this.runtimeLog.push(display);
    if (this.operation?.running) {
      this.operation.lines.push(display);
    }
    this.emit('log', display);
    return line;
  }

  addServiceLog(name, line) {
    const display = formatDisplayLogLine(line);
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
    if (this.services.torrent) {
      this.services.torrent.config = torrentServerConfig(this.config);
    }
    if (this.services.torrentSeeder) {
      this.services.torrentSeeder.config = torrentServerConfig(this.config);
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
        bootMode: this.config.dhcp.bootMode ?? 'secureboot',
        bootFile: this.config.dhcp.bootFile,
        secureBootFile: this.config.dhcp.secureBootFile ?? 'bootmgfw.efi',
        ipxeBootUrl: this.config.dhcp.ipxeBootUrl,
      }),
      torrent: serviceSummary(this.services.torrent, {
        enabled: this.config.torrent?.enabled !== false,
        serverIp: torrentServerConfig(this.config).serverIp,
        trackerPort: this.config.torrent?.trackerPort ?? 6969,
        seederRunning: Boolean(this.services.torrentSeeder?.running),
        seeding: this.services.torrentSeeder?.seeding ?? null,
        swarmPeers: this.services.torrent?.getSwarmPeers?.() ?? [],
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
      missing: ['windowsUsername', 'windowsPassword', 'pxeinstallPassword'],
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
    const elevatedResult = safeRead(() => this.dependencies.isElevated(), null);

    const state = {
      generatedAt: new Date().toISOString(),
      app: {
        version: appVersion,
      },
      host: {
        elevated: elevatedResult.value,
        elevationError: elevatedResult.error,
      },
      web: webServerConfig(this.config),
      config: {
        workspace: workspaceInfo(this.config),
        adapter: this.config.adapter,
        dhcp: {
          listenIp: this.config.dhcp.listenIp,
          leaseStartIp: this.config.dhcp.leaseStartIp,
          leaseEndIp: this.config.dhcp.leaseEndIp,
          subnetMask: this.config.dhcp.subnetMask,
          router: this.config.dhcp.router,
          dnsServers: this.config.dhcp.dnsServers ?? [],
          bootMode: this.config.dhcp.bootMode ?? 'secureboot',
          bootFile: this.config.dhcp.bootFile,
          secureBootFile: this.config.dhcp.secureBootFile ?? 'bootmgfw.efi',
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
        driverPackCache: this.config.driverPackCache,
      },
      services: this.servicesState(),
      profile: profileResult.error ? { error: profileResult.error } : profileResult.value,
      osImage: osImageResult.error ? { error: osImageResult.error } : osImageResult.value,
      runtime: runtimeResult.error ? { ready: false, error: runtimeResult.error } : runtimeResult.value,
      driverPackCache: safeRead(() => this.dependencies.summarizeDriverPackCache(this.config), { enabled: false, entries: [] }).value,
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
      services: state.services,
      fleet,
      elevated: elevatedResult.value,
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
      if (this.dependencies.isElevated() !== true) {
        throw errorWithStatus('Prepare runtime requires an elevated Web console session. Restart the Web console from an elevated PowerShell window and try again.', 400);
      }
      const logsDir = this.config.paths?.logsDir || path.join(this.config.paths?.osdCloudRoot || 'C:\\OSDCloud', 'logs');
      const prepareLogPath = path.join(logsDir, 'runtime-prepare.log');
      const stream = makeOutputLogger((line) => this.addOperationVerboseLog(line, prepareLogPath, 'WEB-OP-PREPARE'), '[runtime]', {
        ignoreLine: isBenignObjectSecurityTypeDataLine,
      });
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
    return this.runOperation('Saving deployment secrets', async () => {
      const result = await this.dependencies.writeDeploymentSecrets(this.config, input);
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      return result;
    });
  }

  async updateProjectRoot(input = {}) {
    return this.runOperation('Saving project root', async () => {
      await this.stopAllServices();
      const runtimeRoot = 'C:\\OSDCloud';
      this.dependencies.applyProjectRoot(this.config, runtimeRoot);
      const savedPath = this.dependencies.saveConfig(this.config);
      this.refreshServiceConfigs();
      this.preflightResults = [];
      this.addLog(`Saved project root ${workspaceInfo(this.config).runtimeRoot} to ${savedPath}`);
      return {
        savedPath,
        workspace: workspaceInfo(this.config),
      };
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
      // Torrent is an accelerator with SMB fallback; a tracker start failure must
      // not abort the core deployment services that already came up.
      if (this.config.torrent?.enabled !== false) {
        try {
          await this.services.torrent?.start();
          await this.services.torrentSeeder?.start();
        } catch (error) {
          this.addLog(`[TORRENT] start failed (continuing with SMB fallback): ${error.message}`);
        }
      }
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
      this.services.torrent?.stop() ?? Promise.resolve(),
      this.services.torrentSeeder?.stop() ?? Promise.resolve(),
    ]);
  }

  // Best-effort (re)generation of the active OS image .torrent + sidecar manifest.
  // Called after profile publish and endpoint sync (announce/webseed URLs embed
  // the service IP). Never throws: torrent is optional and falls back to SMB.
  async regenerateOsTorrent() {
    if (this.config.torrent?.enabled === false) {
      return null;
    }
    let osImage;
    try {
      osImage = this.getOsImages();
    } catch {
      return null;
    }
    const active = osImage?.activeImage;
    const fileName = active?.fileName;
    if (!fileName || !String(fileName).toLowerCase().endsWith('.wim') || !active.cached) {
      return null;
    }
    try {
      const meta = await this.dependencies.createOsImageTorrent(this.config, { fileName });
      this.addLog(`Generated OS image torrent ${meta.fileName} (piece=${meta.pieceLengthBytes}B sha256=${meta.wimSha256.slice(0, 12)}...)`);
      // If the seeder was already running, restart it so it seeds the new torrent.
      const seeder = this.services.torrentSeeder;
      if (seeder?.running) {
        try {
          await seeder.stop();
          await seeder.start();
          this.addLog(`Torrent seeder restarted for ${meta.fileName}`);
        } catch (error) {
          this.addLog(`Torrent seeder restart skipped: ${error.message}`);
        }
      }
      return meta;
    } catch (error) {
      this.addLog(`OS image torrent generation skipped: ${error.message}`);
      return null;
    }
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

      this.addEndpointStatus('Syncing boot.ipxe, repo-sourced endpoint files, SMB firewall, and boot.wim', 'run');
      const logsDir = this.config.paths?.logsDir || path.join(this.config.paths?.osdCloudRoot || 'C:\\OSDCloud', 'logs');
      const syncLogPath = path.join(logsDir, 'endpoint-sync.log');
      const stream = makeOutputLogger((line) => this.addOperationVerboseLog(line, syncLogPath, 'WEB-OP-SYNC'), '[endpoint-sync]');
      try {
        await this.dependencies.syncIpxeEndpoint(this.config, {
          commitWinPe: true,
          syncAssets: false,
          hashLargeArtifacts: true,
          onOutput: stream.write,
        });
      } finally {
        stream.flush();
      }
      this.addEndpointStatus('Endpoint files synced and published boot.wim verified', 'ok');

      // Announce/webseed URLs embed the service IP, so regenerate the OS torrent
      // whenever the endpoint changes (no-op when torrent is disabled or no image).
      await this.regenerateOsTorrent();

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

  async changeBootMode(mode) {
    if (!['secureboot', 'ipxe'].includes(mode)) {
      throw errorWithStatus(`Invalid boot mode: ${mode}. Expected secureboot or ipxe.`, 400);
    }
    return this.runOperation('Changing client boot mode', async () => {
      await this.stopAllServices();
      const previousMode = this.config.dhcp.bootMode ?? 'secureboot';
      this.config.dhcp.bootMode = mode;
      this.config.dhcp.secureBootFile ??= 'bootmgfw.efi';
      const savedPath = this.dependencies.saveConfig(this.config);
      this.refreshServiceConfigs();
      this.addLog(`Client boot mode ${previousMode} -> ${mode} (saved ${savedPath})`);
      this.preflightResults = await this.dependencies.runPreflight(this.config, this.services);
      return {
        configPath: savedPath,
        bootMode: mode,
        preflight: this.preflightResults,
      };
    });
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
      for (const line of softwarePayloadLogLines(result.softwarePayloads)) {
        this.addLog(line);
      }
      if (result.osImage?.image) {
        this.addLog(`Published OS image ${result.osImage.image.id}: ${formatOsImageLabel(result.osImage.image)}`);
      }
      await this.regenerateOsTorrent();
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
      phase: 'starting',
      message: 'Starting OS image download...',
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
        phase: result.status,
        message: `Cached ${result.image.fileName}.`,
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
      this.addLog(`Added custom script ${created.script.id}: ${created.script.fileName}`);
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
        installSequence: input.installSequence,
        execution: input.execution,
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
      for (const line of softwarePayloadLogLines(result.softwarePayloads)) {
        this.addLog(line);
      }
      if (result.osImage?.image) {
        this.addLog(`Published OS image ${result.osImage.image.id}: ${formatOsImageLabel(result.osImage.image)}`);
      }
      await this.regenerateOsTorrent();
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
