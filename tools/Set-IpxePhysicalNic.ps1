[CmdletBinding()]
param(
    [string] $InterfaceAlias = '乙太網路 3',
    [string] $ServerIp = '192.168.100.100',
    [int] $PrefixLength = 24,
    [string] $DefaultGateway = '192.168.100.1',
    [int] $InterfaceMetric = 5,
    [string] $SmbFirewallRuleName = 'PXE-Lab SMB Inbound',
    [string] $RemoteSubnet = '192.168.100.0/24'
)

$ErrorActionPreference = 'Stop'

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
    New-NetIPAddress -InterfaceAlias $InterfaceAlias -IPAddress $ServerIp -PrefixLength $PrefixLength -DefaultGateway $DefaultGateway | Out-Null
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
