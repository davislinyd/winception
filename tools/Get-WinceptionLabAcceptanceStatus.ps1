[CmdletBinding()]
param(
    [string] $EvidenceRoot,
    [string] $RunId,
    [ValidateRange(1, 3600)]
    [int] $IntervalSeconds = 15,
    [switch] $Follow
)

$ErrorActionPreference = 'Stop'
$webBase = 'http://127.0.0.1:8080'

function Get-LabMutexStatus {
    $mutex = [System.Threading.Mutex]::new($false, 'Global\Winception-AutoLab')
    try {
        $free = $mutex.WaitOne(0)
        if ($free) { $mutex.ReleaseMutex() | Out-Null }
        return [ordered]@{ free = [bool]$free }
    }
    finally { $mutex.Dispose() }
}

function Get-LabRunnerProcesses {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '^(powershell|pwsh)\.exe$' -and [string]$_.CommandLine -match 'Invoke-WinceptionLabRegression\.ps1'
    } | ForEach-Object {
        [ordered]@{
            pid = [int]$_.ProcessId
            parentPid = [int]$_.ParentProcessId
            startedAt = try { (Get-Process -Id $_.ProcessId -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o') } catch { $null }
        }
    })
}

function Get-LabVmStatus {
    try {
        @(Get-VM -Name 'winception-autolab*' -ErrorAction Stop | ForEach-Object {
            $firmware = Get-VMFirmware -VMName $_.Name -ErrorAction SilentlyContinue
            $security = Get-VMSecurity -VMName $_.Name -ErrorAction SilentlyContinue
            [ordered]@{
                name = [string]$_.Name
                state = [string]$_.State
                secureBoot = if ($firmware) { [string]$firmware.SecureBoot } else { $null }
                secureBootTemplate = if ($firmware) { [string]$firmware.SecureBootTemplate } else { $null }
                tpmEnabled = if ($security) { [bool]$security.TpmEnabled } else { $null }
                checkpoints = @(Get-VMSnapshot -VMName $_.Name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
            }
        })
    }
    catch {
        @([ordered]@{ error = 'Hyper-V inventory is unavailable to this session.' })
    }
}

function Get-LabEvidenceStatus {
    if ([string]::IsNullOrWhiteSpace($EvidenceRoot) -or -not (Test-Path -LiteralPath $EvidenceRoot -PathType Container)) {
        return [ordered]@{ root = $EvidenceRoot; exists = $false; files = @(); result = $null }
    }
    $result = $null
    $resultPath = Join-Path $EvidenceRoot 'result.json'
    if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
        try { $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json } catch { $result = [ordered]@{ error = 'Result JSON is not readable yet.' } }
    }
    [ordered]@{
        root = $EvidenceRoot
        exists = $true
        files = @(Get-ChildItem -LiteralPath $EvidenceRoot -File -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -ExpandProperty Name)
        result = $result
    }
}

function Get-LabAcceptanceSnapshot {
    $console = $null
    try { $console = (Invoke-RestMethod "$webBase/api/state" -TimeoutSec 30 -ErrorAction Stop).state }
    catch { $console = [ordered]@{ error = 'Console state is unavailable.' } }
    $selectedRun = $null
    if ($console -and $console.fleet -and $console.fleet.runs) {
        $selectedRun = @($console.fleet.runs | Where-Object {
            [string]::IsNullOrWhiteSpace($RunId) -or [string]$_.runId -eq $RunId
        } | Sort-Object startedAt -Descending | Select-Object -First 1)
        if ($selectedRun.Count -eq 1) { $selectedRun = $selectedRun[0] } else { $selectedRun = $null }
    }
    [ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString('o')
        mutex = Get-LabMutexStatus
        runnerProcesses = Get-LabRunnerProcesses
        console = if ($console.error) { $console } else { [ordered]@{
            operation = $console.operation
            services = $console.services
            fleetCounts = $console.fleet.counts
            selectedRun = $selectedRun
            profileId = $console.profile.activeProfile.id
            endpoint = [ordered]@{
                interfaceAlias = $console.config.adapter.interfaceAlias
                serverIp = $console.config.adapter.serverIp
                bootMode = $console.config.dhcp.bootMode
                dhcpMode = $console.config.dhcp.dhcpMode
            }
        }}
        vms = Get-LabVmStatus
        evidence = Get-LabEvidenceStatus
    }
}

do {
    Get-LabAcceptanceSnapshot | ConvertTo-Json -Depth 20
    if ($Follow) { Start-Sleep -Seconds $IntervalSeconds }
} while ($Follow)
