$ErrorActionPreference = 'Stop'

$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'apps-install.log') -Append -ErrorAction SilentlyContinue | Out-Null

function Test-SafeSoftwareId {
    param([Parameter(Mandatory)][string] $Id)
    return $Id -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
}

function Resolve-AppScript {
    param(
        [Parameter(Mandatory)][string] $AppsRoot,
        [Parameter(Mandatory)][string] $SoftwareId
    )

    if (-not (Test-SafeSoftwareId -Id $SoftwareId)) {
        throw "Unsafe software id in selected profile: $SoftwareId"
    }

    $rootFullPath = [System.IO.Path]::GetFullPath($AppsRoot).TrimEnd('\')
    $appRoot = [System.IO.Path]::GetFullPath((Join-Path $rootFullPath $SoftwareId))
    $rootPrefix = "$rootFullPath\"
    if (-not $appRoot.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Software path escapes Apps root: $SoftwareId"
    }

    $script = Join-Path $appRoot 'install.ps1'
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
        throw "Selected software installer not found: $SoftwareId ($script)"
    }

    return $script
}

function Get-SelectedSoftwareIds {
    param([Parameter(Mandatory)][string] $AppsRoot)

    $profilePath = Join-Path $AppsRoot 'selected-profile.json'
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
        Write-Host "selected-profile.json not found; installing all app folders for backward compatibility."
        return @(Get-ChildItem -LiteralPath $AppsRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name |
            ForEach-Object { $_.Name })
    }

    $profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
    $ids = @()
    if ($profile.selectedSoftware) {
        $ids = @($profile.selectedSoftware)
    }
    elseif ($profile.software) {
        $ids = @($profile.software | ForEach-Object {
            if ($_.id) { $_.id } else { $_ }
        })
    }

    return @($ids | ForEach-Object { [string] $_ })
}

try {
    $appsRoot = $PSScriptRoot
    $failures = @()
    $selectedIds = @(Get-SelectedSoftwareIds -AppsRoot $appsRoot)

    if ($selectedIds.Count -eq 0) {
        Write-Host 'No client applications selected by deployment profile.'
    }

    foreach ($softwareId in $selectedIds) {
        Write-Host "Installing app: $softwareId"
        try {
            $script = Resolve-AppScript -AppsRoot $appsRoot -SoftwareId $softwareId
            & $script
            Write-Host "Completed app: $softwareId"
        }
        catch {
            $message = "Failed app: ${softwareId}: $($_.Exception.Message)"
            Write-Host $message
            $failures += $message
        }
    }

    if ($failures.Count -gt 0) {
        throw ($failures -join '; ')
    }
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
