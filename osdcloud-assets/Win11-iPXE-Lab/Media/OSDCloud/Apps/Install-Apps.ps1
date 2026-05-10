$ErrorActionPreference = 'Stop'

$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'apps-install.log') -Append -ErrorAction SilentlyContinue | Out-Null

try {
    $appsRoot = $PSScriptRoot
    $failures = @()
    $installers = @(Get-ChildItem -LiteralPath $appsRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object {
            $script = Join-Path $_.FullName 'install.ps1'
            if (Test-Path -LiteralPath $script -PathType Leaf) {
                [pscustomobject]@{
                    Name = $_.Name
                    Script = $script
                }
            }
        })

    foreach ($installer in $installers) {
        Write-Host "Installing app: $($installer.Name)"
        try {
            & $installer.Script
            Write-Host "Completed app: $($installer.Name)"
        }
        catch {
            $message = "Failed app: $($installer.Name): $($_.Exception.Message)"
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
