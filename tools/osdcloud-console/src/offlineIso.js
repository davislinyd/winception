import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { appRootForConfig, runtimeRootForConfig, stateRootForConfig } from './config.js';
import { collectProcessOutput, preparePowerShellArgs } from './processOutput.js';
import { powershellExe } from './windows/shared.js';

const offlineIsoNamePattern = /^Winception-USB-.*\.iso$/iu;

export function offlineIsoScriptPath(config = {}) {
  return path.join(appRootForConfig(config), 'tools', 'New-WinceptionUsbInstaller.ps1');
}

export function offlineIsoConfigPath(config = {}) {
  if (config.__configPath) {
    return path.resolve(config.__configPath);
  }
  return path.join(stateRootForConfig(config), 'config', 'osdcloud-console.json');
}

export function offlineIsoOutputDirectory(config = {}) {
  return path.join(runtimeRootForConfig(config), 'Exports');
}

export function buildOfflineIsoPowerShellArgs(config = {}) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    offlineIsoScriptPath(config),
    '-Iso',
    '-ConfigPath',
    offlineIsoConfigPath(config),
  ];
}

export function parseOfflineIsoOutputPath(text) {
  const source = String(text ?? '');
  const createdMatch = source.match(/Created and verified ISO:\s*(.+)$/imu);
  if (createdMatch?.[1]) {
    return createdMatch[1].trim();
  }
  const preflightMatch = source.match(/ISO output\s*:\s*(.+)$/imu);
  if (preflightMatch?.[1]) {
    return preflightMatch[1].trim();
  }
  return null;
}

export function findLatestOfflineIso(outputDirectory, options = {}) {
  const startedAt = options.startedAt instanceof Date
    ? options.startedAt.getTime()
    : Number(options.startedAt ?? 0);
  const fsModule = options.fsModule ?? fs;
  if (!fsModule.existsSync(outputDirectory)) {
    return null;
  }
  const candidates = fsModule.readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && offlineIsoNamePattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(outputDirectory, entry.name);
      const stat = fsModule.statSync(fullPath);
      return { fullPath, stat };
    })
    .filter((entry) => entry.stat.isFile() && entry.stat.mtimeMs >= startedAt)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  return candidates[0]?.fullPath ?? null;
}

export function resolveOfflineIsoResultPath(text, config = {}, options = {}) {
  const parsedPath = parseOfflineIsoOutputPath(text);
  if (parsedPath) {
    return path.resolve(parsedPath);
  }
  return findLatestOfflineIso(options.outputDirectory ?? offlineIsoOutputDirectory(config), options);
}

export async function createOfflineIso(config = {}, options = {}) {
  const fsModule = options.fsModule ?? fs;
  const scriptPath = offlineIsoScriptPath(config);
  const configPath = offlineIsoConfigPath(config);
  const outputDirectory = options.outputDirectory ?? offlineIsoOutputDirectory(config);
  const startedAt = options.startedAt ?? new Date();
  if (!fsModule.existsSync(scriptPath) || !fsModule.statSync(scriptPath).isFile()) {
    throw new Error(`Offline ISO exporter script not found: ${scriptPath}`);
  }
  if (!fsModule.existsSync(configPath) || !fsModule.statSync(configPath).isFile()) {
    throw new Error(`Offline ISO config not found: ${configPath}`);
  }

  const child = (options.spawnFn ?? spawn)(
    powershellExe(),
    preparePowerShellArgs(buildOfflineIsoPowerShellArgs(config)),
    {
      cwd: appRootForConfig(config),
      windowsHide: true,
    },
  );
  const result = await collectProcessOutput(child, {
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `PowerShell exited with code ${result.code}`;
    const error = new Error(detail);
    error.code = result.code;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }

  const outputPath = resolveOfflineIsoResultPath(`${result.stdout}\n${result.stderr}`, config, {
    startedAt,
    outputDirectory,
    fsModule,
  });
  if (!outputPath) {
    throw new Error(`Offline ISO export completed but no ISO file was found under ${outputDirectory}`);
  }
  const stat = fsModule.statSync(outputPath);
  if (!stat.isFile()) {
    throw new Error(`Offline ISO export path is not a file: ${outputPath}`);
  }
  return {
    outputPath,
    outputDirectory: path.dirname(outputPath),
    fileName: path.basename(outputPath),
    bytes: stat.size,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
