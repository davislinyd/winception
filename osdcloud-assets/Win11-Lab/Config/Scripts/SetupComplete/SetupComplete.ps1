$ErrorActionPreference = 'Continue'
$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'davis-oobe-transcript.log') -Append -ErrorAction SilentlyContinue

$UserName = 'davis'
$PlainPassword = 'password'
$SecurePassword = ConvertTo-SecureString $PlainPassword -AsPlainText -Force

function Resolve-TargetUserProfilePath {
    param(
        [Parameter(Mandatory)][string] $TargetUser
    )

    $profileList = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
    if (-not (Test-Path -LiteralPath $profileList)) {
        return $null
    }

    Get-ChildItem -LiteralPath $profileList -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        } |
        Where-Object {
            $_.ProfileImagePath -and (Split-Path -Leaf $_.ProfileImagePath) -ieq $TargetUser
        } |
        Select-Object -ExpandProperty ProfileImagePath -First 1
}

function Set-TargetUserEnvironment {
    param(
        [Parameter(Mandatory)][string] $TargetUser
    )

    $profilePath = Resolve-TargetUserProfilePath -TargetUser $TargetUser
    $desktopPath = if ($profilePath) {
        Join-Path $profilePath 'Desktop'
    }
    else {
        Join-Path $env:SystemDrive 'Users\Default\Desktop'
    }

    New-Item -ItemType Directory -Path $desktopPath -Force -ErrorAction SilentlyContinue | Out-Null
    [Environment]::SetEnvironmentVariable('OSDCloudTargetUser', $TargetUser, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudTargetProfilePath', $profilePath, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudTargetDesktopPath', $desktopPath, 'Process')
}

function Install-DesktopReadyMarkerTask {
    $programData = 'C:\ProgramData\OSDCloud'
    New-Item -ItemType Directory -Path $programData -Force | Out-Null
    $markerScriptPath = Join-Path $programData 'Mark-DavisDesktopReady.ps1'
    $taskName = 'OSDCloudDesktopReadyMarker'
    $markerScript = @'
$ErrorActionPreference = 'Continue'
$targetUser = 'davis'
$taskName = 'OSDCloudDesktopReadyMarker'
$logDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Transcript -Path (Join-Path $logDir 'desktop-ready-marker.log') -Append -ErrorAction SilentlyContinue | Out-Null

function Test-TargetUserIdentity {
    param([string] $Identity)

    if ([string]::IsNullOrWhiteSpace($Identity)) {
        return $false
    }

    return ($Identity -ieq $targetUser -or $Identity -match "\\$([regex]::Escape($targetUser))$")
}

function Get-LoggedOnUser {
    try {
        return (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).UserName
    }
    catch {
        return $null
    }
}

function Get-ExplorerOwner {
    try {
        $owners = @(Get-CimInstance Win32_Process -Filter "name = 'explorer.exe'" -ErrorAction Stop |
            ForEach-Object {
                $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
                if ($owner -and $owner.ReturnValue -eq 0 -and $owner.User) {
                    if ($owner.Domain) {
                        "$($owner.Domain)\$($owner.User)"
                    }
                    else {
                        $owner.User
                    }
                }
            } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

        $targetOwner = @($owners | Where-Object { Test-TargetUserIdentity -Identity $_ } | Select-Object -First 1)
        if ($targetOwner.Count -gt 0) {
            return $targetOwner[0]
        }

        return @($owners | Select-Object -First 1)[0]
    }
    catch {
        return $null
    }
}

function Get-TargetUserProfilePath {
    $profileList = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
    if (-not (Test-Path -LiteralPath $profileList)) {
        return $null
    }

    Get-ChildItem -LiteralPath $profileList -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        } |
        Where-Object {
            $_.ProfileImagePath -and (Split-Path -Leaf $_.ProfileImagePath) -ieq $targetUser
        } |
        Select-Object -ExpandProperty ProfileImagePath -First 1
}

try {
    $deadline = (Get-Date).AddMinutes(30)
    do {
        $loggedOnUser = Get-LoggedOnUser
        $explorerOwner = Get-ExplorerOwner
        $profilePath = Get-TargetUserProfilePath
        if (((Test-TargetUserIdentity -Identity $loggedOnUser) -or (Test-TargetUserIdentity -Identity $explorerOwner)) -and $profilePath) {
            $desktopPath = Join-Path $profilePath 'Desktop'
            New-Item -ItemType Directory -Path $desktopPath -Force | Out-Null
            "OSDCloud desktop ready $(Get-Date -Format o)" | Out-File (Join-Path $desktopPath 'OSDCloud-Desktop-Ready.txt') -Encoding ascii -Force
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            break
        }

        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
'@

    Set-Content -LiteralPath $markerScriptPath -Value $markerScript -Encoding UTF8 -Force
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$markerScriptPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 35)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
}

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

    Set-TargetUserEnvironment -TargetUser $UserName
    Install-DesktopReadyMarkerTask
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue
}

shutdown.exe /r /t 10 /c "OSDCloud davis desktop autologon"
