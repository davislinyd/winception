[CmdletBinding()]
param(
    [string] $InterfaceAlias = '',
    [string] $ServerIp = '',
    [int] $PrefixLength = 24,
    [string] $DefaultGateway = '',
    [int] $InterfaceMetric = 500,
    [string] $SmbFirewallRuleName = 'Winception PXE SMB Inbound',
    [string] $RemoteSubnet = ''
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

if ([string]::IsNullOrWhiteSpace($InterfaceAlias) -or [string]::IsNullOrWhiteSpace($ServerIp)) {
    throw 'PXE NIC endpoint is not configured. Provide -InterfaceAlias and -ServerIp from Guided Setup before changing NIC settings.'
}
if ($PrefixLength -lt 1 -or $PrefixLength -gt 32) {
    throw "PrefixLength is invalid: $PrefixLength"
}

if ([string]::IsNullOrWhiteSpace($RemoteSubnet)) {
    $ipBytes = [System.Net.IPAddress]::Parse($ServerIp).GetAddressBytes()
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($ipBytes) }
    $ipValue = [BitConverter]::ToUInt32($ipBytes, 0)
    $maskValue = [uint32] ([uint64] 0xffffffff -shl (32 - $PrefixLength))
    $networkValue = [uint32] ($ipValue -band $maskValue)
    $networkBytes = [BitConverter]::GetBytes($networkValue)
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($networkBytes) }
    $RemoteSubnet = "{0}/{1}" -f ([System.Net.IPAddress]::new($networkBytes)), $PrefixLength
}

$adapter = Get-NetAdapter -Name $InterfaceAlias -ErrorAction Stop
if ($adapter.Status -eq 'Disabled') {
    throw "Network adapter is disabled: $InterfaceAlias"
}

$existing = Get-NetIPAddress -IPAddress $ServerIp -AddressFamily IPv4 -ErrorAction SilentlyContinue
foreach ($address in $existing) {
    if ($address.InterfaceAlias -ne $InterfaceAlias) {
        Remove-NetIPAddress -InputObject $address -Confirm:$false
    }
}

Get-NetIPAddress -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne $ServerIp } |
    Remove-NetIPAddress -Confirm:$false

Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue

if (-not (Get-NetIPAddress -InterfaceAlias $InterfaceAlias -IPAddress $ServerIp -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
    New-NetIPAddress -InterfaceAlias $InterfaceAlias -IPAddress $ServerIp -PrefixLength $PrefixLength | Out-Null
}

if (-not [string]::IsNullOrWhiteSpace($DefaultGateway)) {
    New-NetRoute -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -NextHop $DefaultGateway -ErrorAction SilentlyContinue | Out-Null
}

Set-NetIPInterface -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -InterfaceMetric $InterfaceMetric
Set-NetConnectionProfile -InterfaceAlias $InterfaceAlias -NetworkCategory Private

$smbRule = Get-NetFirewallRule -DisplayName $SmbFirewallRuleName -ErrorAction SilentlyContinue
if ($smbRule) {
    $smbRule |
        Get-NetFirewallAddressFilter |
        Set-NetFirewallAddressFilter -LocalAddress $ServerIp -RemoteAddress $RemoteSubnet
}

[pscustomobject]@{
    InterfaceAlias = $InterfaceAlias
    ServerIp = $ServerIp
    PrefixLength = $PrefixLength
    DefaultGateway = $DefaultGateway
    InterfaceMetric = $InterfaceMetric
    SmbFirewallRemoteSubnet = $RemoteSubnet
}
