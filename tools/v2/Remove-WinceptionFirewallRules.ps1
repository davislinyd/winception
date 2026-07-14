[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rules = @(Get-NetFirewallRule -Group 'Winception' -ErrorAction SilentlyContinue)
if ($rules.Count -gt 0) {
  $rules | Remove-NetFirewallRule -ErrorAction Stop
}

[pscustomobject]@{ removed = $rules.Count }
