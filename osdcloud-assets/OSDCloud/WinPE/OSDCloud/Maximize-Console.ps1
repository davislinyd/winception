$ErrorActionPreference = 'Stop'

$nativeMethodsType = 'OSDCloudWin32.StartnetConsole' -as [type]
if (-not $nativeMethodsType) {
    Add-Type -Namespace OSDCloudWin32 -Name StartnetConsole -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern System.IntPtr GetConsoleWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@
    $nativeMethodsType = 'OSDCloudWin32.StartnetConsole' -as [type]
}

$hwnd = $nativeMethodsType::GetConsoleWindow()
if ($hwnd -ne [System.IntPtr]::Zero) {
    [void] $nativeMethodsType::ShowWindow($hwnd, 3)
}
