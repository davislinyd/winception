import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeDiagnosticsBundle } from '../src/diagnostics/bundle.js';
import { collectDiagnosticsContext } from '../src/diagnostics/collectors.js';
import { redactJson, redactText } from '../src/diagnostics/redact.js';
import { buildDiagnosticsChecks, summarizeDiagnostics } from '../src/diagnostics/rules.js';
import { runCategoryForStage } from '../src/diagnostics/shared.js';

test('diagnostics redaction removes deployment secrets and token-like values', () => {
  const json = redactJson({
    windowsPassword: 'secret-1',
    nested: {
      pxeinstallPassword: 'secret-2',
      authHeader: 'Bearer abcdefghijklmnopqrstuvwxyz012345',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ3aW5jZXB0aW9uIn0.signaturevalue123456',
    },
  });
  const text = redactText('windowsPassword=secret-1 token: abcdefghijklmnopqrstuvwxyz012345 Bearer abcdefghijklmnopqrstuvwxyz012345');

  assert.equal(json.windowsPassword, 'REDACTED');
  assert.equal(json.nested.pxeinstallPassword, 'REDACTED');
  assert.equal(json.nested.authHeader, 'Bearer REDACTED');
  assert.equal(json.nested.jwt, 'REDACTED');
  assert.match(text, /windowsPassword=REDACTED/);
  assert.match(text, /token: REDACTED/);
  assert.match(text, /Bearer REDACTED/);
  assert.doesNotMatch(text, /secret-1|abcdefghijklmnopqrstuvwxyz012345/);
});

test('run stage mapping classifies winpe, setupcomplete, and desktop-ready phases', () => {
  assert.equal(runCategoryForStage('winpe-osdcloud-start'), 'winpe-run');
  assert.equal(runCategoryForStage('windows-setupcomplete-error'), 'setupcomplete-run');
  assert.equal(runCategoryForStage('windows-desktop-timeout'), 'desktop-ready-run');
});

test('diagnostics rules classify host catalog failures and run terminal stage', () => {
  const context = {
    generatedAt: '2026-07-08T00:00:00.000Z',
    trigger: 'manual',
    scope: 'run',
    host: {
      workspace: {
        appRoot: 'C:\\OSDCloud\\HostTools\\App',
        stateRoot: 'C:\\OSDCloud\\HostTools\\State',
        runtimeRoot: 'C:\\OSDCloud',
      },
      web: { host: '127.0.0.1', port: 8080 },
      nodeVersion: process.version,
      npmVersion: { ok: true, value: '10.8.2' },
      moduleProbe: {
        powershellVersion: '5.1.22621.1',
        modules: { OSD: [{ version: '25.7.7.1' }], OSDCloud: [{ version: '25.7.7.2' }] },
        imports: { OSD: { ok: true }, OSDCloud: { ok: true } },
        catalog: { ok: false, error: 'Invoke-WebRequest failed' },
      },
      runtime: { ready: true, readyCount: 5, requiredCount: 5, missing: [] },
      endpoint: { ready: true, detail: 'Endpoint is synced.' },
      osImageStatus: { ready: true, detail: 'OS image is deployable.' },
      profileStatus: { ready: true, detail: 'Profile payload is published.' },
      preflight: [{ name: 'TCP 80', ok: true, detail: 'Free' }],
    },
    run: {
      run: {
        runId: 'run-1',
        clientId: 'client-1',
        status: 'failed',
        latestStage: 'windows-desktop-timeout',
        latestMessage: 'Desktop ready callback timed out.',
      },
      latestStage: 'windows-desktop-timeout',
      category: runCategoryForStage('windows-desktop-timeout'),
      summary: { latestMessage: 'Desktop ready callback timed out.' },
    },
  };

  const checks = buildDiagnosticsChecks(context);
  const summary = summarizeDiagnostics(context, checks);

  assert.equal(checks.find((item) => item.id === 'os-catalog').status, 'fail');
  assert.equal(checks.find((item) => item.id === 'desktop-ready-run').status, 'fail');
  assert.equal(summary.overallStatus, 'fail');
  assert.match(summary.headline, /OS download catalog probe|Deployment run run-1/);
});

test('diagnostics bundle writes stable summary, checks, and artifact folders', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-diagnostics-bundle-'));
  try {
    const config = { paths: { stateRoot: root } };
    const sourceTextPath = path.join(root, 'source.log');
    fs.writeFileSync(sourceTextPath, 'token=abc123456789012345\n', 'utf8');

    const result = await writeDiagnosticsBundle(config, {
      generatedAt: '2026-07-08T00:00:00.000Z',
      trigger: 'manual',
      summary: {
        generatedAt: '2026-07-08T00:00:00.000Z',
        trigger: 'manual',
        scope: 'host',
        overallStatus: 'fail',
        headline: 'OS download catalog probe',
        probableCause: 'Invoke-WebRequest failed',
        recommendedAction: 'Repair OSD modules.',
      },
      checks: [{
        id: 'os-catalog',
        category: 'os-catalog',
        phase: 'host-init',
        status: 'fail',
        title: 'OS download catalog probe',
        detail: 'Invoke-WebRequest failed',
        evidence: [],
        remediation: 'Repair OSD modules.',
      }],
      artifacts: [
        {
          label: 'Host overview',
          relativePath: 'artifacts/host/overview.json',
          kind: 'json',
          content: { ok: true },
          redacted: true,
        },
        {
          label: 'Host log',
          relativePath: 'artifacts/host/host.log.txt',
          kind: 'text',
          sourcePath: sourceTextPath,
          redacted: true,
        },
      ],
    }, { compress: false });

    assert.match(result.bundleName, /manual-fail\.zip$/);
    assert.ok(fs.existsSync(path.join(result.bundlePath, 'summary.json')));
    assert.ok(fs.existsSync(path.join(result.bundlePath, 'checks.json')));
    assert.ok(fs.existsSync(path.join(result.bundlePath, 'artifacts', 'host', 'overview.json')));
    assert.ok(fs.existsSync(path.join(result.bundlePath, 'artifacts', 'host', 'host.log.txt')));
    assert.ok(fs.existsSync(path.join(root, 'diagnostics', 'latest.json')));

    const summary = JSON.parse(fs.readFileSync(path.join(result.bundlePath, 'summary.json'), 'utf8'));
    const logText = fs.readFileSync(path.join(result.bundlePath, 'artifacts', 'host', 'host.log.txt'), 'utf8');
    assert.equal(summary.overallStatus, 'fail');
    assert.equal(summary.artifacts[0].included, true);
    assert.match(logText, /token=REDACTED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed diagnostics do not require a host npm command', () => {
  const context = {
    host: {
      nodeVersion: 'v24.15.0',
      npmVersion: { ok: false, error: 'npm not found' },
      moduleProbe: { powershellVersion: '5.1.26100.1', modules: {}, imports: {}, catalog: {} },
      workspace: {}, web: {}, preflight: [],
    },
  };
  const checks = buildDiagnosticsChecks(context);
  assert.equal(checks.find((item) => item.id === 'bootstrap-prereq').status, 'pass');
});

test('manual full diagnostics select the newest fleet run by default', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-diagnostics-run-'));
  try {
    const context = await collectDiagnosticsContext({
      paths: { stateRoot: root, osdCloudRoot: root, logsDir: path.join(root, 'logs') },
      http: { statusRoot: path.join(root, 'status') },
    }, {
      scope: 'full',
      elevated: true,
      npmVersion: { ok: false, error: 'npm not found' },
      moduleProbe: { powershellVersion: '5.1.26100.1', modules: {}, imports: {}, catalog: {} },
      appState: { fleet: { runs: [
        { runId: 'latest-completed', status: 'completed', latestStage: 'windows-desktop-ready' },
        { runId: 'older-stale', status: 'stale', latestStage: 'apply-image' },
      ] } },
    });
    assert.equal(context.run.run.runId, 'latest-completed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compressed diagnostics bundle creates a readable zip', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-diagnostics-zip-'));
  try {
    const result = await writeDiagnosticsBundle({ paths: { stateRoot: root } }, {
      generatedAt: '2026-07-14T00:00:00.000Z',
      trigger: 'compressed',
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', trigger: 'compressed', scope: 'host', overallStatus: 'pass' },
      checks: [], artifacts: [],
    });
    assert.equal(fs.existsSync(result.bundlePath), true);
    assert.ok(fs.statSync(result.bundlePath).size > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
