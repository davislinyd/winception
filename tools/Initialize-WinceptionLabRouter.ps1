[CmdletBinding()]
param([string]$ConfigPath,[switch]$ValidateOnly,[switch]$Create)
. (Join-Path $PSScriptRoot 'lib\Common.ps1')
. (Join-Path $PSScriptRoot 'lib\LabRouter.ps1')
$ErrorActionPreference='Stop'
if(-not $ConfigPath){$ConfigPath=Join-Path $PSScriptRoot '..\config\lab-regression.example.json'}
$config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
if ($config.switchName -ne 'Winception-AutoLab' -or $config.serviceIp -ne '192.168.177.1' -or $config.stateRoot -ne 'C:\OSDCloud\HostTools\State') {throw 'Router bootstrap only supports the dedicated AutoLab'}
if (-not (Test-IsAdministrator)) {throw 'Elevated PowerShell required'}
if (-not $Create -or $ValidateOnly) {Assert-LabRouterOwnership $config -Ready|Select-Object Name,State;return}
$mutex=[Threading.Mutex]::new($false,'Global\Winception-AutoLab')
if(-not $mutex.WaitOne(0)){$mutex.Dispose();throw 'Another Lab or physical acceptance holds the deployment lock'}
try {
if ((Get-VMSwitch -Name Winception-AutoLab).SwitchType -ne 'Internal') {throw 'AutoLab switch must be Internal'}
if (Get-VM -Name winception-autolab-router -ErrorAction SilentlyContinue) {Assert-LabRouterOwnership $config|Out-Null;return}
& (Join-Path $PSScriptRoot 'Initialize-WinceptionLab.ps1') -ConfigPath $ConfigPath -ValidateOnly
if(-not $?){throw 'AutoLab prerequisites failed before router creation'}
$attached=@(Get-VM|Get-VMNetworkAdapter|Where-Object SwitchName -eq Winception-AutoLab)
if(@($attached|Where-Object VMName -notin (@($config.secureBootVms)+@($config.ipxeVm))).Count){throw 'Unknown VM is attached to AutoLab'}
$state=Invoke-RestMethod "http://$($config.web.host):$($config.web.port)/api/state" -ErrorAction Stop
if($state.state.operation.running -or @($state.state.services.psobject.Properties|Where-Object {$_.Value.running}).Count){throw 'Console must be idle before router creation'}
$root=Join-Path $config.stateRoot 'lab\router'
$disk=Join-Path $root 'winception-autolab-router.vhdx'
if (Test-Path -LiteralPath $disk) {throw 'Unowned router disk already exists'}
if (-not (Test-Path -LiteralPath $config.baseVhdxPath)) {throw 'Clean base VHDX missing'}
New-Item -ItemType Directory -Path $root -Force|Out-Null
Copy-Item -LiteralPath $config.baseVhdxPath -Destination $disk
$vm=New-VM -Name winception-autolab-router -Generation 2 -MemoryStartupBytes 4GB -VHDPath $disk -SwitchName Winception-AutoLab
@{schemaVersion=1;vmId=[string]$vm.Id;vhdxPath=$disk;switchName='Winception-AutoLab'}|ConvertTo-Json|Set-Content (Join-Path $root 'ownership.json')
Rename-VMNetworkAdapter -VMName $vm.Name -Name 'Network Adapter' -NewName LAN
Set-VMMemory -VMName $vm.Name -DynamicMemoryEnabled $false
Set-VMKeyProtector -VMName $vm.Name -NewLocalKeyProtector
Enable-VMTPM -VMName $vm.Name
Set-VMFirmware -VMName $vm.Name -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice (Get-VMNetworkAdapter -VMName $vm.Name)
Checkpoint-VM -Name $vm.Name -SnapshotName $config.checkpointName|Out-Null
Write-Output 'Router VM created. Run Invoke-WinceptionLabRegression.ps1 -BootstrapRouter to deploy and checkpoint its guest.'
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
