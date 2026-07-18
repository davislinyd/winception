$ErrorActionPreference = 'Stop'

$logRoot = 'C:\OSDCloud\Logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot 'Invoke-OobeCustomization-Shutdown.log'
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

function Get-DeploymentMetadata {
    param(
        [string] $WindowsRoot
    )

    $metadataPath = Join-Path $WindowsRoot 'ProgramData\OSDCloud\DeploymentStatus.json'
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        try {
            return Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        }
        catch {
            Write-Warning "Unable to read deployment metadata $metadataPath`: $($_.Exception.Message)"
        }
    }

    return $null
}

function Get-SelectedOsMetadata {
    param(
        [object] $DeploymentMetadata
    )

    if ($DeploymentMetadata -and $DeploymentMetadata.selectedOs) {
        return $DeploymentMetadata.selectedOs
    }

    [pscustomobject]@{
        uiLanguage = 'zh-TW'
        locale = 'zh-TW'
        inputLanguage = 'zh-TW'
        language = 'zh-tw'
        timeZone = 'Taipei Standard Time'
    }
}

function Get-DeploymentAutoLogonEnabled {
    param(
        [object] $DeploymentMetadata
    )

    if (-not $DeploymentMetadata -or -not $DeploymentMetadata.PSObject.Properties['autoLogon']) {
        return $false
    }

    return ($DeploymentMetadata.autoLogon -is [bool] -and [bool] $DeploymentMetadata.autoLogon)
}

function ConvertTo-XmlText {
    param(
        [string] $Value
    )

    [System.Security.SecurityElement]::Escape($Value)
}

function Get-DeploymentSecretPathCandidates {
    $candidates = @()
    if ($PSScriptRoot) {
        $root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
        $candidates += Join-Path $root 'secrets.json'
        $candidates += Join-Path $root 'Config\secrets.json'
    }

    $candidates += Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'C' -and $_.Name -ne 'X' } |
        ForEach-Object {
            "$($_.Name):\OSDCloud\secrets.json"
            "$($_.Name):\OSDCloud\Config\secrets.json"
        }

    $candidates | Where-Object { $_ } | Select-Object -Unique
}

function Get-DeploymentSecret {
    param(
        [Parameter(Mandatory)][string] $JsonName,
        [Parameter(Mandatory)][string] $EnvironmentName
    )

    foreach ($scope in @('Process', 'Machine')) {
        $value = [Environment]::GetEnvironmentVariable($EnvironmentName, $scope)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return [string] $value
        }
    }

    foreach ($candidate in Get-DeploymentSecretPathCandidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            continue
        }

        try {
            $secrets = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json
            $value = $secrets.$JsonName
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return [string] $value
            }
        }
        catch {
            Write-Warning "Unable to read deployment secrets from $candidate`: $($_.Exception.Message)"
        }
    }

    throw "Missing required deployment secret '$JsonName'. Provide an untracked secrets.json in the OSDCloud runtime or set $EnvironmentName."
}

try {
    $windowsRoot = Get-TargetWindowsRoot
    Write-Host "Target Windows root: $windowsRoot"
    $deploymentMetadata = Get-DeploymentMetadata -WindowsRoot $windowsRoot
    $selectedOs = Get-SelectedOsMetadata -DeploymentMetadata $deploymentMetadata
    $autoLogonEnabled = Get-DeploymentAutoLogonEnabled -DeploymentMetadata $deploymentMetadata
    $uiLanguage = if ($selectedOs.uiLanguage) { [string] $selectedOs.uiLanguage } elseif ($selectedOs.language) { [string] $selectedOs.language } else { 'zh-TW' }
    $locale = if ($selectedOs.locale) { [string] $selectedOs.locale } else { $uiLanguage }
    $inputLanguage = if ($selectedOs.inputLanguage) { [string] $selectedOs.inputLanguage } elseif ($selectedOs.language) { [string] $selectedOs.language } else { $uiLanguage }
    $timeZone = if ($selectedOs.timeZone) { [string] $selectedOs.timeZone } else { '' }
    if ([string]::IsNullOrWhiteSpace($timeZone)) {
        throw 'Deployment metadata is missing an explicit Windows time zone.'
    }
    $localeXml = ConvertTo-XmlText -Value $locale
    $uiLanguageXml = ConvertTo-XmlText -Value $uiLanguage
    $inputLanguageXml = ConvertTo-XmlText -Value $inputLanguage
    $timeZoneXml = ConvertTo-XmlText -Value $timeZone
    $windowsUsername = Get-DeploymentSecret -JsonName 'windowsUsername' -EnvironmentName 'OSDCLOUD_WINDOWS_USERNAME'
    $windowsPassword = Get-DeploymentSecret -JsonName 'windowsPassword' -EnvironmentName 'OSDCLOUD_WINDOWS_PASSWORD'
    $windowsUsernameXml = ConvertTo-XmlText -Value $windowsUsername
    $windowsPasswordXml = ConvertTo-XmlText -Value $windowsPassword
    $autoLogonXml = if ($autoLogonEnabled) {
@"
      <AutoLogon>
        <Password>
          <Value>$windowsPasswordXml</Value>
          <PlainText>true</PlainText>
        </Password>
        <Enabled>true</Enabled>
        <LogonCount>5</LogonCount>
        <Username>$windowsUsernameXml</Username>
      </AutoLogon>
"@
    }
    else {
        ''
    }
    Write-Host "OOBE UILanguage: $uiLanguage"
    Write-Host "OOBE regional format (UserLocale): $locale"
    Write-Host "OOBE input language (InputLocale): $inputLanguage"
    Write-Host "OOBE time zone: $timeZone"
    Write-Host "OOBE automatic sign-in: $autoLogonEnabled"

    $panther = Join-Path $windowsRoot 'Windows\Panther'
    $sysprep = Join-Path $windowsRoot 'Windows\System32\Sysprep'
    $setupScripts = Join-Path $windowsRoot 'Windows\Setup\Scripts'
    New-Item -ItemType Directory -Path $panther, $sysprep, $setupScripts -Force | Out-Null

    $unattend = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <InputLocale>$inputLanguageXml</InputLocale>
      <SystemLocale>$uiLanguageXml</SystemLocale>
      <UILanguage>$uiLanguageXml</UILanguage>
      <UILanguageFallback>$uiLanguageXml</UILanguageFallback>
      <UserLocale>$localeXml</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <TimeZone>$timeZoneXml</TimeZone>
      <RegisteredOwner>$windowsUsernameXml</RegisteredOwner>
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
              <Value>$windowsPasswordXml</Value>
              <PlainText>true</PlainText>
            </Password>
            <Description>Local administrator account</Description>
            <DisplayName>$windowsUsernameXml</DisplayName>
            <Group>Administrators</Group>
            <Name>$windowsUsernameXml</Name>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
$autoLogonXml
    </component>
  </settings>
</unattend>
"@

    $unattendPath = Join-Path $panther 'Unattend.xml'
    Set-Content -LiteralPath $unattendPath -Value $unattend -Encoding UTF8 -Force
    Set-Content -LiteralPath (Join-Path $sysprep 'Unattend.xml') -Value $unattend -Encoding UTF8 -Force

    $secretTargetRoot = Join-Path $windowsRoot 'ProgramData\OSDCloud'
    New-Item -ItemType Directory -Path $secretTargetRoot -Force | Out-Null
    ([ordered]@{
        windowsUsername = $windowsUsername
        windowsPassword = $windowsPassword
    } | ConvertTo-Json -Depth 4) |
        Set-Content -LiteralPath (Join-Path $secretTargetRoot 'secrets.json') -Encoding UTF8 -Force

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

    $appCandidates = @()
    if ($PSScriptRoot) {
        $osdCloudScriptRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
        $appCandidates += Join-Path $osdCloudScriptRoot 'Apps'
    }

    $appCandidates += Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'C' -and $_.Name -ne 'X' } |
        ForEach-Object { "$($_.Name):\OSDCloud\Apps" }

    $sourceApps = $appCandidates |
        Where-Object { $_ -and (Test-Path (Join-Path $_ 'Install-Apps.ps1') -PathType Leaf) } |
        Select-Object -First 1

    if ($sourceApps) {
        $targetApps = Join-Path $windowsRoot 'ProgramData\OSDCloud\Apps'
        New-Item -ItemType Directory -Path $targetApps -Force | Out-Null
        Copy-Item -Path (Join-Path $sourceApps '*') -Destination $targetApps -Recurse -Force
        Write-Host "Client apps source: $sourceApps"
        Write-Host "Client apps target: $targetApps"

        $sourceScripts = Join-Path (Split-Path -Parent $sourceApps) 'Scripts'
        if (Test-Path -LiteralPath $sourceScripts -PathType Container) {
            $targetScripts = Join-Path $windowsRoot 'ProgramData\OSDCloud\Scripts'
            New-Item -ItemType Directory -Path $targetScripts -Force | Out-Null
            Copy-Item -Path (Join-Path $sourceScripts '*') -Destination $targetScripts -Recurse -Force
            Write-Host "Client scripts source: $sourceScripts"
            Write-Host "Client scripts target: $targetScripts"
        }
    }

    $cmdPath = Join-Path $setupScripts 'SetupComplete.cmd'
    if (-not (Test-Path $cmdPath)) {
        $cmd = @'
@echo off
set LOG=C:\Windows\Setup\Scripts\OobeCustomization.log
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
    $winlogonKey = 'HKLM\OSD_OFF_SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    if ($autoLogonEnabled) {
        reg.exe add $winlogonKey /v AutoAdminLogon /t REG_SZ /d '1' /f | Out-Null
        reg.exe add $winlogonKey /v ForceAutoLogon /t REG_SZ /d '1' /f | Out-Null
        reg.exe add $winlogonKey /v DefaultUserName /t REG_SZ /d $windowsUsername /f | Out-Null
        reg.exe add $winlogonKey /v DefaultPassword /t REG_SZ /d $windowsPassword /f | Out-Null
        reg.exe add $winlogonKey /v AutoLogonCount /t REG_DWORD /d 5 /f | Out-Null
    }
    else {
        @('AutoAdminLogon', 'ForceAutoLogon', 'DefaultUserName', 'DefaultPassword', 'DefaultDomainName', 'AutoLogonCount') |
            ForEach-Object { reg.exe delete $winlogonKey /v $_ /f 2>$null | Out-Null }
    }
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' /v NoAutoUpdate /t REG_DWORD /d 1 /f | Out-Null
    reg.exe add 'HKLM\OSD_OFF_SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' /v AUOptions /t REG_DWORD /d 2 /f | Out-Null
    reg.exe unload HKLM\OSD_OFF_SOFTWARE | Out-Null

    $marker = Join-Path $windowsRoot 'OSDCloud\Logs\OobeCustomizationInjected.txt'
    "Injected $(Get-Date -Format o) to $windowsRoot" | Set-Content -LiteralPath $marker -Encoding ASCII -Force
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
