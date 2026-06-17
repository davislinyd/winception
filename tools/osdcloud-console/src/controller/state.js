import { webServerConfig, workspaceInfo } from '../config.js';
import { formatOsImageLabel } from '../osimages/catalog.js';
import { formatSoftwareList } from '../profiles/software.js';
import { deploymentServicesRunning, fleetHasDeploymentRun, osImageDeployableStatus, preflightStatus, profilePayloadStatus } from './helpers.js';

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}

export function runtimeInitializationDetailItems(runtime) {
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

export function runtimeReadinessFailureMessage(readiness) {
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

export function projectRootStatus(config) {
  const workspace = workspaceInfo(config);
  return {
    ready: Boolean(workspace.runtimeRoot) && workspace.runtimeInsideRepo !== true,
    detail: workspace.runtimeInsideRepo
      ? `Invalid: runtime root is inside the Git clone (${workspace.runtimeRoot}).`
      : workspace.runtimeRoot,
    workspace,
  };
}

export function buildInitializationState({ config, secrets, runtime, endpoint, osImage, profile, profilePayload, preflight, services, fleet, elevated }) {
  const web = webServerConfig(config);
  const webReady = Boolean(web.host) && Number.isInteger(web.port) && web.port >= 0;
  const rootStatus = projectRootStatus(config);
  const cachedWims = osImage?.images?.filter((img) => img.cached && String(img.fileName ?? '').toLowerCase().endsWith('.wim')) ?? [];
  const osImageCached = cachedWims.length > 0;
  const osImageCachedDetail = osImageCached
    ? `${cachedWims.length} deployable OS WIM image(s) cached.`
    : 'No cached deployable WIM images found. Download or import one.';
  const profileStatus = profilePayloadStatus(profilePayload);
  const osDeployableStatus = osImageDeployableStatus(osImage);
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
  const bootMode = config.dhcp?.bootMode ?? 'secureboot';
  const bootModeLabel = bootMode === 'secureboot'
    ? 'secureboot (signed Windows Boot Manager over TFTP)'
    : 'ipxe (unsigned iPXE + HTTP wimboot)';
  const clientBootDetail = bootMode === 'secureboot'
    ? 'Boot the target computer from UEFI IPv4 PXE — Secure Boot can stay ON. Monitor Client Fleet and Validation Evidence.'
    : 'Boot the target computer from UEFI IPv4 PXE with Secure Boot turned OFF (the iPXE chain is unsigned), then monitor Client Fleet and Validation Evidence.';
  const secretFields = [
    ['windowsUsername', 'deployment account name'],
    ['windowsPassword', 'deployment account password'],
    ['pxeinstallPassword', 'WinPE SMB password (auto-generated)'],
  ];
  const secretsDetailItems = secretFields.map(([field, meta]) => {
    const s = secrets.status?.[field];
    const present = s?.present === true;
    return {
      title: field,
      meta,
      detail: present
        ? `present (${s.source})${field === 'windowsUsername' && secrets.windowsUsername ? `: ${secrets.windowsUsername}` : ''}`
        : field === 'pxeinstallPassword' ? 'MISSING — save secrets to auto-generate' : 'MISSING',
      status: present ? 'ready' : 'blocked',
    };
  });
  const endpointDetailItems = !endpoint.ready ? undefined : [
    {
      title: 'Service interface',
      meta: 'NIC',
      detail: `${config.adapter?.interfaceAlias ?? 'unknown'} — ${config.adapter?.serverIp ?? ''}/${config.adapter?.prefixLength ?? ''}`.trim(),
      status: 'ready',
    },
    { title: 'Boot mode', meta: 'firmware chain', detail: bootModeLabel, status: 'ready' },
    ...(config.dhcp?.leaseStartIp ? [{ title: 'DHCP lease pool', meta: 'client IP range', detail: `${config.dhcp.leaseStartIp} – ${config.dhcp.leaseEndIp ?? ''}`, status: 'ready' }] : []),
    ...(config.smb?.share ? [{ title: 'SMB share', meta: 'OS image distribution', detail: config.smb.share, status: 'ready' }] : []),
  ];
  const osImageDetailItems = cachedWims.length > 0
    ? cachedWims.map((img) => ({
      title: img.fileName ?? img.id,
      meta: [img.edition, img.language].filter(Boolean).join(' · '),
      detail: [
        formatFileSize(img.bytes),
        img.sourceImageIndex != null ? `ESD idx ${img.sourceImageIndex}` : '',
        img.usedByProfiles?.length > 0 ? `used by: ${img.usedByProfiles.map((p) => p.name).join(', ')}` : '',
      ].filter(Boolean).join(' · '),
      status: 'ready',
    }))
    : [{ title: 'No cached WIM images', meta: 'os image', detail: 'Download or import a Windows image first.', status: 'blocked' }];
  const activeProfile = profile?.activeProfile;
  const profileDetailItems = !activeProfile ? undefined : [
    {
      title: activeProfile.name ?? activeProfile.id,
      meta: 'active profile',
      detail: activeProfile.description ?? '',
      status: profileStatus.ready && osDeployableStatus.ready ? 'ready' : 'blocked',
    },
    ...(profile.selectedSoftwareText ? [{
      title: 'Software',
      meta: 'install sequence',
      detail: profile.selectedSoftwareText,
      status: 'ready',
    }] : []),
    ...(osImage?.activeImage ? [{
      title: 'OS Image',
      meta: 'deployment target',
      detail: [
        osImage.activeImage.fileName ?? osImage.activeImage.id,
        osImage.activeImage.edition,
        osImage.activeImage.language,
      ].filter(Boolean).join(' · '),
      status: osDeployableStatus.ready ? 'ready' : 'blocked',
    }] : []),
  ];
  const servicesDetailItems = [
    {
      title: 'HTTP',
      meta: 'file server / status endpoint',
      detail: services?.http?.running ? `running on ${config.http?.host ?? ''}:${config.http?.port ?? 80}` : 'stopped',
      status: services?.http?.running ? 'ready' : 'blocked',
    },
    {
      title: 'TFTP',
      meta: 'PXE boot file server',
      detail: services?.tftp?.running ? `running on ${config.tftp?.listenIp ?? ''}:${config.tftp?.port ?? 69}` : 'stopped',
      status: services?.tftp?.running ? 'ready' : 'blocked',
    },
    {
      title: 'DHCP',
      meta: 'PXE boot announcer',
      detail: services?.dhcp?.running ? `running on ${config.dhcp?.listenIp ?? ''}:67` : 'stopped',
      status: services?.dhcp?.running ? 'ready' : 'blocked',
    },
  ];
  const preflightDetailItems = Array.isArray(preflight) && preflight.length > 0
    ? preflight.slice(0, 12).map((check) => ({
      title: check.name ?? 'Check',
      meta: check.ok === true && check.warn === true ? 'warning' : '',
      detail: check.detail ?? '',
      status: check.ok === true ? (check.warn ? 'warn' : 'ready') : check.ok === false ? 'blocked' : 'unknown',
    }))
    : undefined;
  const clientBootDetailItems = [
    {
      title: 'Dell Latitude 5420-5450 / Dell Pro 14',
      meta: 'BIOS setup (F2)',
      detail: bootMode === 'secureboot'
        ? 'Secure Boot: Enabled (Microsoft Windows mode). Integrated NIC: Enabled w/PXE (UEFI Network Stack). Boot mode: UEFI only, no Legacy/CSM. Then F12 one-time boot -> UEFI IPv4 (NIC). Secure Boot stays ON for the whole deployment.'
        : 'Secure Boot: Disabled (required by the unsigned iPXE chain). Integrated NIC: Enabled w/PXE (UEFI Network Stack). Boot mode: UEFI only, no Legacy/CSM. Then F12 one-time boot -> UEFI IPv4 (NIC).',
      status: 'ready',
    },
    {
      title: 'Hyper-V Generation 2 VM',
      meta: 'firmware settings',
      detail: bootMode === 'secureboot'
        ? "Set-VMFirmware -VMName <vm> -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows; Set-VMFirmware -VMName <vm> -FirstBootDevice (Get-VMNetworkAdapter -VMName <vm>)"
        : "Set-VMFirmware -VMName <vm> -EnableSecureBoot Off; Set-VMFirmware -VMName <vm> -FirstBootDevice (Get-VMNetworkAdapter -VMName <vm>)",
      status: 'ready',
    },
  ];
  const steps = [
    {
      id: 'project-root',
      label: 'Project root',
      required: true,
      done: rootStatus.ready,
      action: 'project-root',
      detail: rootStatus.detail,
      objective: 'Confirm the deployment runtime is fixed to C:\\OSDCloud and the Git clone is used only as the install and configuration source.',
      doneWhen: 'The runtime working directory is outside the Git clone, and the HostTools App/State paths are resolved.',
      safetyNote: 'Do not manually copy live runtime files back into the Git clone.',
      nextActionText: 'Confirm fixed paths',
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
      objective: 'Confirm the Web console entry point on this host and perform all later deployment actions from here.',
      doneWhen: 'The Web host and port are set, and the operator can open the console.',
      safetyNote: 'When controlling runtime or services, start the Web console from an elevated PowerShell session.',
      nextActionText: 'Confirm Web entry point',
      phase: 'setup',
    },
    {
      id: 'secrets',
      label: 'Deployment secrets',
      required: true,
      done: secrets.ready,
      action: 'secrets',
      detail: secrets.ready ? 'windowsUsername, windowsPassword and pxeinstallPassword are present.' : `Missing: ${secrets.missing.join(', ')}`,
      objective: 'Set the local Windows administrator account to create after deployment and the local password WinPE uses to mount SMB.',
      doneWhen: 'windowsUsername, windowsPassword, and the generated pxeinstallPassword all exist in ignored local state.',
      safetyNote: 'Passwords are written only to local state and never appear in API responses, logs, docs, or Git commits.',
      nextActionText: secrets.ready ? 'Secrets ready' : 'Enter deployment secrets',
      phase: 'setup',
      detailItems: secretsDetailItems,
    },
    {
      id: 'runtime',
      label: 'Prepare runtime',
      required: true,
      done: runtime?.ready === true,
      action: 'prepare-runtime',
      detail: runtimeDetail,
      objective: 'Create the runtime structure, SMB account/share, iPXE, and boot.wim required for PXE/WinPE boot.',
      doneWhen: 'Runtime Readiness shows every required artifact group as ready.',
      safetyNote: 'This step does not start HTTP/TFTP/DHCP and does not download client software.',
      nextActionText: runtime?.ready === true ? 'Runtime ready' : 'Prepare runtime',
      phase: 'runtime',
      detailItems: runtimeDetailItems,
    },
    {
      id: 'endpoint',
      label: 'PXE/service endpoint',
      required: true,
      done: endpoint.ready,
      action: 'interfaces',
      detail: `${endpoint.detail} | boot mode: ${bootModeLabel}`,
      objective: 'Choose the NIC/IP that serves this PXE client and sync the endpoint to live boot.ipxe, boot.wim, SMB, and firewall settings.',
      doneWhen: 'The local endpoint overlay is written, and the endpoint summary matches this test subnet.',
      safetyNote: 'Before every deployment, confirm the service IP matches the endpoint settings.',
      nextActionText: endpoint.ready ? 'Endpoint synced' : 'Choose service interface',
      phase: 'endpoint',
      detailItems: endpointDetailItems,
    },
    {
      id: 'os-image',
      label: 'OS Image Cache',
      required: true,
      done: osImageCached,
      action: 'os-images',
      detail: osImageCachedDetail,
      objective: 'Download or import a Windows ISO/ESD/WIM, choose the DISM index, and export a single deployable WIM for the host.',
      doneWhen: 'OS Image Cache contains at least one cached deployable WIM that later profiles can reference.',
      safetyNote: 'During WinPE deployment, read the exported WIM over SMB instead of making the client download Windows again from the internet.',
      nextActionText: osImageCached ? 'OS image cached' : 'Open OS image',
      phase: 'content',
      detailItems: osImageDetailItems,
    },
    {
      id: 'profile',
      label: 'Publish profile',
      required: true,
      done: profileStatus.ready && osDeployableStatus.ready,
      action: 'profiles',
      detail: !profileStatus.ready ? profileStatus.detail : !osDeployableStatus.ready ? `OS image: ${osDeployableStatus.detail}` : profileStatus.detail,
      objective: 'Choose the profile to deploy and publish selected-os.json, selected-profile.json, and the selected client software/script payload.',
      doneWhen: 'The active profile payload passes validation, and live Apps/Scripts match the profile contents.',
      safetyNote: 'Profile publish only publishes selected software; the Minimal profile does not download client installers.',
      nextActionText: profileStatus.ready ? 'Profile published' : 'Publish profile',
      phase: 'content',
      detailItems: profileDetailItems,
    },
    {
      id: 'preflight',
      label: 'Run preflight',
      required: false,
      done: finalPreflight.ready === true,
      ran: Array.isArray(preflight) && preflight.length > 0,
      action: 'preflight',
      detail: finalPreflight.detail,
      objective: 'Before starting services, verify that the endpoint, runtime, OS WIM, profile payload, SMB, and ports are deployable.',
      doneWhen: 'Preflight Summary shows all checks passed.',
      safetyNote: 'If any blocking failure exists, do not start DHCP or let the client PXE boot.',
      nextActionText: finalPreflight.ready ? 'Preflight passed' : 'Run preflight',
      phase: 'validate',
      detailItems: preflightDetailItems,
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
      objective: 'Start the host HTTP/status, TFTP, and DHCP responders so the physical client can PXE boot into WinPE.',
      doneWhen: 'All three service cards, HTTP, TFTP, and DHCP, show running.',
      safetyNote: 'Start DHCP or Start all services only after confirming the test LAN has no other DHCP server.',
      nextActionText: deploymentLive ? 'Services running' : 'Start services',
      phase: 'go-live',
      detailItems: servicesDetailItems,
    },
    {
      id: 'client',
      label: 'Boot client',
      required: false,
      done: hasDeploymentRun,
      action: 'dashboard',
      detail: hasDeploymentRun
        ? `${fleet?.total ?? fleet?.runs?.length ?? 0} deployment run(s) are visible in Client Fleet.`
        : clientBootDetail,
      objective: 'Boot the target machine by UEFI IPv4 PXE and monitor deployment through Client Fleet and Validation Evidence.',
      doneWhen: 'The current run appears in Client Fleet and ends at windows-desktop-ready.',
      safetyNote: 'Physical deployment validation must be based on the actual device.',
      nextActionText: hasDeploymentRun ? 'View deployment evidence' : 'Open dashboard monitoring',
      phase: 'deploy',
      detailItems: clientBootDetailItems,
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

export function profileSummary(state) {
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
      ...(profile.locale ? { locale: profile.locale } : {}),
      ...(profile.timeZone ? { timeZone: profile.timeZone } : {}),
    })),
  };
}

export function retailOnlyCatalogFilters(filters = {}) {
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

export function osImageSummary(state, profileUsage = new Map()) {
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

export function osImageUsageFromProfiles(profileState) {
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
