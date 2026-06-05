param(
    [string] $Root = 'C:\OSDCloud\Media',
    [string] $Prefix = 'http://192.168.88.1:8088/',
    [string] $LogPath = 'C:\OSDCloud\PXE-HttpRoot\host-http.log'
)

$ErrorActionPreference = 'Stop'

function Write-AccessLog([string] $Message) {
    "$(Get-Date -Format o) $Message" | Add-Content -LiteralPath $LogPath -Encoding ASCII
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($Prefix)
$listener.Start()
Write-Host "Serving $Root at $Prefix"
Write-AccessLog "START root=$Root prefix=$Prefix"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($relative)) {
                $relative = 'index.txt'
            }

            $candidate = Join-Path $Root $relative
            $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
            $resolvedFile = [System.IO.Path]::GetFullPath($candidate)

            if (-not $resolvedFile.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolvedFile -PathType Leaf)) {
                $context.Response.StatusCode = 404
                $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found: $relative")
                if ($context.Request.HttpMethod -ne 'HEAD') {
                    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
                Write-AccessLog "$($context.Request.RemoteEndPoint) $($context.Request.HttpMethod) /$relative 404 bytes=$($bytes.Length)"
                continue
            }

            $file = Get-Item -LiteralPath $resolvedFile
            $context.Response.StatusCode = 200
            $context.Response.ContentLength64 = $file.Length
            $context.Response.ContentType = 'application/octet-stream'
            if ($context.Request.HttpMethod -eq 'HEAD') {
                Write-AccessLog "$($context.Request.RemoteEndPoint) HEAD /$relative 200 bytes=$($file.Length)"
                continue
            }

            $buffer = New-Object byte[] 1048576
            $stream = [System.IO.File]::OpenRead($resolvedFile)
            try {
                while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $context.Response.OutputStream.Write($buffer, 0, $read)
                }
            }
            finally {
                $stream.Dispose()
            }
            Write-AccessLog "$($context.Request.RemoteEndPoint) $($context.Request.HttpMethod) /$relative 200 bytes=$($file.Length)"
        }
        catch {
            $context.Response.StatusCode = 500
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-AccessLog "$($context.Request.RemoteEndPoint) $($context.Request.HttpMethod) $($context.Request.Url.AbsolutePath) 500 bytes=$($bytes.Length)"
        }
        finally {
            $context.Response.OutputStream.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
