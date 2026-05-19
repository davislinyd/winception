$ErrorActionPreference = 'Stop'

$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'apps-install.log') -Append -ErrorAction SilentlyContinue | Out-Null

function Test-SafePackageId {
    param([Parameter(Mandatory)][string] $Id)
    return $Id -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
}

function Resolve-PackageScript {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $PackageId,
        [Parameter(Mandatory)][string] $ScriptName,
        [Parameter(Mandatory)][string] $Label
    )

    if (-not (Test-SafePackageId -Id $PackageId)) {
        throw "Unsafe $Label id in selected profile: $PackageId"
    }

    $rootFullPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $packageRoot = [System.IO.Path]::GetFullPath((Join-Path $rootFullPath $PackageId))
    $rootPrefix = "$rootFullPath\"
    if (-not $packageRoot.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label path escapes root: $PackageId"
    }

    $script = Join-Path $packageRoot $ScriptName
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
        throw "Selected $Label script not found: $PackageId ($script)"
    }

    return $script
}

function Get-SelectedProfile {
    param([Parameter(Mandatory)][string] $AppsRoot)

    $profilePath = Join-Path $AppsRoot 'selected-profile.json'
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
}

function Get-SelectedSoftwareIds {
    param(
        [Parameter(Mandatory)][string] $AppsRoot,
        $Profile
    )

    if (-not $Profile) {
        Write-Host "selected-profile.json not found; installing all app folders for backward compatibility."
        return @(Get-ChildItem -LiteralPath $AppsRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'Scripts' } |
            Sort-Object Name |
            ForEach-Object { $_.Name })
    }

    $ids = @()
    if ($Profile.selectedSoftware) {
        $ids = @($Profile.selectedSoftware)
    }
    elseif ($Profile.software) {
        $ids = @($Profile.software | ForEach-Object {
            if ($_.id) { $_.id } else { $_ }
        })
    }

    return @($ids | ForEach-Object { [string] $_ })
}

function Get-CustomScripts {
    param($Profile, [string] $Phase)

    if (-not $Profile -or -not $Profile.customScripts) {
        return @()
    }
    return @($Profile.customScripts | Where-Object { $_.phase -eq $Phase })
}

function Invoke-CustomScript {
    param(
        [Parameter(Mandatory)][string] $ScriptsRoot,
        [Parameter(Mandatory)] $Entry,
        [Parameter(Mandatory)][System.Collections.ArrayList] $Failures
    )

    $scriptId = [string] $Entry.id
    Write-Host "Running custom script ($($Entry.phase)): $scriptId"
    try {
        $script = Resolve-PackageScript -Root $ScriptsRoot -PackageId $scriptId -ScriptName 'run.ps1' -Label 'custom script'
        & $script
        Write-Host "Completed custom script: $scriptId"
    }
    catch {
        $message = "Failed custom script ${scriptId}: $($_.Exception.Message)"
        Write-Host $message
        [void] $Failures.Add($message)
    }
}

try {
    $appsRoot = $PSScriptRoot
    $scriptsRoot = Join-Path (Split-Path -Parent $appsRoot) 'Scripts'
    $failures = New-Object System.Collections.ArrayList

    $profile = Get-SelectedProfile -AppsRoot $appsRoot
    $beforeScripts = Get-CustomScripts -Profile $profile -Phase 'before'
    $afterScripts = Get-CustomScripts -Profile $profile -Phase 'after'
    $selectedIds = @(Get-SelectedSoftwareIds -AppsRoot $appsRoot -Profile $profile)

    if ($beforeScripts.Count -gt 0 -and (Test-Path -LiteralPath $scriptsRoot -PathType Container)) {
        foreach ($entry in $beforeScripts) {
            Invoke-CustomScript -ScriptsRoot $scriptsRoot -Entry $entry -Failures $failures
        }
    }
    elseif ($beforeScripts.Count -gt 0) {
        $message = "Custom scripts root not found: $scriptsRoot"
        Write-Host $message
        [void] $failures.Add($message)
    }

    if ($selectedIds.Count -eq 0) {
        Write-Host 'No client applications selected by deployment profile.'
    }

    foreach ($softwareId in $selectedIds) {
        Write-Host "Installing app: $softwareId"
        try {
            $script = Resolve-PackageScript -Root $appsRoot -PackageId $softwareId -ScriptName 'install.ps1' -Label 'app'
            & $script
            Write-Host "Completed app: $softwareId"
        }
        catch {
            $message = "Failed app ${softwareId}: $($_.Exception.Message)"
            Write-Host $message
            [void] $failures.Add($message)
        }
    }

    if ($afterScripts.Count -gt 0 -and (Test-Path -LiteralPath $scriptsRoot -PathType Container)) {
        foreach ($entry in $afterScripts) {
            Invoke-CustomScript -ScriptsRoot $scriptsRoot -Entry $entry -Failures $failures
        }
    }
    elseif ($afterScripts.Count -gt 0) {
        $message = "Custom scripts root not found: $scriptsRoot"
        Write-Host $message
        [void] $failures.Add($message)
    }

    if ($failures.Count -gt 0) {
        throw ($failures -join '; ')
    }
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
