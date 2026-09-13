import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

test('client progress replacement retries sharing violations, remains bounded, and preserves other errors', () => {
  const paths = [
    'Softwares/Install-Apps.ps1',
    'osdcloud-assets/OSDCloud/Media/OSDCloud/Apps/Install-Apps.ps1',
    'osdcloud-assets/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1',
    'osdcloud-assets/OSDCloud/WinPE/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1',
  ].map(p => `'${path.join(process.cwd(), p).replaceAll("'", "''")}'`).join(',');
  const command = `
    $ErrorActionPreference='Stop'
    function Write-Utf8File { param($Path,$Content) [IO.File]::WriteAllText($Path,$Content,[Text.UTF8Encoding]::new($false)) }
    $root=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($root)
    try {
      foreach($source in @(${paths})) {
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
        $definition=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Write-JsonFileAtomic'},$false)[0]
        Invoke-Expression $definition.Extent.Text
        $target=Join-Path $root 'progress.json'
        [IO.File]::WriteAllText($target,'{}')
        $script:held=[IO.File]::Open($target,'Open','Read','Read')
        $script:waits=0
        function Start-Sleep { param($Milliseconds) $script:waits++; $script:held.Dispose() }
        Write-JsonFileAtomic -Path $target -Value @{status='succeeded'}
        if($script:waits -ne 1 -or (Get-Content $target -Raw | ConvertFrom-Json).status -ne 'succeeded'){throw 'Transient lock was not retried atomically.'}
        $script:held=[IO.File]::Open($target,'Open','Read','Read')
        $script:waits=0
        function Start-Sleep { param($Milliseconds) $script:waits++ }
        $failed=$false
        try { Write-JsonFileAtomic -Path $target -Value @{status='failed'} } catch { $failed=$true }
        $script:held.Dispose()
        if(-not $failed -or $script:waits -ne 19){throw 'Persistent lock was not bounded.'}
        [IO.File]::SetAttributes($target,[IO.FileAttributes]::ReadOnly)
        $script:waits=0; $failed=$false
        try { Write-JsonFileAtomic -Path $target -Value @{} } catch { $failed=$true }
        [IO.File]::SetAttributes($target,[IO.FileAttributes]::Normal)
        if(-not $failed -or $script:waits -ne 0){throw 'Permission failure was retried.'}
      }
    } finally { if($script:held){$script:held.Dispose()}; Remove-Item -LiteralPath $root -Recurse -Force }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('finalizer rejects failed or missing progress even with a zero installer exit', () => {
  const source = path.join(process.cwd(), 'osdcloud-assets/OSDCloud/WinPE/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop'
    $tokens=$null; $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile('${source}',[ref]$tokens,[ref]$errors)
    Invoke-Expression ($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-ClientAppInstallers'},$false)[0].Extent.Text)
    $LogDir=[IO.Path]::GetTempPath(); $DeploymentProgressPath='progress'; $env:WINDIR='C:\\Windows'
    function Test-Path { param($LiteralPath,$PathType) return $true }
    function Remove-Item { param($LiteralPath,[switch]$Force,$ErrorAction) }
    function Send-DeploymentStatus { param($Stage,$Message,$Percent,$Extra) if($Stage -eq 'windows-apps-finished'){throw 'Incorrect completion reported.'} }
    function Get-TextFileTailText { param($Path,$Count) return '' }
    function Get-InstallSequenceFailureDetails { param($LogRoot) return @{} }
    function Get-JsonFileObject { param($Path) return $script:progress }
    function Start-Process { param($FilePath,$ArgumentList,[switch]$PassThru,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError)
      $p=[pscustomobject]@{ExitCode=$script:exitCode}
      $p | Add-Member ScriptMethod WaitForExit {param($ms) return $true}
      $p | Add-Member ScriptMethod Refresh {}
      return $p
    }
    foreach($exitCode in @(0,$null)) { foreach($state in @('failed','missing')) {
      $script:progress=if($state -eq 'failed'){[pscustomobject]@{status='failed'}}else{$null}
      $failed=$false
      try { Invoke-ClientAppInstallers | Out-Null } catch { $failed=$true }
      if(-not $failed){throw 'Incomplete installer was accepted.'}
    } }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
