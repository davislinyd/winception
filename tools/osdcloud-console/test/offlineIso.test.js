import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  buildOfflineIsoPowerShellArgs,
  createOfflineIso,
  findLatestOfflineIso,
  offlineIsoConfigPath,
  offlineIsoOutputDirectory,
  offlineIsoScriptPath,
  parseOfflineIsoOutputPath,
} from '../src/offlineIso.js';

function makeConfig(root) {
  return {
    __configPath: path.join(root, 'State', 'config', 'osdcloud-console.json'),
    paths: {
      appRoot: path.join(root, 'HostTools', 'App'),
      stateRoot: path.join(root, 'State'),
      osdCloudRoot: path.join(root, 'Runtime'),
    },
    runtimeArtifacts: {
      liveRoot: path.join(root, 'Runtime'),
    },
  };
}

function makeFakeChild({ code = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  process.nextTick(() => {
    if (stdout) {
      child.stdout.write(stdout);
    }
    child.stdout.end();
    if (stderr) {
      child.stderr.write(stderr);
    }
    child.stderr.end();
    child.emit('close', code);
  });
  return child;
}

test('offline ISO helper resolves installed script path, config path, and PowerShell args', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-offline-iso-paths-'));
  try {
    const config = makeConfig(root);
    assert.equal(offlineIsoScriptPath(config), path.join(root, 'HostTools', 'App', 'tools', 'New-WinceptionUsbInstaller.ps1'));
    assert.equal(offlineIsoConfigPath(config), path.join(root, 'State', 'config', 'osdcloud-console.json'));
    assert.equal(offlineIsoOutputDirectory(config), path.join(root, 'Runtime', 'Exports'));
    assert.deepEqual(buildOfflineIsoPowerShellArgs(config), [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'HostTools', 'App', 'tools', 'New-WinceptionUsbInstaller.ps1'),
      '-Iso',
      '-ConfigPath',
      path.join(root, 'State', 'config', 'osdcloud-console.json'),
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('offline ISO helper parses created and preflight output paths', () => {
  assert.equal(
    parseOfflineIsoOutputPath('Created and verified ISO: C:\\OSDCloud\\Exports\\Winception-USB-20260710-090000.iso'),
    'C:\\OSDCloud\\Exports\\Winception-USB-20260710-090000.iso',
  );
  assert.equal(
    parseOfflineIsoOutputPath('ISO output      : D:\\Exports\\Winception-USB-20260710-090000.iso'),
    'D:\\Exports\\Winception-USB-20260710-090000.iso',
  );
  assert.equal(parseOfflineIsoOutputPath('No ISO path here'), null);
});

test('offline ISO helper falls back to the newest export created after the job start', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-offline-iso-fallback-'));
  try {
    const outputDirectory = path.join(root, 'Exports');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const older = path.join(outputDirectory, 'Winception-USB-20260710-010000.iso');
    const newer = path.join(outputDirectory, 'Winception-USB-20260710-020000.iso');
    fs.writeFileSync(older, 'old', 'utf8');
    fs.writeFileSync(newer, 'new', 'utf8');
    const startedAt = Date.now() - 2_000;
    const oldTime = new Date(startedAt - 10_000);
    const newTime = new Date(startedAt + 2_000);
    fs.utimesSync(older, oldTime, oldTime);
    fs.utimesSync(newer, newTime, newTime);
    assert.equal(findLatestOfflineIso(outputDirectory, { startedAt }), newer);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('offline ISO helper returns parsed host path and file metadata on success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-offline-iso-success-'));
  try {
    const config = makeConfig(root);
    const scriptPath = offlineIsoScriptPath(config);
    const configPath = offlineIsoConfigPath(config);
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(scriptPath, '# script', 'utf8');
    fs.writeFileSync(configPath, '{}', 'utf8');
    const isoPath = path.join(offlineIsoOutputDirectory(config), 'Winception-USB-20260710-090000.iso');
    fs.mkdirSync(path.dirname(isoPath), { recursive: true });
    fs.writeFileSync(isoPath, 'iso-bytes', 'utf8');

    const result = await createOfflineIso(config, {
      spawnFn: () => makeFakeChild({
        stdout: `Created and verified ISO: ${isoPath}\n`,
      }),
    });

    assert.equal(result.outputPath, isoPath);
    assert.equal(result.outputDirectory, path.dirname(isoPath));
    assert.equal(result.fileName, path.basename(isoPath));
    assert.equal(result.bytes, Buffer.byteLength('iso-bytes'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('offline ISO helper surfaces PowerShell failure output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-offline-iso-fail-'));
  try {
    const config = makeConfig(root);
    const scriptPath = offlineIsoScriptPath(config);
    const configPath = offlineIsoConfigPath(config);
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(scriptPath, '# script', 'utf8');
    fs.writeFileSync(configPath, '{}', 'utf8');

    await assert.rejects(
      createOfflineIso(config, {
        spawnFn: () => makeFakeChild({ code: 1, stderr: 'oscdimg failed' }),
      }),
      /oscdimg failed/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
