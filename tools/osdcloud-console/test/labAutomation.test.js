import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function parsePowerShell(relativePath) {
  const fullPath = path.join(root, relativePath);
  const command = [
    "$path = '" + fullPath.replaceAll("'", "''") + "'",
    '$tokens = $null',
    '$errors = $null',
    '[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.error, undefined, 'PowerShell parser could not start for ' + relativePath);
  assert.equal(result.status, 0, relativePath + ': ' + result.stdout + '\n' + result.stderr);
}

function runLabPowerShell(functionNames, command) {
  const scriptPath = path.join(root, 'tools', 'Invoke-WinceptionLabRegression.ps1').replaceAll("'", "''");
  const setup = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Set-StrictMode -Version Latest
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$tokens, [ref]$errors)
    $names = @(${functionNames.map((name) => "'" + name + "'").join(',')})
    foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) | Where-Object Name -in $names) {
      Invoke-Expression $definition.Extent.Text
    }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', setup + command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('Lab guest evidence persists host firmware and requires the published guest profile', () => {
  const output = runLabPowerShell(['Get-GuestEvidence', 'Invoke-LabGuestEvidenceCommand', 'Write-GuestEvidenceHeartbeat', 'Assert-GuestEvidence', 'Get-WindowsFamilyFromBuild', 'Get-OptionalProperty'], `
    function New-PSSession { [CmdletBinding()] param($VmName, $Credential) [pscustomobject]@{ vm = $VmName } }
    function Remove-PSSession { [CmdletBinding()] param($Session) }
    function Invoke-Command { [CmdletBinding()] param($Session, $ArgumentList, $ScriptBlock, [switch]$AsJob) $value = & $ScriptBlock @ArgumentList; if ($AsJob) { [pscustomobject]@{ State = 'Completed'; Value = $value } } else { $value } }
    function Wait-Job { [CmdletBinding()] param($Job, $Timeout) $true }
    function Receive-Job { [CmdletBinding()] param($Job) $Job.Value }
    function Stop-Job { [CmdletBinding()] param($Job) }
    function Remove-Job { [CmdletBinding()] param($Job, [switch]$Force) }
    function Test-Path { param($LiteralPath) $true }
    function Get-Content {
      param($LiteralPath, [switch]$Raw)
      switch -Wildcard ($LiteralPath) {
        '*DeploymentStatus.json' { '{"runId":"test-run","status":"completed"}' }
        '*deployment-progress.json' { '{"status":"succeeded","completedSteps":[]}' }
        '*selected-profile.json' { '{"profileId":"test-profile"}' }
        default { throw 'Unexpected guest path.' }
      }
    }
    function Get-ItemProperty { [CmdletBinding()] param($Path) [pscustomobject]@{ DisplayVersion='25H2'; CurrentBuild='26200'; ProductName='Windows 10 Pro' } }
    function Get-Process { [CmdletBinding()] param($Name) if ($Name -contains 'explorer') { [pscustomobject]@{ ProcessName='explorer' } } }
    function Confirm-SecureBootUEFI { $true }
    function Get-Tpm { [pscustomobject]@{ TpmPresent=$true; TpmReady=$true; TpmEnabled=$true; TpmActivated=$true } }
    function Get-VMFirmware { param($VMName) [pscustomobject]@{ SecureBoot='On'; SecureBootTemplate='MicrosoftWindows' } }
    function Get-VMSecurity { [CmdletBinding()] param($VMName) [pscustomobject]@{ TpmEnabled=$true } }
    $script:Config = @{ timeouts=@{ guestMinutes=1 } }
    $script:Secrets = @{ windowsUsername='test-user' }
    $credential = [pscredential]::new('test-user', [System.Security.SecureString]::new())
    $evidence = Get-GuestEvidence -VmName 'test-vm' -Credential $credential
    $json = $evidence | ConvertTo-Json -Depth 6
    $persisted = $json | ConvertFrom-Json
    Assert-GuestEvidence -Evidence $persisted -ExpectedProfileId 'test-profile' -ExpectedSecureBoot $true -ExpectedTpm $true
    foreach ($badProfile in @('', 'wrong-profile')) {
      $persisted.profileId = $badProfile
      $rejected = $false
      try { Assert-GuestEvidence -Evidence $persisted -ExpectedProfileId 'test-profile' -ExpectedSecureBoot $true -ExpectedTpm $true }
      catch { if ($_.Exception.Message -notlike '*profile*') { throw }; $rejected = $true }
      if (-not $rejected) { throw 'Missing or mismatched guest profile was accepted.' }
    }
    $persisted.profileId = 'test-profile'
    $persisted.currentBuild = '19045'
    $persisted.windowsFamily = 'Windows 10'
    $rejectedBuild = $false
    try { Assert-GuestEvidence -Evidence $persisted -ExpectedProfileId 'test-profile' -ExpectedSecureBoot $true -ExpectedTpm $true }
    catch { if ($_.Exception.Message -notlike '*Windows 11*') { throw }; $rejectedBuild = $true }
    if (-not $rejectedBuild) { throw 'Windows 10 build was accepted as Windows 11.' }
    $json
  `);
  const evidence = JSON.parse(output);
  assert.equal(evidence.profileId, 'test-profile');
  assert.equal(evidence.vmName, 'test-vm');
  assert.equal(evidence.productName, 'Windows 10 Pro');
  assert.equal(evidence.currentBuild, '26200');
  assert.equal(evidence.windowsFamily, 'Windows 11');
  assert.equal(evidence.hostSecureBoot, 'On');
  assert.equal(evidence.hostSecureBootTemplate, 'MicrosoftWindows');
  assert.equal(evidence.hostTpmEnabled, true);
});

test('Lab round persists host firmware as a separate object', () => {
  const output = runLabPowerShell(['Set-LabRoundClientScope', 'Invoke-LabRound', 'Get-OptionalProperty', 'ConvertTo-ObjectList'], `
    function Restore-LabCheckpoint { param($VmNames, $RoundFirmware) }
    function Sync-LabNetworkBootAfterMac { param($VmName) }
    function Get-VM { param($Name) if($Name){[pscustomobject]@{Name=$Name;State='Off';Id=[guid]'12345678-1234-1234-1234-123456789012'}} }
    function Get-VMNetworkAdapter { param($VMName) @{VMName='test-vm';MacAddress='AABBCCDDEEFF';SwitchName='Winception-AutoLab'} }
    function Set-VMNetworkAdapter { param($VMNetworkAdapter,$StaticMacAddress) }
    function Set-ConsoleMode { param($BootMode) }
    function Set-ConsoleEndpoint { }
    function Set-ConsoleDhcpServerMode { }
    function Invoke-ServerPreflight { @{ ok=$true } }
    function Invoke-ApiPreflight { @{ ok=$true } }
    function Clear-DeploymentStatus { }
    function Start-LabServices { }
    function Stop-LabServices { }
    function Start-LabVms { param($VmNames) }
    function Wait-FleetCompletion { param($VmNames, $TimeoutMinutes) @([pscustomobject]@{ runId='test-run' }) }
    function Get-GuestEvidence { param($VmName, $Credential) [pscustomobject]@{ runId='test-run'; vmName=$VmName; hostSecureBoot='On'; hostSecureBootTemplate='MicrosoftWindows'; hostTpmEnabled=$true } }
    function Assert-GuestEvidence { param($Evidence, $ExpectedProfileId, $ExpectedSecureBoot, $ExpectedTpm) }
    function Write-Evidence { param($Name, $Value) $script:written = $Value }
    $script:Config = @{ timeouts=@{ deploymentMinutes=1 } }
    $script:CleanupErrors = New-Object System.Collections.Generic.List[string]
    $credential = [pscredential]::new('test-user', [System.Security.SecureString]::new())
    Invoke-LabRound -RoundId 'test-round' -BootMode 'secureboot' -VmNames @('test-vm') -SecureBoot $true -Tpm $true -Credential $credential -ProfileId 'test-profile' | Out-Null
    ConvertTo-Json -InputObject $script:written -Depth 6 -Compress
  `);
  const round = JSON.parse(output.slice(output.indexOf('{')));
  const hostFirmware = [].concat(round.hostFirmware);
  const guest = [].concat(round.guest);
  assert.equal(round.roundId, 'test-round');
  assert.equal(hostFirmware.length, 1);
  assert.equal(hostFirmware[0].vmName, 'test-vm');
  assert.equal(hostFirmware[0].hostSecureBoot, 'On');
  assert.equal(hostFirmware[0].hostSecureBootTemplate, 'MicrosoftWindows');
  assert.equal(hostFirmware[0].hostTpmEnabled, true);
  assert.equal(guest[0].vmName, 'test-vm');
});

test('Router post-WinPE boot switch is owned, verifiable, and restartable', () => {
  const output = runLabPowerShell([
    'Set-LabDeployedDiskFirst',
    'Get-OptionalProperty',
    'ConvertTo-ObjectList',
    'Get-FirmwareBootOrderEntries',
    'Get-FirmwareBootType',
    'Get-FirmwareBootDeviceId',
    'Convert-FirmwareBootOrderEvidence',
  ], `
    $script:state = 'Running'; $script:order = @([pscustomobject]@{ BootType='Network'; Device=[pscustomobject]@{ Id='net'; Description='PXE' } }, [pscustomobject]@{ BootType='Drive'; Device=[pscustomobject]@{ Id='disk'; Description='OS' } }); $script:evidence = $null; $script:started = $false
    function Get-VM { param($Name) [pscustomobject]@{ Name=$Name; State=$script:state } }
    function Get-VMFirmware { param($VMName) [pscustomobject]@{ BootOrder=$script:order } }
    function Get-VMHardDiskDrive { param($VMName) [pscustomobject]@{ Id='disk'; Path='C:\\state\\router.vhdx' } }
    function Stop-VM { param($Name,[switch]$TurnOff,[switch]$Force,[switch]$Confirm) $script:state='Off' }
    function Set-VMFirmware { param($VMName,$FirstBootDevice) $script:order=@([pscustomobject]@{ BootType='Drive'; Device=[pscustomobject]@{ Id=$FirstBootDevice.Id; Description='OS' } }, [pscustomobject]@{ BootType='Network'; Device=[pscustomobject]@{ Id='net'; Description='PXE' } }) }
    function Start-VM { param($Name) $script:started=$true; $script:state='Running' }
    function Write-Evidence { param($Name,$Value) $script:evidence=$Value }
    Set-LabDeployedDiskFirst -VmName 'router' -Reason 'test'
    if (-not $script:started -or $script:state -ne 'Running' -or $script:evidence.hardDiskId -ne 'disk' -or $script:evidence.after[0].deviceId -ne 'disk') { throw 'Router disk switch did not verify and restart the owned VM.' }
    'ok'
  `);
  assert.equal(output.trim(), 'ok');
});

test('Lab acceptance monitor is read-only and exposes live process, console, VM, and evidence state', () => {
  const source = read('tools/Get-WinceptionLabAcceptanceStatus.ps1');
  assert.match(source, /Get-LabRunnerProcesses/);
  assert.match(source, /Get-LabMutexStatus/);
  assert.match(source, /Get-LabVmStatus/);
  assert.match(source, /Get-LabEvidenceStatus/);
  assert.match(source, /acceptance-router-bootstrap-\\d\{8\}/);
  assert.match(source, /Invoke-WinceptionLabRegression\\.ps1/);
  assert.match(source, /api\/state/);
  assert.match(source, /\$Follow/);
  assert.doesNotMatch(source, /\b(?:Start|Stop|Restart|Set)-(?:VM|Service|Lab)/);
});

test('Lab round fails when checkpoint cleanup fails', () => {
  runLabPowerShell(['Set-LabRoundClientScope', 'Invoke-LabRound'], `
    function Restore-LabCheckpoint { param($VmNames, $RoundFirmware) if ($null -eq $RoundFirmware) { throw 'Synthetic checkpoint cleanup failure.' } }
    function Sync-LabNetworkBootAfterMac { param($VmName) }
    function Get-VM { param($Name) if($Name){[pscustomobject]@{Name=$Name;State='Off';Id=[guid]'12345678-1234-1234-1234-123456789012'}} }
    function Get-VMNetworkAdapter { param($VMName) @{VMName='test-vm';MacAddress='AABBCCDDEEFF';SwitchName='Winception-AutoLab'} }
    function Set-VMNetworkAdapter { param($VMNetworkAdapter,$StaticMacAddress) }
    function Set-ConsoleMode { param($BootMode) }
    function Set-ConsoleEndpoint { }
    function Set-ConsoleDhcpServerMode { }
    function Invoke-ServerPreflight { @{ ok=$true } }
    function Invoke-ApiPreflight { @{ ok=$true } }
    function Clear-DeploymentStatus { }
    function Start-LabServices { }
    function Stop-LabServices { $script:stopped=$true }
    function Start-LabVms { param($VmNames) }
    function Wait-FleetCompletion { param($VmNames, $TimeoutMinutes) [pscustomobject]@{ runId='test-run' } }
    function Get-GuestEvidence { param($VmName, $Credential) [pscustomobject]@{ runId='test-run' } }
    function Assert-GuestEvidence { param($Evidence, $ExpectedProfileId, $ExpectedSecureBoot, $ExpectedTpm) }
    function Write-Evidence { param($Name, $Value) }
    $script:Config = @{ timeouts=@{ deploymentMinutes=1 } }
    $script:CleanupErrors = New-Object System.Collections.Generic.List[string]
    $script:stopped = $false
    $credential = [pscredential]::new('test-user', [System.Security.SecureString]::new())
    $rejected = $false
    try { Invoke-LabRound -RoundId 'test-round' -BootMode 'secureboot' -VmNames @('test-vm') -SecureBoot $true -Tpm $true -Credential $credential -ProfileId 'test-profile' | Out-Null }
    catch { if ($_.Exception.Message -ne 'Synthetic checkpoint cleanup failure.') { throw }; $rejected=$true }
    if (-not $rejected -or -not $script:stopped) { throw 'Round cleanup failure did not fail closed after service stop.' }
  `);
});

const firmwareHelpers = [
  'Get-OptionalProperty',
  'ConvertTo-ObjectList',
  'Get-FirmwareBootOrderEntries',
  'Get-FirmwareBootType',
  'Get-FirmwareBootDeviceId',
  'Get-FirmwareNetworkBootSource',
  'Test-FirmwareNetworkFirst',
  'Convert-FirmwareBootOrderEvidence',
  'Set-VmFirmwareMode',
];

test('Lab firmware keeps an already-first network boot device after checkpoint restore', () => {
  runLabPowerShell(firmwareHelpers, `
    function Set-VMFirmware { [CmdletBinding()] param($VmName, $EnableSecureBoot, $SecureBootTemplate, $VM, $FirstBootDevice) if ($FirstBootDevice) { throw 'Redundant boot-device update.' } }
    function Set-LabVmTpmEnabled { param($VmName, $Enabled) }
    function Get-VMFirmware { [CmdletBinding()] param($VmName) [pscustomobject]@{ BootOrder=@([pscustomobject]@{ BootType='Network' }) } }
    function Get-VM { [CmdletBinding()] param($Name) throw 'Network is already first.' }
    Set-VmFirmwareMode -VmName 'test-vm' -SecureBoot $true -Tpm $true
  `);
});

test('Lab firmware moves a matching firmware Network source first, not a raw adapter', () => {
  runLabPowerShell(firmwareHelpers, `
    $script:source=[pscustomobject]@{ BootType='Network'; Device=[pscustomobject]@{ Id='current-adapter' } }
    $script:moved=$false
    function Get-VMFirmware { [CmdletBinding()] param($VmName) if ($script:moved) { $order=@($script:source) } else { $order=@([pscustomobject]@{ BootType='File' },$script:source) }; [pscustomobject]@{ BootOrder=$order } }
    function Get-VMNetworkAdapter { [CmdletBinding()] param($VmName) [pscustomobject]@{ Id='current-adapter' } }
    function Set-LabVmTpmEnabled { param($VmName,$Enabled) }
    function Set-VMFirmware { [CmdletBinding()] param($VmName,$EnableSecureBoot,$SecureBootTemplate,$FirstBootDevice) if ($FirstBootDevice) { if (-not [object]::ReferenceEquals($FirstBootDevice,$script:source)) { throw 'Raw adapter or stale source used.' }; $script:moved=$true } }
    Set-VmFirmwareMode -VmName 'test-vm' -SecureBoot $true -Tpm $true
    if (-not $script:moved) { throw 'Network source was not moved.' }
    $script:moved=$false
    $script:source.Device.Id='stale-adapter'
    $rejected=$false
    try { Set-VmFirmwareMode -VmName 'test-vm' -SecureBoot $true -Tpm $true } catch { if ($_.Exception.Message -notlike '*match*') { throw }; $rejected=$true }
    if (-not $rejected -or $script:moved) { throw 'Mismatched source was accepted.' }
  `);
});

test('Lab firmware skips BootOrder entries that lack BootType', () => {
  const output = runLabPowerShell(firmwareHelpers, `
    $script:source=[pscustomobject]@{ BootType='Network'; Device=[pscustomobject]@{ Id='current-adapter' } }
    $script:moved=$false
    function Get-VMFirmware { [CmdletBinding()] param($VmName) if ($script:moved) { $order=@($script:source) } else { $order=@([pscustomobject]@{ Description='pending' }, $null, $script:source) }; [pscustomobject]@{ BootOrder=$order } }
    function Get-VMNetworkAdapter { [CmdletBinding()] param($VmName) [pscustomobject]@{ Id='current-adapter' } }
    function Set-LabVmTpmEnabled { param($VmName,$Enabled) }
    function Set-VMFirmware { [CmdletBinding()] param($VmName,$EnableSecureBoot,$SecureBootTemplate,$FirstBootDevice) if ($FirstBootDevice) { if (-not [object]::ReferenceEquals($FirstBootDevice,$script:source)) { throw 'Raw adapter or stale source used.' }; $script:moved=$true } }
    Set-VmFirmwareMode -VmName 'test-vm' -SecureBoot $true -Tpm $true
    if (-not $script:moved) { throw 'Network source behind malformed BootType entries was not moved.' }
    ConvertTo-Json -InputObject (Convert-FirmwareBootOrderEvidence -BootOrder @([pscustomobject]@{ Description='pending' }, $null, $script:source)) -Compress
  `);
  const evidence = [].concat(JSON.parse(output.slice(output.indexOf('['))));
  assert.equal(evidence[0].bootType, '');
  assert.equal(evidence[0].description, 'pending');
  assert.equal(evidence[1].bootType, '');
  assert.equal(evidence[2].bootType, 'Network');
  assert.equal(evidence[2].deviceId, 'current-adapter');
});

test('Lab restore stops all VMs first, waits for firmware, and continues after a restore failure', () => {
  runLabPowerShell([...firmwareHelpers, 'Restore-LabCheckpoint'], `
    $script:Config=@{ checkpointName='clean'; secureBootVms=@('vm1','vm2','vm3') }
    $script:states=@{ vm1='Running'; vm2='Running'; vm3='Running' }
    $script:reads=@{}; $script:restored=@(); $script:applied=@(); $script:sleeps=0
    function Get-VM { [CmdletBinding()] param($Name) [pscustomobject]@{ State=$script:states[$Name] } }
    function Stop-VM { [CmdletBinding(SupportsShouldProcess)] param($Name,[switch]$TurnOff,[switch]$Force) $script:states[$Name]='Off' }
    function Restore-VMSnapshot { [CmdletBinding(SupportsShouldProcess)] param($VmName,$Name) if (@($script:states.Values | Where-Object { $_ -ne 'Off' }).Count) { throw 'Restore started before all stops.' }; $script:restored+=$VmName; $script:reads[$VmName]=0; if ($VmName -eq 'vm2') { throw 'Synthetic restore failure.' } }
    function Get-VMFirmware { [CmdletBinding()] param($VmName) $script:reads[$VmName]++; $order=@([pscustomobject]@{ Description='transient' }); if ($script:reads[$VmName] -gt 1) { $order=@([pscustomobject]@{ Description='transient' }, [pscustomobject]@{ BootType='Network'; Device=[pscustomobject]@{ Id="net-$VmName" } }) }; [pscustomobject]@{ BootOrder=$order; SecureBoot='On' } }
    function Get-VMNetworkAdapter { [CmdletBinding()] param($VmName) [pscustomobject]@{ Id="net-$VmName" } }
    function Get-VMSecurity { [CmdletBinding()] param($VmName) [pscustomobject]@{ TpmEnabled=$true } }
    function Set-VmFirmwareMode { param($VmName,$SecureBoot,$Tpm) $script:applied+=$VmName }
    function Start-Sleep { param($Seconds) $script:sleeps++ }
    $rejected=$false
    try { Restore-LabCheckpoint -VmNames @('vm1','vm2','vm3') } catch { if ($_.Exception.Message -notlike '*vm2*restore failed*Synthetic restore failure*') { throw }; $rejected=$true }
    if (-not $rejected -or ($script:restored -join ',') -ne 'vm1,vm2,vm3' -or ($script:applied -join ',') -ne 'vm1,vm3' -or $script:sleeps -lt 4) { throw 'Restore did not settle/continue/fail closed.' }
  `);
});

test('Lab example config is isolated, complete, and secret-free', () => {
  const config = JSON.parse(read('config/lab-regression.example.json'));
  assert.equal(config.switchName, 'Winception-AutoLab');
  assert.equal(config.serviceInterfaceAlias, 'vEthernet (Winception-AutoLab)');
  assert.equal(config.serviceIp, '192.168.177.1');
  assert.equal(config.prefixLength, 24);
  assert.deepEqual(config.dhcp, {
    leaseStartIp: '192.168.177.200',
    leaseEndIp: '192.168.177.250',
    router: '192.168.177.1',
  });
  assert.deepEqual(config.secureBootVms, [
    'winception-autolab-01',
    'winception-autolab-02',
    'winception-autolab-03',
    'winception-autolab-04',
  ]);
  assert.equal(config.ipxeVm, 'winception-autolab-ipxe-01');
  assert.deepEqual(config.firmware.secureBootTpmOn, config.secureBootVms);
  assert.equal(config.firmware.secureBootTpmOff, 'winception-autolab-01');
  assert.equal(config.firmware.ipxeTpmOff, 'winception-autolab-ipxe-01');
  assert.equal(config.firmware.ipxeTpmOn, 'winception-autolab-ipxe-01');
  assert.equal(new Set([...config.secureBootVms, config.ipxeVm]).size, 5);
  for (const name of [...config.secureBootVms, config.ipxeVm]) {
    assert.equal(name.startsWith('winception-client-'), false, 'AutoLab VMs must not reuse historical vSwitch client names');
  }
  assert.equal(config.appRoot, 'C:\\OSDCloud\\HostTools\\App');
  assert.equal(config.stateRoot, 'C:\\OSDCloud\\HostTools\\State');
  assert.equal(config.checkpointName, 'Winception-Clean');
  assert.equal(config.cache.requiredPaths.length, 3);
  assert.equal(config.cache.requiredPaths.some((entry) => String(entry.path).includes('boot.wim')), false);
  assert.equal(config.cache.requiredPaths.some((entry) => String(entry.path).includes('boot.ipxe')), false);
  assert.doesNotMatch(JSON.stringify(config), /windowsPassword|pxeinstallPassword|OSDCLOUD_WINDOWS_PASSWORD/);
});

test('HostTools exporter has allowlist, tracked-file, path, hash, manifest, and secret guards', () => {
  const script = read('tools/Export-HostToolsBundle.ps1');
  assert.match(script, /Get-TrackedRelativePaths/);
  assert.match(script, /git ls-files --cached/);
  assert.match(script, /Join-ChildPath/);
  assert.match(script, /Get-Sha256Hash/);
  assert.match(script, /bundle-manifest\.json/);
  assert.match(script, /sha256/);
  assert.match(script, /hosttools-production-v1/);
  assert.match(script, /no-plaintext-secrets/);
  assert.match(script, /secret/);
  assert.match(script, /osdcloud-secrets/);
  assert.match(script, /iso\|wim\|esd/);
});

test('shared path guard rejects bundle traversal', () => {
  const commonPath = path.join(root, 'tools', 'lib', 'Common.ps1').replaceAll("'", "''");
  const command = "$common = '" + commonPath + "'; . $common; try { Join-ChildPath -Root 'C:\\winception' -RelativePath '..\\escape' -Label 'test'; exit 1 } catch { exit 0 }";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('HostTools exporter emits verifiable hashes and excludes untracked secrets', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-bundle-fixture-'));
  const output = path.join(os.tmpdir(), 'winception-bundle-output-' + path.basename(fixture));
  const write = (relativePath, value) => {
    const fullPath = path.join(fixture, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, value, 'utf8');
  };
  try {
    fs.mkdirSync(path.join(fixture, 'tools', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'config'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'osdcloud-assets'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'docs', 'manual-assets'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'Softwares'), { recursive: true });
    fs.copyFileSync(
      path.join(root, 'tools', 'lib', 'Common.ps1'),
      path.join(fixture, 'tools', 'lib', 'Common.ps1'),
    );
    fs.copyFileSync(
      path.join(root, 'tools', 'Export-HostToolsBundle.ps1'),
      path.join(fixture, 'tools', 'Export-HostToolsBundle.ps1'),
    );
    write('package.json', '{"version":"0.0.0"}\n');
    write('package-lock.json', '{}\n');
    write('Setup-DeploymentServer.cmd', '@echo off\n');
    write('Deploy-DeploymentServer.cmd', '@echo off\n');
    write('New-WinceptionUsbInstaller.cmd', '@echo off\n');
    write('docs/winception-operations-manual.html', '<html></html>\n');
    write('Softwares/Install-Apps.ps1', 'Write-Output test\n');
    write('Softwares/Show-DeploymentProgress.ps1', 'Write-Output test\n');
    for (const relativePath of [
      'tools/Install-HostManagementBundle.ps1',
      'tools/Setup-DeploymentServer.ps1',
      'tools/Reload-Console.ps1',
      'tools/Start-InstalledWebConsole.ps1',
      'tools/Start-WebConsoleTray.ps1',
      'tools/Restore-HostManagementState.ps1',
      'tools/Invoke-SoftwareTestVm.ps1',
      'osdcloud-assets/README.md',
      'config/osdcloud-console.json',
      'config/os-download-sources.json',
      'config/os-image-catalog.json',
      'config/runtime-artifacts.json',
      'config/software-catalog.json',
      'config/scripts-catalog.json',
      'config/deployment-profiles/.gitkeep',
      'tools/osdcloud-console/src/tracked.js',
      'tools/osdcloud-console/web/tracked.js',
      'osdcloud-assets/OSDCloud/Config/tracked.ps1',
      'osdcloud-assets/OSDCloud/WinPE/tracked.ps1',
    ]) {
      write(relativePath, 'tracked\n');
    }
    write('config/osdcloud-console.json', JSON.stringify({
      product: { channel: 'release', dataPolicy: 'zero-preload' },
      initialization: { status: 'unconfigured' },
      adapter: { serverIp: null },
      dhcp: { listenIp: null, leaseStartIp: null, leaseEndIp: null, router: null, ipxeBootUrl: null },
      tftp: { listenIp: null },
      http: { host: null },
      smb: { share: null, imagePath: null },
      osImage: { activeImage: null },
      deploymentProfiles: { activeProfile: null },
    }) + '\n');
    write('config/software-catalog.json', JSON.stringify({ software: [] }) + '\n');
    write('config/scripts-catalog.json', JSON.stringify({ scripts: [] }) + '\n');
    write('config/os-image-catalog.json', JSON.stringify({ images: [] }) + '\n');
    write('config/os-download-sources.json', JSON.stringify({ images: [] }) + '\n');
    write('config/osdcloud-secrets.example.json', '{}\n');
    write('docs/manual-assets/readme.txt', 'asset\n');
    assert.equal(spawnSync('git', ['-C', fixture, 'init', '-q']).status, 0);
    assert.equal(spawnSync('git', ['-C', fixture, 'add', '.']).status, 0);
    write('config/osdcloud-secrets.json', '{"windowsPassword":"do-not-copy"}\n');
    write('tools/untracked.ps1', 'Write-Output untracked\n');

    const exporter = path.join(fixture, 'tools', 'Export-HostToolsBundle.ps1');
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-File',
      exporter,
      '-SourceRoot',
      fixture,
      '-OutputRoot',
      output,
      '-Commit',
      'fixture-commit',
      '-Force',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'HostTools', 'bundle-manifest.json'), 'utf8'));
    const paths = manifest.files.map((entry) => entry.path);
    assert.ok(paths.includes('tools/osdcloud-console/src/tracked.js'));
    assert.ok(paths.includes('config/osdcloud-secrets.example.json'));
    assert.ok(!paths.includes('config/osdcloud-secrets.json'));
    assert.ok(!paths.includes('tools/untracked.ps1'));
    for (const record of manifest.files) {
      const fullPath = path.join(output, 'HostTools', record.path);
      const bytes = fs.readFileSync(fullPath);
      assert.equal(record.length, bytes.length);
      assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex').toUpperCase());
    }
    const verifier = path.join(root, 'tools', 'Verify-HostToolsBundle.ps1');
    const verification = spawnSync('powershell.exe', [
      '-NoProfile',
      '-File',
      verifier,
      '-BundleRoot',
      output,
      '-Channel',
      'Release',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(verification.status, 0, verification.stdout + verification.stderr);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Lab bootstrap is ValidateOnly-capable and fails closed on network and VM drift', () => {
  const script = read('tools/Initialize-WinceptionLab.ps1');
  assert.match(script, /ValidateOnly/);
  assert.match(script, /New-VMSwitch -Name \$Name -SwitchType Internal/);
  assert.doesNotMatch(script, /SwitchType Internal -AllowManagementOS/);
  assert.match(script, /SwitchType.*Internal/);
  assert.match(script, /default gateway/);
  assert.match(script, /Generation 2/);
  assert.match(script, /4GB/);
  assert.match(script, /Checkpoint-VM/);
  assert.match(script, /failed to create checkpoint/);
  assert.match(script, /EnableSecureBoot On/);
  assert.match(script, /EnableSecureBoot Off/);
  assert.match(script, /function Set-LabVmTpmEnabled/);
  assert.match(script, /Set-VMKeyProtector -VMName \$VmName -NewLocalKeyProtector/);
  assert.match(script, /Get-VMKeyProtector -VMName \$VmName/);
  assert.match(script, /protectorLength -lt 32/);
  assert.match(script, /Enable-VMTPM -VMName \$VmName/);
  assert.doesNotMatch(script, /\$security\.KpsAvailable/);
  assert.match(script, /Disable-VMTPM -VMName \$VmName/);
  assert.match(script, /Set-LabVmTpmEnabled -VmName \$VmName -Enabled \$Tpm/);
  assert.match(script, /SecureBoot \$true -Tpm \$true/);
  assert.match(script, /SecureBoot \$false -Tpm \$false/);
  const tpmFn = script.indexOf('function Set-LabVmTpmEnabled');
  const enableTpm = script.indexOf('Enable-VMTPM -VMName $VmName', tpmFn);
  const disableTpm = script.indexOf('Disable-VMTPM -VMName $VmName', tpmFn);
  assert.ok(tpmFn >= 0 && enableTpm > tpmFn && disableTpm > enableTpm, 'TPM disable must be the Enabled=false path');
});

test('Lab regression gates DHCP behind preflight and always cleans known resources', () => {
  const script = read('tools/Invoke-WinceptionLabRegression.ps1');
  assert.match(script, /try \{/);
  assert.match(script, /finally \{/);
  assert.match(script, /\/api\/preflight/);
  assert.match(script, /function Get-ConsoleTimeoutSec/);
  assert.match(script, /TimeoutSec \(Get-ConsoleTimeoutSec\)/);
  assert.match(script, /function Wait-ConsoleIdle/);
  const cleanupFn = script.slice(script.indexOf('function Invoke-LabCleanup'), script.indexOf('function Register-LabExitCleanup'));
  assert.match(cleanupFn, /\/api\/profile' -TimeoutSec \(Get-ConsoleTimeoutSec\)/);
  assert.match(cleanupFn, /\/api\/endpoint' -TimeoutSec \(Get-ConsoleTimeoutSec\)/);
  assert.match(cleanupFn, /Wait-ConsoleIdle/);
  assert.ok(
    cleanupFn.indexOf('Wait-ConsoleIdle') < cleanupFn.indexOf('Set-ConsoleMode') &&
      cleanupFn.indexOf('Wait-ConsoleIdle') < cleanupFn.indexOf('Clear-DeploymentStatus'),
    'cleanup must wait for an idle console before boot-mode and status cleanup',
  );
  assert.match(script, /\/api\/services\/start-all/);
  assert.match(script, /server:preflight failed; DHCP will not be started/);
  assert.match(script, /IsManagementOS/);
  assert.match(script, /function Get-SecretStorePath/);
  assert.match(script, /\$webHost = \[string\] \$script:Config\.web\.host/);
  assert.doesNotMatch(script, /\$host = \[string\] \$script:Config\.web\.host/);
  assert.doesNotMatch(script, /secret store path'\)[\s\S]*RuntimeRoot/s);
  assert.match(script, /Assert-ChildPath -Root \$script:StateRoot -Path \$full -Label 'secret store path'/);
  assert.match(script, /Unexpected VM is connected to isolated Lab switch/);
  assert.ok(
    script.indexOf('Invoke-ServerPreflight') < script.indexOf('Start-LabServices'),
    'server preflight must appear before the service start gate',
  );
  const afterStart = script.indexOf("Save-ConsoleStateEvidence -Name 'state-after-start.json'");
  const setEndpoint = script.indexOf('$state = Set-ConsoleEndpoint', afterStart);
  assert.ok(afterStart >= 0 && setEndpoint > afterStart, 'Lab must start the console then set the AutoLab endpoint');
  assert.equal(
    script.slice(afterStart, setEndpoint).includes('Assert-ConsoleEndpoint'),
    false,
    'Lab must not require the console to already be on AutoLab before Set-ConsoleEndpoint',
  );
  assert.match(script, /New-PSSession -VMName/);
  assert.match(script, /windows-desktop-ready/);
  assert.match(script, /function Test-ClientTerminalFailureText/);
  assert.match(script, /PXE-HttpRoot\\status\\latest.json/);
  assert.match(script, /selected-os\\.json did not produce/);
  assert.match(script, /SMB map to Z: failed/);
  assert.match(script, /System error 86/);
  assert.match(script, /-ConfigPath', \$stateConfigPath/);
  assert.match(script, /Get-RequiredProperty -Object \$Config -Name 'appRoot'/);
  assert.match(script, /Assert-PathOutside -Path \$script:AppRoot -Roots @\(\$script:RepoRoot\) -Label 'app root'/);
  assert.match(script, /-StateRoot', \$script:StateRoot/);
  assert.match(script, /Join-Path \$script:RepoRoot 'tools\\Initialize-DeploymentServer\.ps1'/);
  assert.match(script, /Join-Path \$script:RepoRoot 'tools\\Restore-DeploymentArtifacts\.ps1'/);
  assert.match(script, /if \(\$path -notin \$requiredFull\)/);
  assert.match(script, /Restore-VMSnapshot/);
  assert.match(script, /function Set-LabVmTpmEnabled/);
  assert.match(script, /Set-LabVmTpmEnabled -VmName \$VmName -Enabled \$Tpm/);
  assert.match(script, /Enable-VMTPM -VMName \$VmName/);
  assert.match(script, /Disable-VMTPM -VMName \$VmName/);
  assert.match(script, /Set-VMKeyProtector -VMName \$VmName -NewLocalKeyProtector/);
  assert.match(script, /Get-VMKeyProtector -VMName \$VmName/);
  assert.match(script, /protectorLength -lt 32/);
  assert.doesNotMatch(script, /\$security\.KpsAvailable/);
  assert.match(script, /Confirm-SecureBootUEFI/);
  assert.match(script, /Get-Tpm/);
  assert.match(script, /ExpectedSecureBoot \$SecureBoot/);
  assert.match(script, /ExpectedTpm \$Tpm/);
  assert.match(script, /FirmwareCorners/);
  assert.match(script, /secureboot-tpm-off/);
  assert.match(script, /ipxe-tpm-on/);
  assert.match(script, /function Get-LabFirmwareConfig/);
  const restoreAt = script.indexOf('function Restore-LabCheckpoint');
  const firmwareAfterRestore = script.indexOf('Set-VmFirmwareMode -VmName $vmName -SecureBoot $secureBoot -Tpm $tpm', restoreAt);
  assert.ok(restoreAt >= 0 && firmwareAfterRestore > restoreAt, 'checkpoint restore must re-apply firmware and TPM independently');
  const firmwareFn = script.indexOf('function Set-VmFirmwareMode');
  const tpmAfterFirmware = script.indexOf('Set-LabVmTpmEnabled -VmName $VmName -Enabled $Tpm', firmwareFn);
  assert.ok(firmwareFn >= 0 && tpmAfterFirmware > firmwareFn && tpmAfterFirmware < restoreAt, 'firmware apply must set TPM from -Tpm, not from Secure Boot');
  assert.match(script, /\[Parameter\(Mandatory\)\]\[bool\] \$Tpm/);
  assert.match(script, /PowerShell\.Exiting/);
  assert.match(script, /Stop-KnownLabProcesses/);
  assert.match(script, /Stop-Process -Id/);
  assert.match(script, /Global\\Winception-AutoLab/);
  assert.match(script, /cache.*allowNetworkRefresh/s);
  assert.doesNotMatch(script, /reason -eq 'manifest_missing'/);
  assert.match(script, /function Test-LabPortBindingConflicts/);
  assert.match(script, /0\.0\.0\.0/);
  assert.match(script, /::ffff:/);
  assert.match(script, /A Lab service port is already occupied/);
});

test('Lab cleanup uses the preflight timeout and waits for an idle console after endpoint restore', () => {
  const output = runLabPowerShell(
    ['Invoke-LabCleanup', 'Wait-ConsoleIdle', 'Get-ConsoleTimeoutSec', 'Get-OptionalProperty'],
    `
    $script:CleanupComplete = $false
    $ValidateOnly = $false
    $script:MutationStarted = $true
    $script:CleanupErrors = New-Object System.Collections.Generic.List[string]
    $script:WebBaseUri = 'http://127.0.0.1:8080'
    $script:Config = @{
      timeouts = @{ preflightMinutes = 15 }
      secureBootVms = @('winception-autolab-01')
      ipxeVm = 'winception-autolab-ipxe-01'
    }
    $script:AcceptanceProfileId = 'SE50433G'
    $script:AcceptanceOriginalProfile = 'IZVZO7PU'
    $script:AcceptanceSavedState = @{
      config = @{
        adapter = @{ interfaceAlias = 'vEthernet (Winception-AutoLab)'; serverIp = '192.168.177.1'; prefixLength = 24 }
        dhcp = @{ dhcpMode = 'server'; leaseStartIp = '192.168.177.200'; leaseEndIp = '192.168.177.250'; router = '192.168.177.1'; dnsServers = @('1.1.1.1','8.8.8.8') }
      }
    }
    $script:endpointTimeout = 0
    $script:profileTimeout = 0
    $script:polls = 0
    $script:mode = ''
    $script:cleared = $false
    function Stop-LabServices {}
    function Stop-LabRouter { param($Config) }
    function Restore-LabCheckpoint { param($VmNames) }
    function Restore-SecretEnvironment {}
    function Release-LabLock {}
    function Collect-SafeRuntimeEvidence {}
    function Test-WebConsoleHealthy { $true }
    function Get-ConsoleState {
      $script:polls++
      [pscustomobject]@{ operation = [pscustomobject]@{ running = ($script:polls -lt 2) } }
    }
    function Invoke-ConsoleJson {
      param($Method, $Path, $Body, [int] $TimeoutSec = 30)
      if ($Path -eq '/api/profile') { $script:profileTimeout = $TimeoutSec; return @{ ok = $true } }
      if ($Path -eq '/api/profiles/delete') { return @{ ok = $true } }
      if ($Path -eq '/api/endpoint') { $script:endpointTimeout = $TimeoutSec; throw 'Synthetic endpoint timeout' }
      throw "Unexpected $Path"
    }
    function Start-Sleep { param($Seconds) }
    function Set-ConsoleMode { param($BootMode) $script:mode = $BootMode }
    function Clear-DeploymentStatus { $script:cleared = $true }
    Invoke-LabCleanup
    @{
      profileTimeout = $script:profileTimeout
      endpointTimeout = $script:endpointTimeout
      polls = $script:polls
      mode = $script:mode
      cleared = $script:cleared
      errors = @($script:CleanupErrors)
    } | ConvertTo-Json -Compress
  `,
  );
  const result = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(result.profileTimeout, 900);
  assert.equal(result.endpointTimeout, 900);
  assert.ok(result.polls >= 2, 'cleanup must poll until the console operation is idle');
  assert.equal(result.mode, 'secureboot');
  assert.equal(result.cleared, true);
  assert.deepEqual(result.errors, ['Endpoint restoration failed.']);
});

test('Lab port occupancy ignores ICS on another adapter and treats wildcard binds as conflicts', () => {
  const commonPath = path.join(root, 'tools', 'lib', 'Common.ps1').replaceAll("'", "''");
  const scriptPath = path.join(root, 'tools', 'Invoke-WinceptionLabRegression.ps1').replaceAll("'", "''");
  const command = [
    "$common = '" + commonPath + "'",
    '. $common',
    "$script = '" + scriptPath + "'",
    '$tokens = $null',
    '$errors = $null',
    '$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }',
    '$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq \'Test-LabPortBindingConflicts\' }, $true)',
    'if (-not $fn) { Write-Output \'missing Test-LabPortBindingConflicts\'; exit 1 }',
    'Invoke-Expression $fn.Extent.Text',
    'if (-not (Test-LabPortBindingConflicts -LocalAddress \'192.168.177.1\' -ServiceIp \'192.168.177.1\')) { Write-Output \'service-ip should conflict\'; exit 1 }',
    'if (-not (Test-LabPortBindingConflicts -LocalAddress \'0.0.0.0\' -ServiceIp \'192.168.177.1\')) { Write-Output \'wildcard should conflict\'; exit 1 }',
    'if (-not (Test-LabPortBindingConflicts -LocalAddress \'::ffff:192.168.177.1\' -ServiceIp \'192.168.177.1\')) { Write-Output \'mapped ipv6 should conflict\'; exit 1 }',
    'if (Test-LabPortBindingConflicts -LocalAddress \'172.25.144.1\' -ServiceIp \'192.168.177.1\') { Write-Output \'ICS address must not conflict\'; exit 1 }',
    'exit 0',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('Workflows use the dedicated runner and keep PRs non-mutating', () => {
  const pr = read('.github/workflows/pr.yml');
  const lab = read('.github/workflows/lab-deploy.yml');
  assert.match(pr, /pull_request:/);
  assert.match(pr, /runs-on: \[self-hosted, windows, winception-lab\]/);
  assert.match(pr, /node-version: 24\.x/);
  assert.match(pr, /npm ci/);
  assert.match(pr, /npm run acceptance:source/);
  assert.match(pr, /npm run acceptance:ui/);
  assert.doesNotMatch(pr, /services\/start-all|server:preflight|dhcp-mode|Initialize-DeploymentServer/);

  assert.match(lab, /branches:\s+- master/);
  assert.match(lab, /runs-on: \[self-hosted, windows, hyperv, winception-lab\]/);
  assert.match(lab, /concurrency:\s+group: winception-lab/s);
  assert.match(lab, /cancel-in-progress: false/);
  assert.match(lab, /timeout-minutes: 240/);
  assert.match(lab, /-Mode All -NetworkAcceptance/);
  assert.match(lab, /contents: read/);
  assert.match(lab, /Export-HostToolsBundle\.ps1/);
  assert.match(lab, /Seed-DevelopmentFixture\.ps1/);
  assert.match(lab, /-ActiveProfileId IZVZO7PU/);
  assert.match(lab, /Invoke-WinceptionLabRegression\.ps1/);
  assert.match(lab, /GITHUB_WORKSPACE.*Invoke-WinceptionLabRegression/s);
  assert.match(lab, /actions\/upload-artifact@v4/);
  assert.match(lab, /if: always\(\)/);

  const release = read('.github/workflows/release-candidate.yml');
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /-Channel Release/);
  assert.match(release, /Verify-HostToolsBundle\.ps1/);
  assert.match(release, /Expand-Archive/);
  assert.match(release, /unsigned-rc/);
  assert.doesNotMatch(release, /git push|git tag|gh release create/);
});

test('new PowerShell automation modules parse without executing live operations', () => {
  for (const relativePath of [
    'tools/Export-HostToolsBundle.ps1',
    'tools/Verify-HostToolsBundle.ps1',
    'tools/Seed-DevelopmentFixture.ps1',
    'tools/Initialize-WinceptionLab.ps1',
    'tools/Invoke-WinceptionLabRegression.ps1',
  ]) {
    parsePowerShell(relativePath);
  }
});
