import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  applyServiceEndpoint,
  applyProjectRoot,
  loadConfig,
  mediaHttpServerConfig,
  saveConfig,
  stateRootForConfig,
  torrentServerConfig,
  webServerConfig,
  workspaceInfo,
} from './config.js';
import { DhcpResponder } from './dhcp.js';
import { TftpResponder } from './tftp.js';
import { MediaHttpServer } from './httpServer.js';
import { TorrentTracker, TorrentSeeder, createOsImageTorrent } from './torrent.js';
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
import { formatLogLine, RingBuffer, tailFile, appendLog } from './logger.js';
import {
  isElevatedSync,
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
import { summarizeDriverPackCache } from './driverPackCache.js';

const RESERVED_WINDOWS_USERNAMES = new Set([
  'administrator', 'guest', 'defaultaccount', 'wdagutilityaccount', 'system',
]);

function errorWithStatus(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isBenignObjectSecurityTypeDataLine(line) {
  const text = String(line ?? '');
  if (!/TypeData\s+"System\.Security\.AccessControl\.ObjectSecurity"/u.test(text)) {
    return false;
  }
  return /成員已經存在|member\s+.+?\s+is\s+already\s+present|already\s+present|already\s+exists/iu.test(text);
}

function makeOutputLogger(writeLine, prefix, options = {}) {
  let pending = '';
  return {
    write(chunk, stream = 'stdout') {
      pending += String(chunk ?? '');
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() && !options.ignoreLine?.(line)) {
          writeLine(`${prefix} ${stream}: ${line}`);
        }
      }
    },
    flush() {
      if (pending.trim() && !options.ignoreLine?.(pending)) {
        writeLine(`${prefix} ${pending}`);
      }
      pending = '';
    },
  };
}

function softwarePayloadLogLines(payloads = []) {
  return payloads
    .filter((payload) => payload?.status === 'reused' || payload?.status === 'downloaded')
    .map((payload) => `Software payload ${payload.status}: ${payload.id}`);
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

function stateRootPathForConfig(config) {
  return stateRootForConfig(config);
}

function deploymentSecretsPath(config) {
  const configured = config.deploymentSecrets?.path;
  if (configured) {
    return path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(stateRootPathForConfig(config), configured);
  }
  return path.join(stateRootPathForConfig(config), 'config', 'osdcloud-secrets.json');
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
    ['windowsUsername', 'OSDCLOUD_WINDOWS_USERNAME'],
    ['windowsPassword', 'OSDCLOUD_WINDOWS_PASSWORD'],
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

  // The account name is not a secret; expose it so the Web console can
  // pre-fill it when re-editing credentials. The passwords are never returned.
  const resolvedUsername = (!fileError && hasSecretValue(fileSecrets?.windowsUsername))
    ? String(fileSecrets.windowsUsername).trim()
    : hasSecretValue(env?.OSDCLOUD_WINDOWS_USERNAME)
      ? String(env.OSDCLOUD_WINDOWS_USERNAME).trim()
      : null;

  return {
    ready: missing.length === 0,
    filePath,
    fileExists,
    fileError,
    missing,
    status,
    windowsUsername: resolvedUsername,
  };
}

function writeDeploymentSecrets(config, input = {}) {
  const windowsUsername = String(input.windowsUsername ?? '').trim();
  const windowsPassword = String(input.windowsPassword ?? '').trim();
  if (!hasSecretValue(windowsUsername)) {
    throw errorWithStatus('windowsUsername is required.', 400);
  }
  if (!hasSecretValue(windowsPassword)) {
    throw errorWithStatus('windowsPassword is required.', 400);
  }
  if (RESERVED_WINDOWS_USERNAMES.has(windowsUsername.toLowerCase())) {
    throw errorWithStatus(
      `windowsUsername "${windowsUsername}" is a reserved Windows account name. `
      + 'Choose a different account name (the built-in Administrator account is disabled during deployment).',
      400,
    );
  }

  // Generate a 24-character alphanumeric random password (no special characters)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let pxeinstallPassword = '';
  for (let i = 0; i < 24; i++) {
    pxeinstallPassword += chars[crypto.randomInt(chars.length)];
  }

  const filePath = deploymentSecretsPath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ windowsUsername, windowsPassword, pxeinstallPassword }, null, 2)}\n`, 'utf8');
  return deploymentSecretsStatus(config);
}

function localEndpointOverlayStatus(config) {
  const filePath = config.__localConfigPath
    ? path.resolve(config.__localConfigPath)
    : path.join(stateRootPathForConfig(config), 'config', 'osdcloud-console.local.json');
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

function deploymentServicesRunning(services = {}) {
  return ['http', 'tftp', 'dhcp'].every((name) => services?.[name]?.running === true);
}

function fleetHasDeploymentRun(fleet = {}) {
  return Number(fleet?.total ?? 0) > 0 || (Array.isArray(fleet?.runs) && fleet.runs.length > 0);
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

function projectRootStatus(config) {
  const workspace = workspaceInfo(config);
  return {
    ready: Boolean(workspace.runtimeRoot) && workspace.runtimeInsideRepo !== true,
    detail: workspace.runtimeInsideRepo
      ? `Invalid: runtime root is inside the Git clone (${workspace.runtimeRoot}).`
      : workspace.runtimeRoot,
    workspace,
  };
}

function buildInitializationState({ config, secrets, runtime, endpoint, osImage, profilePayload, preflight, services, fleet, elevated }) {
  const web = webServerConfig(config);
  const webReady = Boolean(web.host) && Number.isInteger(web.port) && web.port >= 0;
  const rootStatus = projectRootStatus(config);
  const cachedWims = osImage?.images?.filter((img) => img.cached && String(img.fileName ?? '').toLowerCase().endsWith('.wim')) ?? [];
  const osImageCached = cachedWims.length > 0;
  const osImageCachedDetail = osImageCached
    ? `${cachedWims.length} deployable OS WIM image(s) cached.`
    : 'No cached deployable WIM images found. Download or import one.';
  const profileStatus = profilePayloadStatus(profilePayload);
  const finalPreflight = preflightStatus(preflight);
  const deploymentReady = finalPreflight.ready === true;
  const deploymentLive = deploymentServicesRunning(services);
  const hasDeploymentRun = fleetHasDeploymentRun(fleet);
  const runtimeNeedsElevation = elevated === false && runtime?.ready !== true;
  const runtimeDetail = runtime?.ready
    ? `${runtime.readyCount}/${runtime.requiredCount} required artifact group(s) are ready.`
    : runtimeNeedsElevation
      ? 'Restart the Web console from an elevated PowerShell session before Prepare runtime.'
      : runtime?.error ?? `${runtime?.missingCount ?? 'Unknown'} runtime artifact group(s) need preparation.`;
  const runtimeDetailItems = runtimeNeedsElevation
    ? [{
      title: 'Administrator',
      meta: 'host privilege',
      detail: 'Prepare runtime creates the SMB share, local account, and deployment runtime folders. Restart the Web console from an elevated PowerShell session first.',
      status: 'blocked',
    }, ...(runtimeInitializationDetailItems(runtime) ?? [])]
    : runtimeInitializationDetailItems(runtime);
  const steps = [
    {
      id: 'project-root',
      label: 'Project root',
      required: true,
      done: rootStatus.ready,
      action: 'project-root',
      detail: rootStatus.detail,
      objective: '確認部署 runtime 固定寫入 C:\\OSDCloud，Git clone 只作為安裝與設定來源。',
      doneWhen: 'Runtime working directory 不在 Git clone 裡，HostTools App/State 路徑都已解析。',
      safetyNote: '不要手動把 live runtime 檔案複製回 Git clone。',
      nextActionText: '確認固定路徑',
      phase: 'setup',
      detailItems: [
        {
          title: 'Runtime working directory',
          meta: 'deployment files are written here',
          detail: rootStatus.workspace.runtimeRoot,
          status: rootStatus.ready ? 'ready' : 'blocked',
        },
        {
          title: 'Host management bundle',
          meta: 'app files and scripts',
          detail: rootStatus.workspace.appRoot,
          status: 'ready',
        },
        {
          title: 'Local management state',
          meta: 'profiles, catalogs, uploads, local overlay',
          detail: rootStatus.workspace.stateRoot,
          status: 'ready',
        },
      ],
    },
    {
      id: 'web',
      label: 'Web service IP',
      required: true,
      done: webReady,
      action: 'setup',
      detail: webReady ? `${web.host}:${web.port}` : 'Set web.host and web.port in the local overlay.',
      objective: '確認這台 host 的 Web console 入口，後續所有部署操作都從這裡執行。',
      doneWhen: 'Web host 與 port 已存在，operator 可以開啟 console。',
      safetyNote: '需要控制 runtime 或服務時，Web console 必須從系統管理員 PowerShell 啟動。',
      nextActionText: '確認 Web 入口',
      phase: 'setup',
    },
    {
      id: 'secrets',
      label: 'Deployment secrets',
      required: true,
      done: secrets.ready,
      action: 'secrets',
      detail: secrets.ready ? 'windowsUsername, windowsPassword and pxeinstallPassword are present.' : `Missing: ${secrets.missing.join(', ')}`,
      objective: '設定部署完成後要建立的 Windows 本機管理員帳號，以及 WinPE 掛載 SMB 用的本機密碼。',
      doneWhen: 'windowsUsername、windowsPassword 與自動產生的 pxeinstallPassword 都存在於本機 ignored state。',
      safetyNote: '密碼只寫入本機 state，不會出現在 API 回應、log、文件或 Git commit。',
      nextActionText: secrets.ready ? '認證已就緒' : '輸入部署認證',
      phase: 'setup',
    },
    {
      id: 'runtime',
      label: 'Prepare runtime',
      required: true,
      done: runtime?.ready === true,
      action: 'prepare-runtime',
      detail: runtimeDetail,
      objective: '建立 PXE/WinPE 啟動所需的 runtime 結構、SMB account/share、iPXE 與 boot.wim。',
      doneWhen: 'Runtime Readiness 顯示所有 required artifact group 都 ready。',
      safetyNote: '這一步不會啟動 HTTP/TFTP/DHCP，也不會下載 client software。',
      nextActionText: runtime?.ready === true ? 'Runtime 已就緒' : '準備 runtime',
      phase: 'runtime',
      detailItems: runtimeDetailItems,
    },
    {
      id: 'endpoint',
      label: 'PXE/service endpoint',
      required: true,
      done: endpoint.ready,
      action: 'interfaces',
      detail: endpoint.detail,
      objective: '選擇本次服務 PXE client 的 NIC/IP，並把 endpoint 同步到 live boot.ipxe、boot.wim 與 SMB/firewall。',
      doneWhen: 'Local endpoint overlay 已寫入，endpoint summary 與本次測試網段一致。',
      safetyNote: '每次部署前確認服務 IP 與 endpoint 設定一致。',
      nextActionText: endpoint.ready ? 'Endpoint 已同步' : '選擇服務介面',
      phase: 'endpoint',
    },
    {
      id: 'os-image',
      label: 'OS Image Cache',
      required: true,
      done: osImageCached,
      action: 'os-images',
      detail: osImageCachedDetail,
      objective: '下載或匯入 Windows ISO/ESD/WIM，選 DISM index，匯出成 host 端可部署的單一 WIM。',
      doneWhen: 'OS Image Cache 至少有一個 cached deployable WIM，且後續 profile 可引用它。',
      safetyNote: 'WinPE 部署時使用 SMB 讀取已匯出的 WIM，不讓 client 重新從外網下載 Windows。',
      nextActionText: osImageCached ? 'OS 映像已快取' : '開啟 OS 映像',
      phase: 'content',
    },
    {
      id: 'profile',
      label: 'Publish profile',
      required: true,
      done: profileStatus.ready,
      action: 'profiles',
      detail: profileStatus.detail,
      objective: '選擇要部署的 profile，發佈 selected-os.json、selected-profile.json 與被選中的 client software/script payload。',
      doneWhen: 'Active profile payload 通過檢查，live Apps/Scripts 與 profile 內容一致。',
      safetyNote: 'Profile publish 只發佈被選中的 software；Minimal profile 不會下載 client installer。',
      nextActionText: profileStatus.ready ? 'Profile 已發佈' : '發佈 profile',
      phase: 'content',
    },
    {
      id: 'preflight',
      label: 'Run preflight',
      required: false,
      done: finalPreflight.ready,
      action: 'preflight',
      detail: finalPreflight.detail,
      objective: '在啟動服務前檢查 endpoint、runtime、OS WIM、profile payload、SMB 與 port 是否可部署。',
      doneWhen: 'Preflight Summary 顯示所有 checks passed。',
      safetyNote: '只要有 blocking failure，就不要啟動 DHCP 或讓 client PXE 開機。',
      nextActionText: finalPreflight.ready ? 'Preflight 已通過' : '執行 preflight',
      phase: 'validate',
    },
    {
      id: 'services',
      label: 'Start services',
      required: false,
      done: deploymentLive,
      action: 'all-services-toggle',
      detail: deploymentLive
        ? 'HTTP, TFTP and DHCP services are running.'
        : deploymentReady
          ? 'Preflight passed. Confirm DHCP safety, then start HTTP/TFTP/DHCP.'
          : 'Run and pass preflight before starting deployment services.',
      objective: '啟動 host 端 HTTP/status、TFTP 與 DHCP responder，讓實體 client 可以從 PXE 進入 WinPE。',
      doneWhen: 'HTTP、TFTP、DHCP 三個 service card 都顯示 running。',
      safetyNote: '只有確認測試 LAN 沒有其他 DHCP server 後，才啟動 DHCP 或 Start all services。',
      nextActionText: deploymentLive ? '服務已啟動' : '啟動服務',
      phase: 'go-live',
    },
    {
      id: 'client',
      label: 'Boot client',
      required: false,
      done: hasDeploymentRun,
      action: 'dashboard',
      detail: hasDeploymentRun
        ? `${fleet?.total ?? fleet?.runs?.length ?? 0} deployment run(s) are visible in Client Fleet.`
        : 'Boot the target computer from UEFI IPv4 PXE, then monitor Client Fleet and Validation Evidence.',
      objective: '讓目標電腦從 UEFI IPv4 PXE 開機，並用 Client Fleet / Validation Evidence 監看部署。',
      doneWhen: 'Client Fleet 出現本次 run，最後狀態到 windows-desktop-ready。',
      safetyNote: '實體部署驗證須以實際裝置為準。',
      nextActionText: hasDeploymentRun ? '查看部署證據' : '前往儀表板監看',
      phase: 'deploy',
    },
  ];
  const requiredSteps = steps.filter((step) => step.required);
  const nextStep = requiredSteps.find((step) => !step.done)
    ?? (!deploymentReady ? steps.find((step) => step.id === 'preflight') : null)
    ?? (!deploymentLive ? steps.find((step) => step.id === 'services') : null)
    ?? (!hasDeploymentRun ? steps.find((step) => step.id === 'client') : null);
  return {
    initialized: requiredSteps.every((step) => step.done),
    deploymentReady,
    deploymentLive,
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
    for (const entry of profile.installSequence ?? []) {
      if (entry.type !== 'script') {
        continue;
      }
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
    })),
    profiles: state.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      softwareIds: profile.softwareIds,
      execution: profile.execution,
      installSequence: (profile.installSequence ?? []).map((entry) => ({
        type: entry.type,
        id: entry.id,
        ...(entry.timeoutSeconds === undefined ? {} : { timeoutSeconds: entry.timeoutSeconds }),
      })),
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
        bootFile: this.config.dhcp.bootFile,
        ipxeBootUrl: this.config.dhcp.ipxeBootUrl,
      }),
      torrent: serviceSummary(this.services.torrent, {
        enabled: this.config.torrent?.enabled !== false,
        serverIp: torrentServerConfig(this.config).serverIp,
        trackerPort: this.config.torrent?.trackerPort ?? 6969,
        seederRunning: Boolean(this.services.torrentSeeder?.running),
        seeding: this.services.torrentSeeder?.seeding ?? null,
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
