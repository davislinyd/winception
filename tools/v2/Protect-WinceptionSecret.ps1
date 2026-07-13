[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Protect', 'Unprotect')]
    [string] $Mode,

    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9.-]{0,127}$')]
    [string] $Name
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plaintextOrCiphertext = [Console]::In.ReadToEnd()
if ([string]::IsNullOrEmpty($plaintextOrCiphertext)) {
    throw 'Secret input is empty.'
}

$entropySource = [System.Text.Encoding]::UTF8.GetBytes("Winception:v2:$Name")
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $entropy = $sha256.ComputeHash($entropySource)
}
finally {
    $sha256.Dispose()
}

if ($Mode -eq 'Protect') {
    $inputBytes = [System.Text.Encoding]::UTF8.GetBytes($plaintextOrCiphertext)
    $outputBytes = [System.Security.Cryptography.ProtectedData]::Protect(
        $inputBytes,
        $entropy,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    [Console]::Out.Write([Convert]::ToBase64String($outputBytes))
    exit 0
}

try {
    $inputBytes = [Convert]::FromBase64String($plaintextOrCiphertext)
}
catch {
    throw 'Protected secret is not valid base64.'
}
$outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $inputBytes,
    $entropy,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($outputBytes))
