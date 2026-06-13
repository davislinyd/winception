import path from 'node:path';
import { ipv4ToUInt32 } from '../dhcp.js';
import { runPowerShell } from './powershell.js';
import { asArray, escapePowerShellString, fail, pass, toPowerShellArray, warn } from './shared.js';

export async function getAdapterState(config) {
  const alias = config.adapter.interfaceAlias.replaceAll("'", "''");
  const script = `
$adapter = Get-NetAdapter -Name '${alias}' -ErrorAction Stop
$ip = Get-NetIPAddress -InterfaceAlias '${alias}' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Select-Object -First 1 IPAddress,PrefixLength
$route = Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
  Select-Object -First 1 NextHop,RouteMetric
[pscustomobject]@{
  Name = $adapter.Name
  Status = $adapter.Status
  MacAddress = $adapter.MacAddress
  InterfaceIndex = $adapter.ifIndex
  IPv4 = $ip.IPAddress
  PrefixLength = $ip.PrefixLength
  Gateway = $route.NextHop
  RouteMetric = $route.RouteMetric
} | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return JSON.parse(result.stdout);
}

export function parseUncPath(value) {
  const text = String(value ?? '');
  if (!text.startsWith('\\\\')) {
    return null;
  }

  const parts = text.split(/[\\/]+/u).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return {
    server: parts[0],
    shareName: parts[1],
    relativePath: parts.slice(2).join(path.win32.sep),
  };
}

export function shareNameFromConfig(config = {}) {
  return parseUncPath(config.smb?.share)?.shareName
    ?? config.smb?.shareName
    ?? parseUncPath(config.smb?.imagePath)?.shareName
    ?? '';
}

export function isAllowAccess(value) {
  const text = String(value ?? '').toLowerCase();
  return text === 'allow' || text === '0';
}

export function hasReadRight(value) {
  const text = String(value ?? '').toLowerCase();
  return ['read', 'change', 'full', 'fullcontrol', '0', '1', '2'].includes(text);
}

export function accountMatches(accountName, expectedUser) {
  const account = String(accountName ?? '').toLowerCase();
  const user = String(expectedUser ?? '').toLowerCase();
  return account === user || account.endsWith(`\\${user}`);
}

export function smbAccessAllowsRead(accessEntries, expectedUser = 'pxeinstall') {
  return asArray(accessEntries).some((entry) => (
    accountMatches(entry.AccountName ?? entry.accountName, expectedUser)
    && isAllowAccess(entry.AccessControlType ?? entry.accessControlType)
    && hasReadRight(entry.AccessRight ?? entry.accessRight)
  ));
}

export function smbBackingImagePath(imagePath, shareInfo) {
  const unc = parseUncPath(imagePath);
  if (!unc) {
    return path.resolve(imagePath);
  }

  if (!shareInfo?.Path) {
    return null;
  }

  const root = path.win32.resolve(String(shareInfo.Path));
  const resolved = path.win32.resolve(root, unc.relativePath);
  const rootWithSeparator = root.endsWith(path.win32.sep) ? root : `${root}${path.win32.sep}`;
  if (resolved !== root && !resolved.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    return null;
  }

  return resolved;
}

export function normalizeIpv4ServiceInterfaces(records) {
  return asArray(records)
    .map((record) => ({
      interfaceAlias: record.InterfaceAlias ?? record.interfaceAlias,
      interfaceIndex: Number(record.InterfaceIndex ?? record.interfaceIndex),
      interfaceDescription: record.InterfaceDescription ?? record.interfaceDescription ?? '',
      status: record.Status ?? record.status ?? '',
      macAddress: record.MacAddress ?? record.macAddress ?? '',
      linkSpeed: record.LinkSpeed ?? record.linkSpeed ?? '',
      ipAddress: record.IPAddress ?? record.ipAddress,
      prefixLength: Number(record.PrefixLength ?? record.prefixLength),
      gateway: record.Gateway ?? record.gateway ?? '',
    }))
    .filter((record) => (
      record.status === 'Up'
      && record.interfaceAlias
      && record.ipAddress
      && !record.ipAddress.startsWith('169.254.')
      && record.ipAddress !== '0.0.0.0'
      && Number.isInteger(record.prefixLength)
    ))
    .sort((a, b) => (
      a.interfaceAlias.localeCompare(b.interfaceAlias, undefined, { numeric: true })
      || a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true })
    ));
}

export async function listIpv4ServiceInterfaces() {
  const script = `
$rows = foreach ($ip in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue) {
  if ([string]::IsNullOrWhiteSpace($ip.IPAddress) -or $ip.IPAddress.StartsWith('169.254.') -or $ip.IPAddress -eq '0.0.0.0') {
    continue
  }
  $adapter = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue
  if (-not $adapter -or $adapter.Status.ToString() -ne 'Up') {
    continue
  }
  $route = Get-NetRoute -InterfaceIndex $ip.InterfaceIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric |
    Select-Object -First 1
  [pscustomobject]@{
    InterfaceAlias = $adapter.Name
    InterfaceIndex = $adapter.ifIndex
    InterfaceDescription = $adapter.InterfaceDescription
    Status = $adapter.Status.ToString()
    MacAddress = $adapter.MacAddress
    LinkSpeed = $adapter.LinkSpeed
    IPAddress = $ip.IPAddress
    PrefixLength = $ip.PrefixLength
    Gateway = if ($route) { $route.NextHop } else { '' }
  }
}
@($rows) | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return normalizeIpv4ServiceInterfaces(JSON.parse(result.stdout || '[]'));
}

export function getServiceBindIps(config) {
  return [...new Set([
    config.http?.host,
    config.dhcp?.listenIp,
    config.tftp?.listenIp,
  ].filter((ip) => ip && ip !== '0.0.0.0'))];
}

export function prefixLengthToMask(prefixLength) {
  const prefix = Number(prefixLength);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 prefix length: ${prefixLength}`);
  }
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function isIpv4InPrefix(address, networkAddress, prefixLength) {
  const mask = prefixLengthToMask(prefixLength);
  return (ipv4ToUInt32(address) & mask) === (ipv4ToUInt32(networkAddress) & mask);
}

export function evaluateDhcpSubnet(config) {
  const serverIp = config.adapter?.serverIp;
  const prefixLength = config.adapter?.prefixLength;
  const values = [
    ['lease start', config.dhcp?.leaseStartIp],
    ['lease end', config.dhcp?.leaseEndIp],
    ['router', config.dhcp?.router],
  ].filter(([, value]) => value);

  try {
    const outside = values.filter(([, value]) => !isIpv4InPrefix(value, serverIp, prefixLength));
    if (outside.length > 0) {
      return fail(
        'DHCP subnet',
        `${outside.map(([name, value]) => `${name}=${value}`).join(', ')} outside ${serverIp}/${prefixLength}`,
      );
    }
    return pass(
      'DHCP subnet',
      `lease=${config.dhcp.leaseStartIp}-${config.dhcp.leaseEndIp} router=${config.dhcp.router} within ${serverIp}/${prefixLength}`,
    );
  } catch (error) {
    return fail('DHCP subnet', error.message);
  }
}

export function evaluateServiceIp(config, states, targetIp) {
  const expectedPrefix = config.adapter?.serverIp === targetIp && config.adapter?.prefixLength !== undefined
    ? Number(config.adapter.prefixLength)
    : undefined;
  const matches = states.filter((state) => state.TargetIp === targetIp);
  const expected = expectedPrefix === undefined ? targetIp : `${targetIp}/${expectedPrefix}`;

  // The address is not assigned to any IPv4 interface — a real misconfiguration.
  if (matches.length === 0) {
    return fail(`Service IP ${targetIp}`, `not assigned to any IPv4 interface; expected ${expected}`);
  }

  const prefixOk = (state) => expectedPrefix === undefined || Number(state.PrefixLength) === expectedPrefix;
  const prefixMatches = matches.filter(prefixOk);

  // The address exists but on the wrong prefix/interface — a real misconfiguration.
  if (prefixMatches.length === 0) {
    return fail(
      `Service IP ${targetIp}`,
      matches.map((state) => (
        `${state.InterfaceAlias} status=${state.Status} actual=${state.IPAddress}/${state.PrefixLength} state=${state.AddressState || 'unknown'} expected=${expected}`
      )).join('; '),
    );
  }

  // Fully ready: link up and the address is Preferred.
  const good = prefixMatches.find((state) => (
    state.Status === 'Up'
    && (!state.AddressState || state.AddressState === 'Preferred')
  ));
  if (good) {
    return pass(
      `Service IP ${targetIp}`,
      `${good.InterfaceAlias} ${good.IPAddress}/${good.PrefixLength}`,
    );
  }

  // Hard blockers even with the right prefix: a duplicate address means another
  // host already owns the IP, and a Disabled adapter means the IP is not usable.
  const duplicate = prefixMatches.find((state) => state.AddressState === 'Duplicate');
  if (duplicate) {
    return fail(
      `Service IP ${targetIp}`,
      `${duplicate.InterfaceAlias} reports a DUPLICATE address ${duplicate.IPAddress}/${duplicate.PrefixLength}; another host already owns ${expected}`,
    );
  }
  const disabled = prefixMatches.find((state) => state.Status === 'Disabled');
  if (disabled) {
    return fail(
      `Service IP ${targetIp}`,
      `${disabled.InterfaceAlias} is Disabled; enable the adapter so ${expected} becomes usable`,
    );
  }

  // Correct IP + prefix on the expected interface, but the link is not up yet
  // (Status=Disconnected) or the address is Deprecated/Tentative — e.g. the
  // client or switch is not connected. Services can still bind to this address
  // (the UDP/TCP port checks confirm bindability), so this is a non-blocking
  // warning: the operator may legitimately start services before the link is up.
  const degraded = prefixMatches[0];
  return warn(
    `Service IP ${targetIp}`,
    `${degraded.InterfaceAlias} link is not up (status=${degraded.Status} state=${degraded.AddressState || 'unknown'}); ${degraded.IPAddress}/${degraded.PrefixLength} is configured and bindable. Services can start but will not serve clients until the link is up.`,
  );
}

export async function getServiceIpStates(config) {
  const bindIps = getServiceBindIps(config);
  if (bindIps.length === 0) {
    return [];
  }
  const script = `
$targetIps = @(${toPowerShellArray(bindIps)})
$addresses = foreach ($targetIp in $targetIps) {
  Get-NetIPAddress -AddressFamily IPv4 -IPAddress $targetIp -ErrorAction SilentlyContinue | ForEach-Object {
    $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    [pscustomobject]@{
      TargetIp = $targetIp
      IPAddress = $_.IPAddress
      PrefixLength = $_.PrefixLength
      AddressState = $_.AddressState.ToString()
      InterfaceAlias = $_.InterfaceAlias
      InterfaceIndex = $_.InterfaceIndex
      Status = if ($adapter) { $adapter.Status.ToString() } else { $null }
      MacAddress = if ($adapter) { $adapter.MacAddress } else { $null }
      InterfaceDescription = if ($adapter) { $adapter.InterfaceDescription } else { $null }
    }
  }
}
@($addresses) | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return asArray(JSON.parse(result.stdout || '[]'));
}

export async function getSmbShareInfo(shareName) {
  const safeShareName = escapePowerShellString(shareName);
  const script = `
$share = Get-SmbShare -Name '${safeShareName}' -ErrorAction Stop
$access = @(Get-SmbShareAccess -Name '${safeShareName}' -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    AccountName = $_.AccountName
    AccessControlType = $_.AccessControlType.ToString()
    AccessRight = $_.AccessRight.ToString()
  }
})
[pscustomobject]@{
  Name = $share.Name
  Path = $share.Path
  Access = $access
} | ConvertTo-Json -Compress -Depth 4
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return JSON.parse(result.stdout);
}
