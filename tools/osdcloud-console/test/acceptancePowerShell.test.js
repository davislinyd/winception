import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootPairingCode } from '../src/bootApprovals.js';

function runPowerShell(relative, names, command) {
  const full=path.resolve(relative).replaceAll("'","''");
  const setup=`$ErrorActionPreference='Stop'; $t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('${full}',[ref]$t,[ref]$e); if($e.Count){throw ($e.Message -join ';')}; foreach($f in $a.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)|Where-Object Name -in @(${names.map(n=>`'${n}'`).join(',')})){Invoke-Expression $f.Extent.Text};`;
  const env={...process.env};if(env.PSModulePath)env.PSModulePath=env.PSModulePath.split(';').filter(s=>!/codex-runtimes/i.test(s)).join(';');
  const result=spawnSync('powershell.exe',['-NoProfile','-Command',setup+command],{encoding:'utf8',windowsHide:true,timeout:15000,env});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
  return result.stdout.trim();
}
test('new acceptance scripts parse in Windows PowerShell without invoking host operations',()=>{
  for(const relative of ['tools/Invoke-WinceptionAcceptance.ps1','tools/Initialize-WinceptionLabRouter.ps1','tools/Get-WinceptionLabAcceptanceStatus.ps1','tools/lib/Acceptance.ps1','tools/lib/LabRouter.ps1','tools/lib/LabNetworkAcceptance.ps1','tools/acceptance/client.ps1'])runPowerShell(relative,[],"'Parsed'");
});
test('WinPE OOBE customization copies Apps before auto-logon lookup and ignores missing Winlogon values',()=>{
  const source=fs.readFileSync('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Config/Scripts/Shutdown/Invoke-OobeCustomization.ps1','utf8');
  const copyApps=source.indexOf('Copy-OobeDirectoryContentsDurably -Source $sourceApps');
  const countCall=source.indexOf('$testAutoLogonCount = Get-TestAutoLogonCount');
  assert.ok(copyApps>=0 && countCall>copyApps, 'selected-profile.json must be copied before auto-logon lookup');
  const profilePick=source.indexOf("Test-OobeProfileManifest -Path (Join-Path $_ 'selected-profile.json')");
  const installerPick=source.lastIndexOf("Test-OobeUsableFile -Path (Join-Path $_ 'Install-Apps.ps1')");
  assert.ok(profilePick>=0 && installerPick>profilePick, 'published selected-profile.json must win over WinPE template Apps');
  assert.match(source,/function Write-OobeTextFileDurably/);
  assert.match(source,/function Copy-OobeFileDurably/);
  assert.match(source,/FileOptions\]::WriteThrough/);
  const deleteAt=source.indexOf("reg.exe delete 'HKLM\\OSD_OFF_SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'");
  const continueAt=source.lastIndexOf("$ErrorActionPreference = 'Continue'", deleteAt);
  assert.ok(deleteAt>0 && continueAt>=0 && continueAt<deleteAt, 'missing Winlogon values must not terminate under Stop');
  const media=fs.readFileSync('osdcloud-assets/OSDCloud/Config/Scripts/Shutdown/Invoke-OobeCustomization.ps1','utf8');
  assert.equal(media, source);
});
test('WinPE verifies durable customization artifacts before reboot',()=>{
  const source=fs.readFileSync('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1','utf8');
  assert.match(source,/function Write-DeploymentTextFileDurably/);
  assert.match(source,/function Get-DeploymentCustomizationCheck/);
  assert.match(source,/function Wait-DeploymentCustomization/);
  assert.match(source,/post-apply-customization-error/);
  assert.match(source,/Save-DeploymentStatusMetadata\s+Invoke-OSDCloud\s+Wait-DeploymentCustomization/);
  assert.match(source,/Write-DeploymentTextFileDurably -Path \$metadataPath/);
});
test('WinPE auto-logon accepts only an integer limited test-only profile',()=>{
  const output=runPowerShell('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Config/Scripts/Shutdown/Invoke-OobeCustomization.ps1',['Get-TestAutoLogonCount'],`
    function Test-Path {param($LiteralPath) $true}
    function Get-Content {param($LiteralPath,[switch]$Raw) $script:profile}
    $counts=@();foreach($script:profile in @('{}','{"acceptance":{"testOnly":false,"autoLogonCount":1}}','{"acceptance":{"testOnly":true,"autoLogonCount":5}}','{"acceptance":{"testOnly":true,"autoLogonCount":1.5}}','{"acceptance":{"testOnly":"true","autoLogonCount":1}}','{"acceptance":{"testOnly":true,"autoLogonCount":3}}')){$counts+=Get-TestAutoLogonCount 'C:\\'};$counts|ConvertTo-Json -Compress
  `);
  assert.deepEqual(JSON.parse(output),[0,0,0,0,0,3]);
});
test('actual WinPE pairing calculation matches server vectors',()=>{
  const source=fs.readFileSync('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1','utf8');
  const calculation=source.match(/\$pairingInput = [\s\S]*?\$pairingCode = [^\r\n]+/)[0];
  const vectors=[{n:'AQIDBA',e:'AQAB',nonce:'nonce',bootId:'boot'},{n:'AAEC_w',e:'Aw',nonce:'second-nonce',bootId:'fresh-boot'}];
  for(const v of vectors){
    const decode=s=>Buffer.from(s,'base64url').toString('base64');
    const command=`$publicParameters=@{Modulus=[Convert]::FromBase64String('${decode(v.n)}');Exponent=[Convert]::FromBase64String('${decode(v.e)}')};$clientNonce='${v.nonce}';$bootId='${v.bootId}';${calculation};$pairingCode`;
    assert.equal(runPowerShell('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1',['ConvertTo-Base64Url'],command),bootPairingCode(v,v.nonce,v.bootId));
  }
});
test('DHCP discovery rejects unrelated, malformed and non-offer packets',()=>{
  const output=runPowerShell('tools/lib/Acceptance.ps1',['Get-DhcpOfferServer'],`
    $p=New-Object byte[] 278;$p[0]=69;$p[9]=17;$p[20]=0;$p[21]=67;$p[22]=0;$p[23]=68;$p[28]=2;
    ([byte[]](1,2,3,4)).CopyTo($p,32);([byte[]](99,130,83,99,53,1,2,54,4,192,168,177,254,255)).CopyTo($p,264);
    $transaction=[byte[]](1,2,3,4);$valid=Get-DhcpOfferServer $p $transaction;
    $wrong=[string](Get-DhcpOfferServer $p ([byte[]](9,9,9,9)));$p[270]=5;$ack=[string](Get-DhcpOfferServer $p $transaction);
    $p[270]=2;$p[264]=0;$badCookie=[string](Get-DhcpOfferServer $p $transaction);
    @{valid=$valid;wrong=$wrong;ack=$ack;badCookie=$badCookie}|ConvertTo-Json -Compress
  `);
  const result=JSON.parse(output);assert.equal(result.valid,'192.168.177.254');
  for(const field of ['wrong','ack','badCookie'])assert.ok(result[field] === null || result[field] === '', `${field} emitted a DHCP server value`);
});
test('physical configuration refuses unsafe pool subnet and WAN settings',()=>{
  const output=runPowerShell('tools/lib/Acceptance.ps1',['Assert-AcceptanceConfig','Get-AcceptanceMac','Get-AcceptanceIpv4Value'],`
    $env:COMPUTERNAME='TEST-HOST'
    function Get-NetAdapter {param($Name) [pscustomobject]@{HardwareInterface=$true;Status='Up'}}
    $base=@{schemaVersion=1;webBase='http://127.0.0.1:8080';stateRoot='C:\\OSDCloud\\HostTools\\State';host=@{computerName='TEST-HOST';serviceInterface='Ethernet';serviceIp='192.168.177.1';wanInterface='Wi-Fi';clientInterface='Ethernet'};
      client=@{mac='AA-BB-CC-DD-EE-FF';machineId='11111111-2222-3333-4444-555555555555';name='label';disposableConfirmed=$true};expected=@{subnet='192.168.177.0/24';prefixLength=24;gateway='192.168.177.254';dhcpServer='192.168.177.1';dnsServers=@('1.1.1.1')};
      leaseStartIp='192.168.177.200';leaseEndIp='192.168.177.250';dhcpClearConfirmed=$true;testWindowExpiresAt='2050-01-01T00:00:00Z';probeHost='www.microsoft.com';collectorPort=18081}
    foreach($scene in @('ExistingDhcp','WinceptionDhcp','LaptopNat')){Assert-AcceptanceConfig ($base|ConvertTo-Json -Depth 6|ConvertFrom-Json) $scene}
    $rejected=0
    foreach($case in @('pool','subnet','prefix','wan','window')){
      $cfg=$base|ConvertTo-Json -Depth 6|ConvertFrom-Json
      switch($case){pool{$cfg.leaseStartIp='192.168.177.1'} subnet{$cfg.expected.subnet='192.168.177.5/24'} prefix{$cfg.expected.prefixLength=16} wan{$cfg.host.wanInterface='Ethernet'} window{$cfg.testWindowExpiresAt='2000-01-01T00:00:00Z'}}
      try{Assert-AcceptanceConfig $cfg LaptopNat}catch{$rejected++}
    };$rejected
  `);
  assert.equal(Number(output),5);
});
test('router guest NAT setup enables guarded nested Hyper-V before creating WinNAT',()=>{
  const source=fs.readFileSync('tools/lib/LabRouter.ps1','utf8');
  assert.match(source,/function Invoke-LabRouterGuestCommand/);
  assert.match(source,/Invoke-Command -Session \$Session[\s\S]*-AsJob/);
  assert.match(source,/Wait-Job -Job \$job -Timeout \$TimeoutSec/);
  assert.match(source,/router-guest-command-timeout\.json/);
  const fn=source.slice(source.indexOf('function Initialize-LabRouterGuest'),source.indexOf('function Enable-LabRouterTpm'));
  assert.match(fn,/Router LAN\/WAN MAC was not assigned before guest NAT setup/);
  assert.match(fn,/Set-VMProcessor -VMName \$name -Count 2 -ExposeVirtualizationExtensions \$true/);
  assert.match(fn,/router-processor-before\.json/);
  assert.match(fn,/Set-VMFirmware -VMName \$name -FirstBootDevice \$hardDisk -ErrorAction Stop/);
  assert.match(fn,/Router guest setup must boot the deployed hard disk, not PXE/);
  assert.match(fn,/Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart/);
  assert.match(fn,/shutdown\.exe \/r \/t 0 \/f/);
  assert.match(fn,/if \(\$restartState -eq 'Off'\)/);
  assert.match(fn,/Start-VM -Name \$name -ErrorAction Stop/);
  assert.match(fn,/router-hyperv-restart\.json/);
  assert.match(fn,/Router MSFT_NetNat is unavailable after Hyper-V enablement/);
  assert.match(fn,/router-hyperv-prerequisite\.json/);
  assert.match(fn,/Start-Service -ErrorAction SilentlyContinue/);
  assert.match(fn,/Invalid class/);
  assert.match(fn,/Get-NetNat -ErrorAction Stop/);
  assert.match(fn,/Router New-NetNat failed/);
  assert.match(fn,/Get-CimClass -Namespace root\/StandardCimv2 -ClassName MSFT_NetNat/);
  assert.match(fn,/Get-WindowsOptionalFeature -Online/);
  assert.match(fn,/router-nat-diagnostics\.json/);
  assert.match(fn,/router-guest-boot\.json/);
  assert.match(fn,/router-guest-session-failure\.json/);
  assert.match(fn,/after-deployed-disk-boot/);
  assert.match(fn,/after-hyperv-restart/);
  assert.match(fn,/Get-WinEvent -FilterHashtable/);
  const ownership=source.slice(source.indexOf('function Assert-LabRouterOwnership'),source.indexOf('function New-LabRouterPSSession'));
  assert.match(ownership,/Router ready processor prerequisites are missing/);
  const cleanup=source.slice(source.indexOf('function Stop-LabRouter'));
  assert.match(cleanup,/router-processor-before\.json/);
  assert.match(cleanup,/ExposeVirtualizationExtensions \(\[bool\]\$processorBefore\.exposeVirtualizationExtensions\)/);
  assert.match(cleanup,/Remove-VMNetworkAdapter -VMName winception-autolab-router -Name WAN/);
});

test('guest evidence commands are bounded and expose a live heartbeat',()=>{
  const source=fs.readFileSync('tools/Invoke-WinceptionLabRegression.ps1','utf8');
  assert.match(source,/function Write-GuestEvidenceHeartbeat/);
  assert.match(source,/function Invoke-LabGuestEvidenceCommand/);
  assert.match(source,/Invoke-Command -Session \$Session[\s\S]*-AsJob/);
  assert.match(source,/Wait-Job -Job \$job -Timeout \$TimeoutSec/);
  assert.match(source,/guest-evidence-heartbeat\.json/);
  assert.match(source,/Guest evidence command timed out/);
});

test('router firmware evidence tolerates Hyper-V entries without descriptions',()=>{
  const output=runPowerShell('tools/lib/LabRouter.ps1',['Get-LabRouterFirmwareEvidence'],`
    function Get-VMFirmware { [pscustomobject]@{ SecureBoot='On'; SecureBootTemplate='MicrosoftWindows'; BootOrder=@([pscustomobject]@{ BootType='Drive'; Device=[pscustomobject]@{ Id='disk' } }, [pscustomobject]@{ BootType='Network'; Device=[pscustomobject]@{ Id='net' } }) } }
    Get-LabRouterFirmwareEvidence -VmName 'router' | ConvertTo-Json -Depth 6 -Compress
  `);
  const evidence=JSON.parse(output);
  assert.equal(evidence.bootOrder[0].deviceId,'disk');
  assert.equal(evidence.bootOrder[0].description,'');
});

test('router PowerShell Direct timeout evidence records the phase and host boot state',()=>{
  const source=fs.readFileSync('tools/lib/LabRouter.ps1','utf8');
  const session=source.slice(source.indexOf('function New-LabRouterPSSession'),source.indexOf('function Initialize-LabRouterGuest'));
  assert.match(session,/Write-LabRouterSessionFailure -VmName \$VmName -Phase \$Phase/);
  assert.match(session,/Router PowerShell Direct timed out during \$Phase/);
  assert.doesNotMatch(session,/-SessionOption \$sessionOption/);
  const evidence=source.slice(source.indexOf('function Write-LabRouterSessionFailure'),source.indexOf('function New-LabRouterPSSession'));
  assert.match(evidence,/Get-VMIntegrationService -VMName \$VmName/);
  assert.match(evidence,/vmState = \[string\]\$vm\.State/);
  assert.match(evidence,/lastError = \[string\]\$LastError/);
});

test('router bootstrap switches its owned VM to the deployed disk before waiting for Windows',()=>{
  const source=fs.readFileSync('tools/Invoke-WinceptionLabRegression.ps1','utf8');
  const switchFn=source.slice(source.indexOf('function Set-LabDeployedDiskFirst'),source.indexOf('function Get-FirstValue'));
  assert.match(switchFn,/Stop-VM -Name \$VmName -TurnOff -Force/);
  assert.match(switchFn,/Set-VMFirmware -VMName \$VmName -FirstBootDevice \$disk/);
  assert.match(switchFn,/deployed-disk-boot-\$safeName\.json/);
  assert.match(switchFn,/Start-VM -Name \$VmName/);
  const waitFn=source.slice(source.indexOf('function Wait-FleetCompletion'),source.indexOf('function Acquire-LabLock'));
  assert.match(waitFn,/PreferDeployedDisk/);
  assert.match(waitFn,/latestStage -eq 'rebooting'/);
  assert.match(waitFn,/Set-LabDeployedDiskFirst -VmName \$vmName/);
  assert.match(source,/Wait-FleetCompletion -VmNames \$VmNames[\s\S]*?-PreferDeployedDisk:\$KeepGuest/);
});
test('Fleet wait emits bounded redacted heartbeat evidence for active monitoring',()=>{
  const source=fs.readFileSync('tools/Invoke-WinceptionLabRegression.ps1','utf8');
  assert.match(source,/function Write-FleetWaitHeartbeat/);
  assert.match(source,/fleet-wait-heartbeat\.json/);
  assert.match(source,/\[AllowEmptyCollection\(\)\]\[Parameter\(Mandatory\)\]\[object\[\]\] \$Runs/);
  const waitFn=source.slice(source.indexOf('function Wait-FleetCompletion'),source.indexOf('function Acquire-LabLock'));
  assert.match(waitFn,/Write-FleetWaitHeartbeat -VmNames \$VmNames -Runs \$relevant/);
});
test('Fleet wait heartbeat accepts an empty Fleet snapshot while services start',()=>{
  const output=runPowerShell('tools/Invoke-WinceptionLabRegression.ps1',['Write-FleetWaitHeartbeat'],`
    function Get-VM {param($Name) [pscustomobject]@{State='Off'} }
    function Get-VMIntegrationService {param($VMName,$Name) [pscustomobject]@{PrimaryStatusDescription='OK'} }
    function Write-Evidence {param($Name,$Value) $script:written=$Value }
    Write-FleetWaitHeartbeat -VmNames @('owned-vm') -Runs @()
    @{phase=$script:written.phase;runCount=@($script:written.runs).Count;vmCount=@($script:written.vms).Count}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(JSON.parse(output),{phase:'fleet-wait',runCount:0,vmCount:1});
});
test('router ownership refuses foreign disk chains changed VM and absent checkpoints',()=>{
  const output=runPowerShell('tools/lib/LabRouter.ps1',['Assert-LabRouterOwnership'],`
    $script:foreign=$false;$script:checkpoint=$true;$script:vmId='owned'
    function Test-Path {param($LiteralPath) $true}
    function Get-Content {param($LiteralPath,[switch]$Raw) @{vmId='owned';switchName='Winception-AutoLab';vhdxPath='C:\\OSDCloud\\HostTools\\State\\lab\\router\\winception-autolab-router.vhdx'}|ConvertTo-Json}
    function Get-VM {[CmdletBinding()]param($Name) [pscustomobject]@{Id=$script:vmId;Generation=2}}
    function Get-VMMemory {param($VMName) [pscustomobject]@{DynamicMemoryEnabled=$false;Startup=4GB}}
    function Get-VMNetworkAdapter {param($VMName) [pscustomobject]@{Name='LAN';SwitchName='Winception-AutoLab'}}
    function Get-VMHardDiskDrive {param($VMName) [pscustomobject]@{Path='C:\\OSDCloud\\HostTools\\State\\lab\\router\\checkpoint.avhdx'}}
    function Get-VHD {[CmdletBinding()]param($Path) [pscustomobject]@{ParentPath=$(if($script:foreign){'C:\\foreign.vhdx'}else{'C:\\OSDCloud\\HostTools\\State\\lab\\router\\winception-autolab-router.vhdx'})}}
    function Get-VMFirmware {param($VMName) [pscustomobject]@{SecureBoot='On'}}
    function Get-VMSecurity {param($VMName) [pscustomobject]@{TpmEnabled=$true}}
    function Get-VMSnapshot {[CmdletBinding()]param($VMName,$Name) if($script:checkpoint){[pscustomobject]@{Name=$Name}}}
    $cfg=@{stateRoot='C:\\OSDCloud\\HostTools\\State'}
    Assert-LabRouterOwnership $cfg|Out-Null
    $rejected=0;foreach($case in @('foreign','vm','checkpoint')){
      $script:foreign=$case -eq 'foreign';$script:vmId=if($case -eq 'vm'){'unknown'}else{'owned'};$script:checkpoint=$case -ne 'checkpoint'
      try{Assert-LabRouterOwnership $cfg|Out-Null}catch{$rejected++}
    };$rejected
  `);
  assert.equal(Number(output),3);
});
test('Lab guard failure cleanup performs no service or VM mutation',()=>{
  assert.equal(runPowerShell('tools/Invoke-WinceptionLabRegression.ps1',['Invoke-LabCleanup'],`
    $script:CleanupComplete=$false;$ValidateOnly=$false;$script:MutationStarted=$false
    $script:CleanupErrors=New-Object 'System.Collections.Generic.List[string]'
    function Stop-LabServices {throw 'Unexpected mutation'}
    function Restore-LabCheckpoint {throw 'Unexpected VM restore'}
    function Restore-SecretEnvironment {}
    function Release-LabLock {}
    Invoke-LabCleanup;'No mutation'
  `),'No mutation');
});
test('physical cleanup refuses HTTP success when a deployment service is still running',()=>{
  const output=runPowerShell('tools/lib/Acceptance.ps1',['Stop-AcceptanceServices'],`
    $script:running=$true
    function Invoke-AcceptanceApi {param($Method,$Path) [pscustomobject]@{state=[pscustomobject]@{services=[pscustomobject]@{http=[pscustomobject]@{running=$script:running}}}}}
    $rejected=$false;try{Stop-AcceptanceServices}catch{$rejected=$true}
    if(-not $rejected){throw 'Running service accepted as cleaned'}
    $script:running=$false;Stop-AcceptanceServices;'Stopped'
  `);
  assert.equal(output,'Stopped');
});

test('round credential MAC scope is fixed after checkpoint restore and rejects collisions',()=>{
  const source=fs.readFileSync('tools/Invoke-WinceptionLabRegression.ps1','utf8');
  assert.match(source,/Restore-LabCheckpoint -VmNames \$VmNames -RoundFirmware[\s\S]*?Set-LabRoundClientScope -VmNames \$VmNames/);
  assert.match(source,/Set-VMNetworkAdapter -VMNetworkAdapter \$nic\[0\] -StaticMacAddress \$mac[\s\S]*?Sync-LabNetworkBootAfterMac -VmName \$vm\.Name/);
  const scopeFn=source.slice(source.indexOf('function Set-LabRoundClientScope'),source.indexOf('function Invoke-LabRound'));
  assert.match(scopeFn,/Sync-LabNetworkBootAfterMac -VmName \$vm\.Name/);
  const block='Set-LabRoundClientScope -VmNames $VmNames';
  const output=runPowerShell('tools/Invoke-WinceptionLabRegression.ps1',[
    'Set-LabRoundClientScope','Sync-LabNetworkBootAfterMac','Get-FirmwareBootOrderEntries','Get-FirmwareNetworkBootSource','Get-FirmwareBootDeviceId','Get-FirmwareBootType','Test-FirmwareNetworkFirst','Get-OptionalProperty','ConvertTo-ObjectList'
  ],`
    $VmNames=@('winception-autolab-router');$script:collision=$false;$script:assigned='';$script:firstBoot=$false
    $vm=[pscustomobject]@{Name=$VmNames[0];State='Off';Id=[guid]'12345678-1234-1234-1234-123456789012'}
    $nicId='Microsoft:12345678-1234-1234-1234-123456789012\\nic'
    $network=[pscustomobject]@{BootType='Network';Device=[pscustomobject]@{Id=$nicId}}
    function Get-VM {param($Name) if($Name){$vm}else{[pscustomobject]@{Name='foreign'}}}
    function Get-VMNetworkAdapter {param($VMName,[Parameter(ValueFromPipeline)]$InputObject) process {if($VMName){[pscustomobject]@{VMName=$VMName;SwitchName='Winception-AutoLab';MacAddress='000000000000';Id=$nicId}}else{[pscustomobject]@{VMName='foreign';MacAddress=$(if($script:collision){'00155D123456'}else{'00155DAABBCC'})}}}}
    function Set-VMNetworkAdapter {param($VMNetworkAdapter,$StaticMacAddress) $script:assigned=$StaticMacAddress}
    function Get-VMFirmware {param($VMName) [pscustomobject]@{BootOrder=@($network)}}
    function Set-VMFirmware {param($VMName,$FirstBootDevice) if($FirstBootDevice){$script:firstBoot=$true}}
    ${block}
    $expectedMac=$script:RoundClientMacs[0];$script:collision=$true;$rejected=$false
    try {${block}}catch{$rejected=$true}
    @{mac=$expectedMac;assigned=$script:assigned;collisionRejected=$rejected;firstBoot=$script:firstBoot}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(JSON.parse(output),{mac:'00-15-5D-12-34-56',assigned:'00155D123456',collisionRejected:true,firstBoot:true});
});

test('stopping deployment services aborts Fleet wait without retry',()=>{
  assert.match(runPowerShell('tools/Invoke-WinceptionLabRegression.ps1',['Wait-FleetCompletion','Test-ClientTerminalFailureText'],`
    function Get-LatestClientStatusText { '' }
    function Get-ConsoleState { @{services=@{http=@{running=$false};tftp=@{running=$false};dhcp=@{running=$false}}} }
    try {Wait-FleetCompletion @('owned-vm') 60;throw 'Wait accepted stopped services'}catch{if($_.Exception.Message -notlike 'Deployment services stopped*'){throw};'Aborted'}
  `),/Aborted/);
});

test('Proxy rejection accepts port-qualified denial evidence and refuses issued credentials',()=>{
  const output=runPowerShell('tools/lib/LabNetworkAcceptance.ps1',['Invoke-LabProxyRejection'],`
    $script:Config=@{secureBootVms=@('owned-vm')};$script:reads=0;$script:issued=$false;$script:scope=$false;$script:written=$null
    function Restore-LabCheckpoint {param($VmNames) $script:scope=$false}
    function Set-LabRoundClientScope {param($VmNames) $script:scope=$true}
    function Set-ConsoleMode {param($BootMode)};function Set-ConsoleEndpoint {};function Set-ConsoleDhcpServerMode {param($Mode)};function Invoke-ApiPreflight {};function Clear-DeploymentStatus {};function Stop-LabServices {};function Start-LabVms {param($VmNames)};function Start-Sleep {param($Seconds)}
    function Start-LabServices {if(-not $script:scope){throw 'Scope not set after restore'}}
    function Get-ConsoleState {$script:reads++;@{logs=@($(if($script:reads -eq 1){'old'}elseif($script:issued){'192.168.177.100:50001 POST /osdcloud/boot-session 201'}else{'192.168.177.100:50001 POST /osdcloud/boot-session 403'}));fleet=@{runs=@()}}}
    function Invoke-LabPairingDecision {param($VmNames,$Approve) @{clientIp='192.168.177.100';clientMac='00155DAABBCC';bootId='fresh'}}
    function Write-Evidence {param($Name,$Value) $script:written=$Value}
    $credential=[pscredential]::new('test',[Security.SecureString]::new())
    Invoke-LabProxyRejection -Credential $credential
    $status=$script:written.status;$script:reads=0;$script:issued=$true;$rejected=$false
    try{Invoke-LabProxyRejection -Credential $credential}catch{if($_.Exception.Message -notlike 'Rejected Proxy client*'){throw};$rejected=$true}
    @{status=$status;issuedRejected=$rejected}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(JSON.parse(output),{status:'Passed',issuedRejected:true});
});
