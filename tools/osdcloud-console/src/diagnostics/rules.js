function detailText(value) {
  return String(value ?? '').trim();
}

function check(id, category, phase, status, title, detail, evidence = [], remediation = '') {
  return {
    id,
    category,
    phase,
    status,
    title,
    detail,
    evidence: evidence.filter(Boolean),
    remediation,
  };
}

function remediationForRun(category) {
  if (category === 'winpe-run') {
    return 'Inspect the run event tail and deployment log, then verify OS image access, SMB mapping, and WinPE OSDCloud startup on the host.';
  }
  if (category === 'setupcomplete-run') {
    return 'Inspect SetupComplete and app finalization stages in the run log, then verify published Apps payload and post-logon finalization on the host.';
  }
  return 'Inspect the desktop-ready and final logon stages, then verify the desktop-ready callback and target-user environment evidence.';
}

export function buildDiagnosticsChecks(context) {
  const host = context.host;
  const moduleProbe = host.moduleProbe ?? {};
  const checks = [];
  const npmOk = host.npmVersion?.ok === true;
  const powershellOk = Boolean(moduleProbe.powershellVersion);
  checks.push(check(
    'bootstrap-prereq',
    'bootstrap-prereq',
    'host-init',
    host.nodeVersion && powershellOk ? 'pass' : 'fail',
    'Host prerequisites',
    `Node ${host.nodeVersion ?? 'missing'}; npm ${npmOk ? host.npmVersion.value : 'not required for the installed runtime'}; PowerShell ${moduleProbe.powershellVersion ?? 'unknown'}.`,
    [
      `AppRoot: ${host.workspace?.appRoot ?? '-'}`,
      `StateRoot: ${host.workspace?.stateRoot ?? '-'}`,
      `RuntimeRoot: ${host.workspace?.runtimeRoot ?? '-'}`,
    ],
    'Repair the installed Winception package if its bundled Node runtime or Windows PowerShell is unavailable.',
  ));

  const moduleAvailable = (name) => Array.isArray(moduleProbe.modules?.[name]) && moduleProbe.modules[name].length > 0;
  const moduleImportsOk = moduleProbe.imports?.OSD?.ok === true && moduleProbe.imports?.OSDCloud?.ok === true;
  checks.push(check(
    'powershell-module',
    'powershell-module',
    'host-init',
    moduleAvailable('OSD') && moduleAvailable('OSDCloud') && moduleImportsOk ? 'pass' : 'fail',
    'PowerShell deployment modules',
    moduleImportsOk
      ? `OSD and OSDCloud imported successfully.`
      : `OSD import: ${detailText(moduleProbe.imports?.OSD?.error) || 'ok'}; OSDCloud import: ${detailText(moduleProbe.imports?.OSDCloud?.error) || 'ok'}.`,
    [
      `OSD versions: ${(moduleProbe.modules?.OSD ?? []).map((row) => row.version).join(', ') || 'none'}`,
      `OSDCloud versions: ${(moduleProbe.modules?.OSDCloud ?? []).map((row) => row.version).join(', ') || 'none'}`,
    ],
    'Install or repair the host OSD and OSDCloud PowerShell modules, then rerun diagnostics.',
  ));

  const catalog = moduleProbe.catalog ?? {};
  checks.push(check(
    'os-catalog',
    'os-catalog',
    'host-init',
    catalog.ok === true ? 'pass' : 'fail',
    'OS download catalog probe',
    catalog.ok === true
      ? `Get-OSDCloudOperatingSystems returned ${catalog.count} row(s).`
      : detailText(catalog.error) || 'Get-OSDCloudOperatingSystems failed.',
    [],
    'Validate the local OSD module path and the Microsoft catalog probe on this host. If the probe fails here, Winception can only surface the upstream failure.',
  ));

  checks.push(check(
    'web-launch',
    'web-launch',
    'host-init',
    host.web?.host && Number.isFinite(host.web?.port) ? 'pass' : 'fail',
    'Web console launch target',
    host.web?.host
      ? `Web console configured at http://${host.web.host}:${host.web.port}.`
      : 'Web console host/port are not configured.',
    [],
    'Confirm the installed Web console host and port, then restart the console if needed.',
  ));

  const runtime = host.runtime;
  checks.push(check(
    'runtime-readiness',
    'runtime-readiness',
    'runtime',
    runtime?.ready === true ? 'pass' : 'fail',
    'Runtime readiness',
    runtime?.ready === true
      ? `${runtime.readyCount}/${runtime.requiredCount} required runtime artifact group(s) are ready.`
      : runtime?.error ?? `${runtime?.missingCount ?? 'Unknown'} runtime artifact group(s) still need preparation.`,
    (runtime?.missing ?? []).slice(0, 4).map((artifact) => `${artifact.id}: ${artifact.targets?.[0]?.reason ?? artifact.status ?? 'missing'}`),
    'Run Prepare runtime from an elevated Web console session and clear the remaining runtime blockers.',
  ));

  checks.push(check(
    'endpoint-sync',
    'endpoint-sync',
    'endpoint',
    host.endpoint?.ready === true ? 'pass' : 'fail',
    'Endpoint sync state',
    host.endpoint?.detail ?? 'Endpoint sync state is unavailable.',
    [],
    'Use Endpoint Settings to select the intended service interface and sync the endpoint before validating clients.',
  ));

  checks.push(check(
    'os-image-cache',
    'os-image-cache',
    'content',
    host.osImageStatus?.ready === true ? 'pass' : 'fail',
    'OS image cache',
    host.osImageStatus?.detail ?? 'OS image cache state is unavailable.',
    [],
    'Cache or republish a deployable OS WIM before attempting deployment.',
  ));

  checks.push(check(
    'profile-publish',
    'profile-publish',
    'content',
    host.profileStatus?.ready === true ? 'pass' : 'fail',
    'Deployment profile publish',
    host.profileStatus?.detail ?? 'Deployment profile payload state is unavailable.',
    [],
    'Publish the active deployment profile so selected-os.json and Apps payload match the intended deployment state.',
  ));

  const preflight = host.preflight ?? [];
  const preflightFailures = preflight.filter((item) => item.ok === false);
  const preflightWarnings = preflight.filter((item) => item.ok === true && item.warn === true);
  checks.push(check(
    'preflight',
    'preflight',
    'validate',
    !preflight.length ? 'skip' : preflightFailures.length ? 'fail' : preflightWarnings.length ? 'warn' : 'pass',
    'Preflight summary',
    !preflight.length
      ? 'Preflight has not been run in this Web session.'
      : preflightFailures.length
        ? `${preflightFailures.length} blocking preflight check(s) remain.`
        : preflightWarnings.length
          ? `${preflightWarnings.length} non-blocking preflight warning(s) remain.`
          : `${preflight.length} preflight check(s) passed.`,
    preflightFailures.slice(0, 6).map((item) => `${item.name}: ${item.detail}`),
    'Run preflight again after clearing the reported mismatches; do not start services while blocking failures remain.',
  ));

  const portFailures = preflightFailures.filter((item) => /^(UDP 67|UDP 69|TCP 80)$/u.test(String(item.name ?? '')));
  checks.push(check(
    'service-port',
    'service-port',
    'go-live',
    !preflight.length ? 'skip' : portFailures.length ? 'fail' : 'pass',
    'Service port availability',
    !preflight.length
      ? 'Preflight has not been run, so port ownership has not been confirmed.'
      : portFailures.length
        ? `${portFailures.length} service port check(s) are blocked.`
        : 'HTTP, TFTP, and DHCP port checks are not blocked in the latest preflight.',
    portFailures.map((item) => `${item.name}: ${item.detail}`),
    'Stop the process currently holding the conflicting service port, then rerun preflight.',
  ));

  if (context.run) {
    const run = context.run.run;
    const status = run.status === 'failed' ? 'fail' : run.status === 'stale' ? 'warn' : run.status === 'completed' ? 'pass' : 'skip';
    checks.push(check(
      context.run.category,
      context.run.category,
      'deploy',
      status,
      `Deployment run ${run.runId}`,
      `${run.status} at ${context.run.latestStage ?? 'unknown-stage'}: ${run.latestMessage ?? context.run.summary?.latestMessage ?? 'No latest message recorded.'}`,
      [
        `Client: ${run.clientId ?? '-'}`,
        `Started: ${run.startedAt ?? '-'}`,
        `Last received: ${run.lastReceivedAt ?? '-'}`,
      ],
      remediationForRun(context.run.category),
    ));
  }

  return checks;
}

export function summarizeDiagnostics(context, checks) {
  const firstFail = checks.find((item) => item.status === 'fail');
  const firstWarn = checks.find((item) => item.status === 'warn');
  const overallStatus = firstFail ? 'fail' : firstWarn ? 'warn' : 'pass';
  const focus = firstFail ?? firstWarn ?? checks.find((item) => item.status === 'skip') ?? checks[0];
  return {
    generatedAt: context.generatedAt,
    trigger: context.trigger,
    scope: context.scope,
    overallStatus,
    headline: focus?.title ?? 'Diagnostics completed.',
    probableCause: focus?.detail ?? 'No diagnostics detail available.',
    recommendedAction: focus?.remediation ?? 'Review the collected evidence bundle.',
  };
}
