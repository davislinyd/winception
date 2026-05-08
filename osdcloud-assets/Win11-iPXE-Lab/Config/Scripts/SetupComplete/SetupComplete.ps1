$ErrorActionPreference = 'Continue'
$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'davis-oobe-transcript.log') -Append -ErrorAction SilentlyContinue

$UserName = 'davis'
$PlainPassword = 'password'
$SecurePassword = ConvertTo-SecureString $PlainPassword -AsPlainText -Force
$DeploymentMetadataPath = 'C:\ProgramData\OSDCloud\DeploymentStatus.json'
$DefaultStatusUrl = 'http://192.168.100.100/osdcloud/status'

function Get-DeploymentMetadata {
    if (Test-Path -LiteralPath $DeploymentMetadataPath -PathType Leaf) {
        try {
            return Get-Content -LiteralPath $DeploymentMetadataPath -Raw | ConvertFrom-Json
        }
        catch {
        }
    }

    [pscustomobject]@{
        runId = "windows-$env:COMPUTERNAME-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        clientId = $env:COMPUTERNAME
        statusUrl = $DefaultStatusUrl
    }
}

$DeploymentMetadata = Get-DeploymentMetadata

function Send-DeploymentStatus {
    param(
        [string] $Stage,
        [string] $Message,
        [Nullable[double]] $Percent = $null,
        [hashtable] $Extra = @{}
    )

    $statusUrl = if ($DeploymentMetadata.statusUrl) { [string] $DeploymentMetadata.statusUrl } else { $DefaultStatusUrl }
    $payload = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        runId = [string] $DeploymentMetadata.runId
        clientId = [string] $DeploymentMetadata.clientId
        stage = $Stage
        message = $Message
        percent = $Percent
        source = 'windows'
        computerName = $env:COMPUTERNAME
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    try {
        Invoke-WebRequest -Uri $statusUrl -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
        return $true
    }
    catch {
    }

    try {
        $client = [System.Net.WebClient]::new()
        $client.Headers['Content-Type'] = 'application/json'
        [void] $client.UploadString($statusUrl, 'POST', $json)
        return $true
    }
    catch {
    }
    finally {
        if ($client) {
            $client.Dispose()
        }
    }

    return $false
}

function Install-DesktopReadyReporter {
    $programData = 'C:\ProgramData\OSDCloud'
    New-Item -ItemType Directory -Path $programData -Force | Out-Null
    $reporterPath = Join-Path $programData 'Report-DesktopReady.ps1'
    $taskName = 'OSDCloudDesktopReadyReport'
    $reporter = @'
$ErrorActionPreference = 'Continue'
$metadataPath = 'C:\ProgramData\OSDCloud\DeploymentStatus.json'
$defaultStatusUrl = 'http://192.168.100.100/osdcloud/status'
$taskName = 'OSDCloudDesktopReadyReport'
$logDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Transcript -Path (Join-Path $logDir 'desktop-ready-reporter.log') -Append -ErrorAction SilentlyContinue | Out-Null

function Get-Metadata {
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        try {
            return Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        }
        catch {
        }
    }

    [pscustomobject]@{
        runId = "windows-$env:COMPUTERNAME-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        clientId = $env:COMPUTERNAME
        statusUrl = $defaultStatusUrl
    }
}

$metadata = Get-Metadata

function Send-Status {
    param(
        [string] $Stage,
        [string] $Message,
        [Nullable[double]] $Percent = $null,
        [hashtable] $Extra = @{}
    )

    $statusUrl = if ($metadata.statusUrl) { [string] $metadata.statusUrl } else { $defaultStatusUrl }
        $payload = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        runId = [string] $metadata.runId
        clientId = [string] $metadata.clientId
        stage = $Stage
        message = $Message
        percent = $Percent
        source = 'windows'
        computerName = $env:COMPUTERNAME
        runAs = "$env:USERDOMAIN\$env:USERNAME"
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    try {
        Invoke-WebRequest -Uri $statusUrl -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
        return
    }
    catch {
    }

    try {
        $client = [System.Net.WebClient]::new()
        $client.Headers['Content-Type'] = 'application/json'
        [void] $client.UploadString($statusUrl, 'POST', $json)
    }
    catch {
    }
    finally {
        if ($client) {
            $client.Dispose()
        }
    }
}

function Get-DesktopReadyFacts {
    $oobe = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE'
    $au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
    $currentVersion = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $explorer = @(Get-Process explorer -ErrorAction SilentlyContinue)
    $oobeProcesses = @(Get-Process CloudExperienceHost, msoobe -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName })

    [ordered]@{
        explorerRunning = ($explorer.Count -gt 0)
        desktopReadyFile = (Test-Path -LiteralPath 'C:\Users\Public\Desktop\OSDCloud-Desktop-Ready.txt')
        oobeProcesses = @($oobeProcesses)
        launchUserOobe = (Get-ItemProperty -Path $oobe -Name LaunchUserOOBE -ErrorAction SilentlyContinue).LaunchUserOOBE
        skipUserOobe = (Get-ItemProperty -Path $oobe -Name SkipUserOOBE -ErrorAction SilentlyContinue).SkipUserOOBE
        noAutoUpdate = (Get-ItemProperty -Path $au -Name NoAutoUpdate -ErrorAction SilentlyContinue).NoAutoUpdate
        displayVersion = (Get-ItemProperty -Path $currentVersion -Name DisplayVersion -ErrorAction SilentlyContinue).DisplayVersion
        currentBuild = (Get-ItemProperty -Path $currentVersion -Name CurrentBuild -ErrorAction SilentlyContinue).CurrentBuild
        editionId = (Get-ItemProperty -Path $currentVersion -Name EditionID -ErrorAction SilentlyContinue).EditionID
        culture = (Get-Culture).Name
        timeZone = (Get-TimeZone).Id
    }
}

try {
    [void] (Send-Status -Stage 'windows-logon-start' -Message 'Desktop ready reporter started after davis logon.' -Percent 98)
    $deadline = (Get-Date).AddMinutes(30)
    $desktopReadyReported = $false
    do {
        $facts = Get-DesktopReadyFacts
        if ($facts.explorerRunning -and $facts.desktopReadyFile -and @($facts.oobeProcesses).Count -eq 0) {
            if (Send-Status -Stage 'windows-desktop-ready' -Message 'Windows desktop is ready for davis.' -Percent 100 -Extra $facts) {
                $desktopReadyReported = $true
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                break
            }
        }

        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)

    if (-not $desktopReadyReported -and (Get-Date) -ge $deadline) {
        [void] (Send-Status -Stage 'windows-desktop-timeout' -Message 'Timed out waiting for Explorer and desktop marker or status upload.' -Extra (Get-DesktopReadyFacts))
    }
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
'@

    Set-Content -LiteralPath $reporterPath -Value $reporter -Encoding UTF8 -Force
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$reporterPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 35)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    return $reporterPath
}

[void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-start' -Message 'SetupComplete started in deployed Windows.' -Percent 94)

try {
    if (-not (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue)) {
        New-LocalUser -Name $UserName -Password $SecurePassword -FullName $UserName -Description 'Local deployment administrator' -PasswordNeverExpires -UserMayNotChangePassword:$false
    }
    else {
        Set-LocalUser -Name $UserName -Password $SecurePassword -PasswordNeverExpires $true
        Enable-LocalUser -Name $UserName
    }

    Add-LocalGroupMember -Group 'Administrators' -Member $UserName -ErrorAction SilentlyContinue

    if (Get-LocalUser -Name 'defaultuser0' -ErrorAction SilentlyContinue) {
        Remove-LocalUser -Name 'defaultuser0' -ErrorAction SilentlyContinue
    }

    Set-WinSystemLocale -SystemLocale zh-TW
    Set-WinUserLanguageList -LanguageList zh-TW -Force
    Set-Culture zh-TW
    Set-TimeZone -Id 'Taipei Standard Time'

    $Oobe = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE'
    New-Item -Path $Oobe -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name LaunchUserOOBE -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name SkipMachineOOBE -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name SkipUserOOBE -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name HideOnlineAccountScreens -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name HideEULAPage -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name HideWirelessSetupInOOBE -PropertyType DWord -Value 1 -Force | Out-Null

    $WindowsUpdate = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
    $AutomaticUpdates = Join-Path $WindowsUpdate 'AU'
    New-Item -Path $AutomaticUpdates -Force | Out-Null
    New-ItemProperty -Path $AutomaticUpdates -Name NoAutoUpdate -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $AutomaticUpdates -Name AUOptions -PropertyType DWord -Value 2 -Force | Out-Null
    Stop-Service -Name wuauserv, UsoSvc, bits -Force -ErrorAction SilentlyContinue

    $Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    New-ItemProperty -Path $Winlogon -Name AutoAdminLogon -PropertyType String -Value '1' -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name ForceAutoLogon -PropertyType String -Value '1' -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name DefaultUserName -PropertyType String -Value $UserName -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name DefaultPassword -PropertyType String -Value $PlainPassword -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name DefaultDomainName -PropertyType String -Value $env:COMPUTERNAME -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name AutoLogonCount -PropertyType DWord -Value 5 -Force | Out-Null

    $LogonUI = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI'
    if (Test-Path $LogonUI) {
        $Sid = (Get-LocalUser -Name $UserName).SID.Value
        New-ItemProperty -Path $LogonUI -Name LastLoggedOnUser -PropertyType String -Value "$env:COMPUTERNAME\$UserName" -Force | Out-Null
        New-ItemProperty -Path $LogonUI -Name LastLoggedOnSAMUser -PropertyType String -Value "$env:COMPUTERNAME\$UserName" -Force | Out-Null
        New-ItemProperty -Path $LogonUI -Name SelectedUserSID -PropertyType String -Value $Sid -Force | Out-Null
    }

    New-Item -ItemType Directory -Path 'C:\Users\Public\Desktop' -Force | Out-Null
    "OSDCloud desktop ready $(Get-Date -Format o)" | Out-File 'C:\Users\Public\Desktop\OSDCloud-Desktop-Ready.txt' -Encoding ascii -Force
    $reporterPath = Install-DesktopReadyReporter
    [void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-finished' -Message 'SetupComplete finished; desktop ready reporter installed.' -Percent 96 -Extra @{
        reporterPath = $reporterPath
    })
}
catch {
    [void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-error' -Message $_.Exception.Message -Extra @{ script = 'SetupComplete.ps1' })
    throw
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue
}

shutdown.exe /r /t 10 /c "OSDCloud davis desktop autologon"
