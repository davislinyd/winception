import { ipv4ToUInt32 } from '../dhcp.js';
import { runPowerShell } from './powershell.js';
import { asArray } from './shared.js';

function range(cidr) {
  const [ip, rawPrefix] = String(cidr).split('/');
  const prefix = Number(rawPrefix);
  if (!rawPrefix || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) throw new Error('Invalid IPv4 subnet.');
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const start = (ipv4ToUInt32(ip) & mask) >>> 0;
  return { start, end: start + 2 ** (32 - prefix) - 1 };
}

export function subnetsOverlap(first, second) {
  const a = range(first);
  const b = range(second);
  return a.start <= b.end && b.start <= a.end;
}

export function assertNatSubnetAvailable(subnet, options, ownAlias = 'vEthernet (Winception-PXE)') {
  for (const item of options.routes ?? []) {
    if (item.interfaceAlias === ownAlias || item.destinationPrefix === '0.0.0.0/0') continue;
    if (subnetsOverlap(subnet, item.destinationPrefix)) {
      throw new Error(`部署子網 ${subnet} 與 ${item.interfaceAlias} 的 ${item.destinationPrefix} 重疊。請選擇其他子網。`);
    }
  }
}

/** Read-only physical NIC inventory, including disconnected/no-IPv4 adapters. */
export async function readNetworkOptions({ execute = runPowerShell } = {}) {
  const script = `
$adapters = @(Get-NetAdapter -Physical -ErrorAction Stop | ForEach-Object {
  $adapter = $_
  $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ ipAddress = $_.IPAddress; prefixLength = $_.PrefixLength }
  })
  $route = Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
  $dns = @((Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
  [pscustomobject]@{ interfaceAlias = $adapter.Name; interfaceIndex = $adapter.ifIndex; status = $adapter.Status.ToString(); interfaceDescription = $adapter.InterfaceDescription; ipv4 = $addresses; gateway = $route.NextHop; dnsServers = $dns }
})
$routes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.DestinationPrefix -ne '0.0.0.0/0' } | ForEach-Object {
  [pscustomobject]@{ interfaceAlias = $_.InterfaceAlias; destinationPrefix = $_.DestinationPrefix }
})
$serviceAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{ interfaceAlias = $_.InterfaceAlias; ipAddress = $_.IPAddress; prefixLength = $_.PrefixLength }
})
$natNetworks = @(if (Get-Command Get-NetNat -ErrorAction SilentlyContinue) {
  Get-NetNat -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ name = $_.Name; subnet = $_.InternalIPInterfaceAddressPrefix } }
})
$ics = Get-Service SharedAccess -ErrorAction SilentlyContinue
[pscustomobject]@{ adapters = $adapters; routes = $routes; serviceAddresses = $serviceAddresses; natNetworks = $natNetworks; icsRunning = ($ics -and $ics.Status -eq 'Running') } | ConvertTo-Json -Depth 6 -Compress
`;
  const result = await execute(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const parsed = JSON.parse(result.stdout);
  const options = { adapters: asArray(parsed.adapters), routes: asArray(parsed.routes), serviceAddresses: asArray(parsed.serviceAddresses), natNetworks: asArray(parsed.natNetworks), icsRunning: parsed.icsRunning === true };
  options.suggestedSubnet = ['192.168.100.0/24', '10.203.0.0/24', '172.30.100.0/24'].find((candidate) => {
    try { assertNatSubnetAvailable(candidate, options); return true; } catch { return false; }
  }) ?? '';
  return options;
}
