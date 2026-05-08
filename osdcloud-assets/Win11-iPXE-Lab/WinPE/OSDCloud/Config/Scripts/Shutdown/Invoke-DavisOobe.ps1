$ErrorActionPreference = 'Stop'

$logRoot = 'C:\OSDCloud\Logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot 'Invoke-DavisOobe-Shutdown.log'
Start-Transcript -Path $logPath -Append -ErrorAction SilentlyContinue | Out-Null

function Get-TargetWindowsRoot {
    $roots = Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'X' } |
        ForEach-Object { "$($_.Name):\" }

    foreach ($root in $roots) {
        if (Test-Path (Join-Path $root 'Windows\System32\Config\SOFTWARE')) {
            return $root
        }
    }

    throw 'Unable to locate the deployed Windows volume.'
}

try {
    $windowsRoot = Get-TargetWindowsRoot
    Write-Host "Target Windows root: $windowsRoot"

    $panther = Join-Path $windowsRoot 'Windows\Panther'
    $sysprep = Join-Path $windowsRoot 'Windows\System32\Sysprep'
    $setupScripts = Join-Path $windowsRoot 'Windows\Setup\Scripts'
    New-Item -ItemType Directory -Path $panther, $sysprep, $setupScripts -Force | Out-Null

    $unattend = @'
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <InputLocale>zh-TW</InputLocale>
      <SystemLocale>zh-TW</SystemLocale>
      <UILanguage>zh-TW</UILanguage>
      <UserLocale>zh-TW</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <TimeZone>Taipei Standard Time</TimeZone>
      <RegisteredOwner>davis</RegisteredOwner>
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <NetworkLocation>Work</NetworkLocation>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Password>
              <Value>password</Value>
              <PlainText>true</PlainText>
            </Password>
            <Description>Local administrator account</Description>
            <DisplayName>davis</DisplayName>
            <Group>Administrators</Group>
            <Name>davis</Name>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <AutoLogon>
        <Password>
          <Value>password</Value>
          <PlainText>true</PlainText>
        </Password>
        <Enabled>true</Enabled>
        <LogonCount>5</LogonCount>
        <Username>davis</Username>
      </AutoLogon>
    </component>
  </settings>
</unattend>
'@

    $unattendPath = Join-Path $panther 'Unattend.xml'
    Set-Content -LiteralPath $unattendPath -Value $unattend -Encoding UTF8 -Force
    Set-Content -LiteralPath (Join-Path $sysprep 'Unattend.xml') -Value $unattend -Encoding UTF8 -Force

    $setupCandidates = @()
    if ($PSScriptRoot) {
        $setupCandidates += Join-Path (Split-Path -Parent $PSScriptRoot) 'SetupComplete'
    }

    $setupCandidates += Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'C' -and $_.Name -ne 'X' } |
        ForEach-Object { "$($_.Name):\OSDCloud\Config\Scripts\SetupComplete" }

    $sourceSetup = $setupCandidates |
        Where-Object { $_ -and (Test-Path (Join-Path $_ 'SetupComplete.ps1')) } |
        Select-Object -First 1

    if ($sourceSetup) {
        Write-Host "SetupComplete source: $sourceSetup"
        Copy-Item -Path (Join-Path $sourceSetup '*') -Destination $setupScripts -Recurse -Force
    }

    $cmdPath = Join-Path $setupScripts 'SetupComplete.cmd'
    if (-not (Test-Path $cmdPath)) {
        $cmd = @'
@echo off
set LOG=C:\Windows\Setup\Scripts\DavisOobe.log
echo [%date% %time%] SetupComplete.cmd starting>>%LOG%
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\Windows\Setup\Scripts\SetupComplete.ps1 >>%LOG% 2>&1
exit /b 0
'@
        Set-Content -LiteralPath $cmdPath -Value $cmd -Encoding ASCII -Force
    }

    $systemHive = Join-Path $windowsRoot 'Windows\System32\Config\SYSTEM'
    reg.exe load HKLM\OSD_OFF_SYSTEM $systemHive | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SYSTEM\Setup' /v UnattendFile /t REG_SZ /d 'C:\Windows\Panther\Unattend.xml' /f | Out-Null
    reg.exe unload HKLM\OSD_OFF_SYSTEM | Out-Null

    $softwareHive = Join-Path $windowsRoot 'Windows\System32\Config\SOFTWARE'
    reg.exe load HKLM\OSD_OFF_SOFTWARE $softwareHive | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' /v LaunchUserOOBE /t REG_DWORD /d 0 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' /v SkipMachineOOBE /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' /v SkipUserOOBE /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' /v HideOnlineAccountScreens /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' /v HideEULAPage /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' /v HideWirelessSetupInOOBE /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' /v AutoAdminLogon /t REG_SZ /d '1' /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' /v ForceAutoLogon /t REG_SZ /d '1' /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' /v DefaultUserName /t REG_SZ /d 'davis' /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' /v DefaultPassword /t REG_SZ /d 'password' /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' /v AutoLogonCount /t REG_DWORD /d 5 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' /v NoAutoUpdate /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' /v AUOptions /t REG_DWORD /d 2 /f | Out-Null
    reg.exe unload HKLM\OSD_OFF_SOFTWARE | Out-Null

    $marker = Join-Path $windowsRoot 'OSDCloud\Logs\DavisOobeInjected.txt'
    "Injected $(Get-Date -Format o) to $windowsRoot" | Set-Content -LiteralPath $marker -Encoding ASCII -Force
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
