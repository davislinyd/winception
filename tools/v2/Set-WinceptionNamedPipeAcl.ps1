[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PipePath,
  [string]$WebServiceName = 'Winception.Web'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PipePath -notmatch '^\\\\\.\\pipe\\ProtectedPrefix\\Administrators\\[A-Za-z0-9._-]+$') { throw 'The Agent pipe path is outside the protected Winception namespace.' }
if ($WebServiceName -notmatch '^[A-Za-z0-9._-]+$') { throw 'The Web service name is invalid.' }

if (-not ('WinceptionPipeSecurity.NativeMethods' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace WinceptionPipeSecurity {
  public static class NativeMethods {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetKernelObjectSecurity(IntPtr handle, int securityInformation, byte[] securityDescriptor);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetKernelObjectSecurity(IntPtr handle, int securityInformation, byte[] securityDescriptor, uint length, out uint required);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
  }
}
'@
}

$serviceAccount = [Security.Principal.NTAccount]::new("NT SERVICE\$WebServiceName")
$serviceSid = $serviceAccount.Translate([Security.Principal.SecurityIdentifier]).Value
$sddl = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;$serviceSid)"
$descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($sddl)
$binary = [byte[]]::new($descriptor.BinaryLength)
$descriptor.GetBinaryForm($binary, 0)

$readControl = [uint32]0x00020000
$writeDac = [uint32]0x00040000
$openExisting = [uint32]3
$handle = [WinceptionPipeSecurity.NativeMethods]::CreateFile($PipePath, ($readControl -bor $writeDac), 3, [IntPtr]::Zero, $openExisting, 0, [IntPtr]::Zero)
if ($handle -eq [IntPtr](-1)) { throw "Unable to open the Agent pipe for ACL configuration. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
  if (-not [WinceptionPipeSecurity.NativeMethods]::SetKernelObjectSecurity($handle, 4, $binary)) {
    throw "Unable to apply the Agent pipe DACL. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  [uint32]$required = 0
  [void][WinceptionPipeSecurity.NativeMethods]::GetKernelObjectSecurity($handle, 4, $null, 0, [ref]$required)
  if ($required -eq 0) { throw "Unable to size the applied Agent pipe DACL. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $appliedBinary = [byte[]]::new($required)
  if (-not [WinceptionPipeSecurity.NativeMethods]::GetKernelObjectSecurity($handle, 4, $appliedBinary, $required, [ref]$required)) {
    throw "Unable to read the applied Agent pipe DACL. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $applied = [Security.AccessControl.RawSecurityDescriptor]::new($appliedBinary, 0)
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administratorsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $serviceSecuritySid = [Security.Principal.SecurityIdentifier]::new($serviceSid)
  $expected = @($systemSid.Value, $administratorsSid.Value, $serviceSecuritySid.Value)
  $aces = @($applied.DiscretionaryAcl | ForEach-Object { $_ })
  $actual = @($aces | ForEach-Object { $_.SecurityIdentifier.Value })
  $protected = ($applied.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
  $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
  $broadAccess = @($actual | Where-Object { $broadSids -contains $_ }).Count -gt 0
  $exactPrincipals = $aces.Count -eq 3 -and @($actual | Where-Object { $expected -notcontains $_ }).Count -eq 0 -and @($expected | Where-Object { $actual -notcontains $_ }).Count -eq 0
  if (-not $protected -or $broadAccess -or -not $exactPrincipals) { throw 'The applied Agent pipe DACL did not match the required service boundary.' }
}
finally {
  [void][WinceptionPipeSecurity.NativeMethods]::CloseHandle($handle)
}

[pscustomobject]@{ serviceSid = $serviceSid; protectedDacl = $protected; broadAccess = $broadAccess } | ConvertTo-Json -Compress
