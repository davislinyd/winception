[CmdletBinding()]
param(
    [string] $ArtifactBundle,
    [string] $RuntimeCatalogPath,
    [string] $ManifestPath,
    [string] $LiveRoot = 'C:\OSDCloud',
    [string] $InterfaceAlias = 'LAN',
    [string] $ServerIp = '192.168.88.1',
    [int] $PrefixLength = 24,
    [string] $ClientGateway,
    [switch] $ConfigureNic,
    [string] $NicDefaultGateway = '',
    [switch] $SkipTests,
    [switch] $SkipEndpointSync,
    [switch] $SkipPreflight,
    [switch] $SkipHostShareSetup,
    [switch] $NoLaunch,
    [switch] $SkipAdminCheck,
    [switch] $IncludeOptionalArtifacts,
    [switch] $SkipOsImageDownload,
    [switch] $SkipWinPeBuild,
    [switch] $NoAdkAutoInstall,
    [string] $SmbShareName = 'OSDCloudiPXE',
    [string] $SmbUserName = 'pxeinstall',
    [string] $SmbDomain = '',
    [switch] $SkipUserCreation
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $RepoRoot 'osdcloud-assets\manifest.json'
}
if ([string]::IsNullOrWhiteSpace($RuntimeCatalogPath)) {
    $RuntimeCatalogPath = Join-Path $RepoRoot 'config\runtime-artifacts.json'
}
if ([string]::IsNullOrWhiteSpace($ClientGateway)) {
    $ClientGateway = $ServerIp
}

function Write-Step {
    param([Parameter(Mandatory)][string] $Message)
    Write-Host ""
    Write-Host "== $Message =="
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Get-FullPath {
    param([Parameter(Mandatory)][string] $Path)
    [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Path,
        [string] $Label = 'path'
    )

    $rootFull = (Get-FullPath $Root).TrimEnd('\')
    $candidate = Get-FullPath $Path
    $rootWithSlash = "$rootFull\"
    if ($candidate -ne $rootFull -and -not $candidate.StartsWith($rootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes expected root. Root=$rootFull Path=$candidate"
    }
    $candidate
}

function Join-ChildPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $RelativePath,
        [string] $Label = 'path'
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "$Label must be relative: $RelativePath"
    }
    Assert-ChildPath -Root $Root -Path (Join-Path $Root $RelativePath) -Label $Label
}

function Get-RelativePathUnderRoot {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Path
    )

    $rootFull = (Get-FullPath $Root).TrimEnd('\')
    $pathFull = Get-FullPath $Path
    $rootWithSlash = "$rootFull\"
    if (-not $pathFull.StartsWith($rootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Artifact source is outside manifest sourceRoot. Root=$rootFull Source=$pathFull"
    }
    $pathFull.Substring($rootWithSlash.Length)
}

function Get-Sha256Hash {
    param([Parameter(Mandatory)][string] $LiteralPath)

    $resolvedPath = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).ProviderPath
    $hashCommand = Get-Command -Name Get-FileHash -ErrorAction SilentlyContinue
    if ($hashCommand) {
        return (& $hashCommand -LiteralPath $resolvedPath -Algorithm SHA256).Hash.ToUpperInvariant()
    }

    $stream = [System.IO.File]::OpenRead($resolvedPath)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return (-join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })).ToUpperInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-ArtifactMatches {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $Artifact,
        [Parameter(Mandatory)][string] $Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label missing: $Path"
    }
    if ($null -eq $Artifact.length) {
        throw "$Label has no expected length in manifest: $($Artifact.source)"
    }
    if ([string]::IsNullOrWhiteSpace([string] $Artifact.sha256)) {
        throw "$Label has no SHA-256 in manifest. Refresh osdcloud-assets with -HashLargeArtifacts."
    }

    $item = Get-Item -LiteralPath $Path
    $expectedLength = [int64] $Artifact.length
    if ($item.Length -ne $expectedLength) {
        throw "$Label size mismatch: $Path actual=$($item.Length) expected=$expectedLength"
    }

    $actualHash = Get-Sha256Hash -LiteralPath $Path
    $expectedHash = ([string] $Artifact.sha256).ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "$Label SHA-256 mismatch: $Path actual=$actualHash expected=$expectedHash"
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        return
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force
    }
}

function Resolve-ArtifactBundle {
    param([Parameter(Mandatory)][string] $Path)

    $fullPath = Get-FullPath $Path
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        if ([System.IO.Path]::GetExtension($fullPath) -ne '.zip') {
            throw "ArtifactBundle file must be a .zip: $fullPath"
        }
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("deployment-server-bundle-" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        Expand-Archive -LiteralPath $fullPath -DestinationPath $tempRoot -Force
        $bundleRoot = $tempRoot
        if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot 'OSDCloud') -PathType Container)) {
            $nested = Get-ChildItem -LiteralPath $tempRoot -Directory | Where-Object {
                Test-Path -LiteralPath (Join-Path $_.FullName 'OSDCloud') -PathType Container
            } | Select-Object -First 1
            if ($nested) {
                $bundleRoot = $nested.FullName
            }
        }
        return [pscustomobject]@{ Root = $bundleRoot; TempRoot = $tempRoot }
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        throw "ArtifactBundle not found: $fullPath"
    }
    [pscustomobject]@{ Root = $fullPath; TempRoot = $null }
}

function Read-Manifest {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Manifest not found: $Path"
    }
    Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Restore-VersionedAssets {
    param(
        [Parameter(Mandatory)][string] $AssetsRoot,
        [Parameter(Mandatory)][string] $TargetRoot
    )

    foreach ($folder in @('OSDCloud')) {
        $source = Join-Path $AssetsRoot $folder
        $target = if ($folder -eq 'OSDCloud') { $TargetRoot } else { Assert-ChildPath -Root $TargetRoot -Path (Join-Path $TargetRoot $folder) -Label 'live asset path' }
        Copy-DirectoryContents -Source $source -Destination $target
    }
}

function Restore-ExcludedArtifacts {
    param(
        [Parameter(Mandatory)] $Manifest,
        [Parameter(Mandatory)][string] $BundleRoot,
        [Parameter(Mandatory)][string] $TargetRoot
    )

    $bundleOsdRoot = Join-Path $BundleRoot 'OSDCloud'
    if (-not (Test-Path -LiteralPath $bundleOsdRoot -PathType Container)) {
        throw "Bundle must contain an OSDCloud folder: $bundleOsdRoot"
    }

    $sourceRoot = if ([string]::IsNullOrWhiteSpace([string] $Manifest.sourceRoot)) { 'C:\OSDCloud' } else { [string] $Manifest.sourceRoot }
    $missing = New-Object System.Collections.Generic.List[string]
    $artifacts = @($Manifest.excludedArtifacts)
    foreach ($artifact in $artifacts) {
        if (-not $artifact.exists) {
            $missing.Add([string] $artifact.source)
            continue
        }
        $relative = Get-RelativePathUnderRoot -Root $sourceRoot -Path ([string] $artifact.source)
        $bundleFile = Join-ChildPath -Root $bundleOsdRoot -RelativePath $relative -Label 'bundle artifact path'
        if (-not (Test-Path -LiteralPath $bundleFile -PathType Leaf)) {
            $missing.Add($relative)
        }
    }
    if ($missing.Count -gt 0) {
        throw "Artifact bundle is missing required excluded artifact(s):`n - $($missing -join "`n - ")"
    }

    $restored = 0
    foreach ($artifact in $artifacts) {
        $relative = Get-RelativePathUnderRoot -Root $sourceRoot -Path ([string] $artifact.source)
        $bundleFile = Join-ChildPath -Root $bundleOsdRoot -RelativePath $relative -Label 'bundle artifact path'
        Assert-ArtifactMatches -Path $bundleFile -Artifact $artifact -Label 'Bundle artifact'

        $targetFile = Join-ChildPath -Root $TargetRoot -RelativePath $relative -Label 'target artifact path'
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
        Copy-Item -LiteralPath $bundleFile -Destination $targetFile -Force
        Assert-ArtifactMatches -Path $targetFile -Artifact $artifact -Label 'Restored artifact'
        $restored += 1
    }
    $restored
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [string] $WorkingDirectory = $RepoRoot
    )

    Push-Location -LiteralPath $WorkingDirectory
    try {
        Write-Host "+ $FilePath $($ArgumentList -join ' ')"
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-PowerShellScript {
    param(
        [Parameter(Mandatory)][string] $ScriptPath,
        [string[]] $ArgumentList = @()
    )

    Invoke-ExternalCommand -FilePath 'powershell.exe' -ArgumentList (@(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $ScriptPath
    ) + $ArgumentList) -WorkingDirectory $RepoRoot
}

function Start-WebConsole {
    $webUrl = 'http://127.0.0.1:8080'
    $escapedRepo = $RepoRoot.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedRepo'; npm run web"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-NoExit',
        '-Command',
        $command
    )
    Start-Sleep -Seconds 2
    Start-Process $webUrl
}

function Get-RepoOnlyRestoreArgs {
    param([switch] $SkipPrerequisiteCheck)

    $restoreArgs = @(
        '-CatalogPath', $RuntimeCatalogPath,
        '-LiveRoot', $liveRootFull
    )
    if ($IncludeOptionalArtifacts) {
        $restoreArgs += '-IncludeOptional'
    }
    if ($SkipOsImageDownload) {
        $restoreArgs += '-SkipOsImageDownload'
    }
    if ($SkipWinPeBuild) {
        $restoreArgs += '-SkipWinPeBuild'
    }
    if ($NoAdkAutoInstall) {
        $restoreArgs += '-NoAdkAutoInstall'
    }
    if ($SkipPrerequisiteCheck) {
        $restoreArgs += '-SkipPrerequisiteCheck'
    }
    $restoreArgs
}

function Get-MissingEndpointRuntimeFiles {
    param([Parameter(Mandatory)][string] $Root)

    $ipxeLab = $Root
    $required = @(
        'Media\sources\boot.wim',
        'PXE-HttpRoot\osdcloud\boot.wim',
        'PXE-HttpRoot\osdcloud\boot.ipxe',
        'Config\Scripts\SetupComplete\SetupComplete.ps1',
        'Config\Scripts\SetupComplete\SetupComplete.cmd',
        'Config\Scripts\Shutdown\Invoke-DavisOobe.ps1'
    )
    @($required | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $ipxeLab $_) -PathType Leaf)
    })
}

function Get-DeploymentSecretValue {
    param(
        [Parameter(Mandatory)][string] $JsonName,
        [Parameter(Mandatory)][string] $EnvironmentName
    )

    $envValue = [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($envValue)) {
        return $envValue
    }

    $secretPath = Join-Path $RepoRoot 'config\osdcloud-secrets.json'
    if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
        throw "Missing local deployment secrets: $secretPath. Create it from config\osdcloud-secrets.example.json or set $EnvironmentName."
    }

    $secret = Get-Content -Raw -LiteralPath $secretPath | ConvertFrom-Json
    $value = [string] $secret.$JsonName
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Missing required deployment secret '$JsonName' in $secretPath or $EnvironmentName."
    }
    $value
}

function Set-FolderReadAccess {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $AccountName
    )

    $acl = Get-Acl -LiteralPath $Path
    $rights = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [System.Security.AccessControl.FileSystemRights]::Synchronize
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $AccountName,
        $rights,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Ensure-DeploymentSmbShare {
    $sharePath = Join-ChildPath -Root $liveRootFull -RelativePath 'Media' -Label 'SMB share path'
    if (-not (Test-Path -LiteralPath $sharePath -PathType Container)) {
        throw "SMB share path missing: $sharePath"
    }

    $password = Get-DeploymentSecretValue -JsonName 'pxeinstallPassword' -EnvironmentName 'OSDCLOUD_PXEINSTALL_PASSWORD'
    $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
    $localAccount = if (-not [string]::IsNullOrWhiteSpace($SmbDomain)) { "$SmbDomain\$SmbUserName" } else { "$env:COMPUTERNAME\$SmbUserName" }

    $skipUser = $SkipUserCreation -or (-not [string]::IsNullOrWhiteSpace($SmbDomain))
    if (-not $skipUser) {
        $user = Get-LocalUser -Name $SmbUserName -ErrorAction SilentlyContinue
        if ($user) {
            Set-LocalUser -Name $SmbUserName -Password $securePassword -PasswordNeverExpires $true
            Enable-LocalUser -Name $SmbUserName
        }
        else {
            New-LocalUser -Name $SmbUserName -Password $securePassword -Description 'OSDCloud WinPE SMB read-only account' -PasswordNeverExpires | Out-Null
        }
    } else {
        Write-Host "Skipping local SMB account creation (domain or skip user creation is configured)."
    }

    Set-FolderReadAccess -Path $sharePath -AccountName $localAccount

    $share = Get-SmbShare -Name $SmbShareName -ErrorAction SilentlyContinue
    if ($share -and -not ([string] $share.Path).Equals($sharePath, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-SmbShare -Name $SmbShareName -Force
        $share = $null
    }

    if (-not $share) {
        New-SmbShare -Name $SmbShareName -Path $sharePath -ReadAccess $localAccount -CachingMode None -FolderEnumerationMode AccessBased | Out-Null
    }
    else {
        $existingAccess = @(Get-SmbShareAccess -Name $SmbShareName -ErrorAction Stop | Where-Object {
            $_.AccountName -eq $localAccount -and
            $_.AccessControlType -eq 'Allow' -and
            $_.AccessRight -in @('Read', 'Change', 'Full')
        })
        if ($existingAccess.Count -eq 0) {
            Grant-SmbShareAccess -Name $SmbShareName -AccountName $localAccount -AccessRight Read -Force | Out-Null
        }
    }

    Write-Host "Prepared SMB share '$SmbShareName' at $sharePath for read-only account $localAccount."
}

function Repair-EndpointRuntimeIfMissing {
    if (-not [string]::IsNullOrWhiteSpace($ArtifactBundle)) {
        return
    }

    $missing = @(Get-MissingEndpointRuntimeFiles -Root $liveRootFull)
    if ($missing.Count -eq 0) {
        return
    }

    Write-Step "Refreshing runtime files required for endpoint sync"
    Write-Host "Missing endpoint runtime file(s):"
    foreach ($item in $missing) {
        Write-Host " - $item"
    }
    Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Restore-DeploymentArtifacts.ps1') -ArgumentList (Get-RepoOnlyRestoreArgs -SkipPrerequisiteCheck)

    $remaining = @(Get-MissingEndpointRuntimeFiles -Root $liveRootFull)
    if ($remaining.Count -gt 0) {
        throw "Endpoint runtime remains incomplete after restore:`n - $($remaining -join "`n - ")"
    }
}

try {
    if (-not $SkipAdminCheck -and -not (Test-IsAdministrator)) {
        throw "Run this bootstrap from an elevated PowerShell session or use Deploy-DeploymentServer.cmd."
    }

    $liveRootFull = Get-FullPath $LiveRoot
    if ($liveRootFull -ne 'C:\OSDCloud' -and -not $SkipEndpointSync) {
        throw "-LiveRoot outside C:\OSDCloud is only supported with -SkipEndpointSync."
    }
    if ($liveRootFull -ne 'C:\OSDCloud' -and -not $SkipPreflight) {
        throw "-LiveRoot outside C:\OSDCloud is only supported with -SkipPreflight."
    }
    if ($liveRootFull -ne 'C:\OSDCloud' -and -not $NoLaunch) {
        throw "-LiveRoot outside C:\OSDCloud is only supported with -NoLaunch."
    }

    if ([string]::IsNullOrWhiteSpace($ArtifactBundle)) {
        Write-Step "Rebuilding C:\OSDCloud runtime from repo artifact catalog"
        Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Restore-DeploymentArtifacts.ps1') -ArgumentList (Get-RepoOnlyRestoreArgs)
    }
    else {
        Write-Step "Loading manifest and legacy artifact bundle"
        $manifest = Read-Manifest -Path $ManifestPath
        $bundle = Resolve-ArtifactBundle -Path $ArtifactBundle

        try {
            Write-Step "Restoring C:\OSDCloud runtime from legacy bundle"
            New-Item -ItemType Directory -Path $liveRootFull -Force | Out-Null
            Restore-VersionedAssets -AssetsRoot (Join-Path $RepoRoot 'osdcloud-assets') -TargetRoot $liveRootFull
            $restored = Restore-ExcludedArtifacts -Manifest $manifest -BundleRoot $bundle.Root -TargetRoot $liveRootFull
            Write-Host "Restored and verified $restored excluded artifact(s)."
        }
        finally {
            if ($bundle.TempRoot) {
                Remove-Item -LiteralPath $bundle.TempRoot -Recurse -Force
            }
        }
    }

    if (-not $SkipTests) {
        Write-Step "Installing repo dependencies and running validation"
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('install')
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('test')
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('run', 'smoke')
    }

    if ($ConfigureNic) {
        Write-Step "Configuring Windows service NIC"
        $nicArgs = @(
            '-InterfaceAlias', $InterfaceAlias,
            '-ServerIp', $ServerIp,
            '-PrefixLength', [string] $PrefixLength,
            '-InterfaceMetric', '500'
        )
        if (-not [string]::IsNullOrWhiteSpace($NicDefaultGateway)) {
            $nicArgs += @('-DefaultGateway', $NicDefaultGateway)
        }
        Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Set-IpxePhysicalNic.ps1') -ArgumentList $nicArgs
    }

    if (-not $SkipHostShareSetup) {
        Write-Step "Preparing host SMB share"
        Ensure-DeploymentSmbShare
    }

    if (-not $SkipEndpointSync) {
        Repair-EndpointRuntimeIfMissing

        Write-Step "Syncing deployment endpoint"
        Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Set-OsdCloudIpxeEndpoint.ps1') -ArgumentList @(
            '-ConfigPath', (Join-Path $RepoRoot 'config\osdcloud-console.json'),
            '-InterfaceAlias', $InterfaceAlias,
            '-ServerIp', $ServerIp,
            '-PrefixLength', [string] $PrefixLength,
            '-DefaultGateway', $ClientGateway,
            '-CommitWinPe'
        )
    }

    if (-not $SkipPreflight) {
        Write-Step "Running server preflight"
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('run', 'server:preflight')
    }

    if (-not $NoLaunch) {
        Write-Step "Starting Web console"
        Start-WebConsole
    }

    Write-Step "Deployment server bootstrap completed"
    Write-Host "Web console: http://127.0.0.1:8080"
    Write-Host "Deployment services are not started automatically. Start them from the Web console after confirming the real LAN DHCP server is disabled."
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
