import { spawn } from 'node:child_process';

const altVirtualKeys = [0x12, 0xa4, 0xa5];

export function parseAltKeyWatcherLine(line) {
  const value = String(line ?? '').trim().toLowerCase();
  if (value === 'down') {
    return true;
  }
  if (value === 'up') {
    return false;
  }
  return null;
}

export function buildWindowsAltKeyWatcherScript({ intervalMs = 30 } = {}) {
  const keyChecks = altVirtualKeys
    .map((key) => `(([int][Win32.Keyboard]::GetAsyncKeyState(${key}) -band 0x8000) -ne 0)`)
    .join(' -or ');

  return `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win32 -Name Keyboard -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
'@

$lastDown = $false
while ($true) {
  $isDown = ${keyChecks}
  if ($isDown -ne $lastDown) {
    if ($isDown) {
      [Console]::Out.WriteLine('down')
    } else {
      [Console]::Out.WriteLine('up')
    }
    [Console]::Out.Flush()
    $lastDown = $isDown
  }
  Start-Sleep -Milliseconds ${Math.max(15, Number(intervalMs) || 30)}
}
`;
}

export function startWindowsAltKeyWatcher({ onChange, onError, intervalMs = 30 } = {}) {
  if (process.platform !== 'win32') {
    return { stop() {} };
  }

  const child = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      buildWindowsAltKeyWatcherScript({ intervalMs }),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  let stdoutBuffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const value = parseAltKeyWatcherLine(line);
      if (value !== null) {
        onChange?.(value);
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const message = String(chunk).trim();
    if (message) {
      onError?.(message);
    }
  });

  child.on('error', (error) => {
    onError?.(error.message);
  });

  return {
    stop() {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}
