[CmdletBinding()]
param([Parameter(Mandatory)][string]$StageRoot)
$ErrorActionPreference = 'Stop'
$stage = (Resolve-Path -LiteralPath $StageRoot).Path
$app = Join-Path $stage 'app'
$output = Join-Path $PSScriptRoot 'GeneratedFiles.wxs'

function Get-Id([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $hash = $algorithm.ComputeHash($bytes) }
  finally { $algorithm.Dispose() }
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  'F_' + $hex.Substring(0, 24).ToUpperInvariant()
}

function Get-RelativeFilePath([string]$Base, [string]$Path) {
  $baseUri = [Uri]($Base.TrimEnd('\') + '\')
  $pathUri = [Uri]$Path
  [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', '\')
}

$lines = [Collections.Generic.List[string]]::new()
$lines.Add('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">')
$directories = Get-ChildItem -LiteralPath $app -Recurse -Directory | Sort-Object { $_.FullName.Length }
$lines.Add('  <Fragment>')
foreach ($directory in $directories) {
  $relative = Get-RelativeFilePath $app $directory.FullName
  $parentRelative = Split-Path -Parent $relative
  $parentId = if ([string]::IsNullOrEmpty($parentRelative)) { 'APPFOLDER' } else { Get-Id $parentRelative }
  $directoryId = Get-Id $relative
  $directoryName = [Security.SecurityElement]::Escape($directory.Name)
  $lines.Add(('    <DirectoryRef Id="{0}">' -f $parentId))
  $lines.Add(('      <Directory Id="{0}" Name="{1}" />' -f $directoryId, $directoryName))
  $lines.Add('    </DirectoryRef>')
}
$lines.Add('  </Fragment>')
$lines.Add('  <Fragment>')
$lines.Add('    <ComponentGroup Id="AppPayload">')
foreach ($file in Get-ChildItem -LiteralPath $app -Recurse -File | Sort-Object FullName) {
  $relative = Get-RelativeFilePath $app $file.FullName
  $relativeDirectory = Split-Path -Parent $relative
  $directoryId = if ([string]::IsNullOrEmpty($relativeDirectory)) { 'APPFOLDER' } else { Get-Id $relativeDirectory }
  $id = Get-Id $relative
  $source = [Security.SecurityElement]::Escape($file.FullName)
  $name = [Security.SecurityElement]::Escape($file.Name)
  $lines.Add(('      <Component Id="C_{0}" Directory="{1}" Guid="*">' -f $id, $directoryId))
  $lines.Add(('        <File Id="{0}" Source="{1}" Name="{2}" KeyPath="yes" />' -f $id, $source, $name))
  $lines.Add('      </Component>')
}
$lines.Add('    </ComponentGroup>')
$lines.Add('  </Fragment>')
$lines.Add('</Wix>')
[IO.File]::WriteAllLines($output, $lines, [Text.UTF8Encoding]::new($false))
