import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadRuntimeArtifactCatalog,
  planRuntimeArtifacts,
  sha256File,
  verifyArtifactFile,
} from '../src/runtimeArtifacts.js';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeCatalog(root, body) {
  const catalogPath = path.join(root, 'runtime-artifacts.json');
  writeJson(catalogPath, body);
  return catalogPath;
}

test('runtime artifact catalog validates download recipes and plans required artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [
        {
          id: 'boot-wim',
          kind: 'winpe',
          sourceType: 'generated-winpe',
          target: 'Win11-iPXE-Lab\\Media\\sources\\boot.wim',
          length: 12,
          sha256: 'A'.repeat(64),
        },
        {
          id: 'optional-en-us',
          kind: 'osImage',
          sourceType: 'download',
          required: false,
          url: 'https://dl.delivery.mp.microsoft.com/install.esd',
          target: 'Win11-iPXE-Lab\\Media\\OSDCloud\\OS\\en-us.esd',
          length: 10,
          sha256: 'B'.repeat(64),
        },
      ],
      software: [
        {
          id: '7zip',
          sourceType: 'download',
          url: 'https://www.7-zip.org/a/7z2601-x64.msi',
          targets: [
            'Softwares\\7zip\\7z2601-x64.msi',
            'Win11-iPXE-Lab\\Media\\OSDCloud\\Apps\\7zip\\7z2601-x64.msi',
          ],
          length: 9,
          sha256: 'C'.repeat(64),
        },
      ],
    });

    const catalog = loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath });
    assert.equal(catalog.artifacts.length, 3);
    assert.deepEqual(planRuntimeArtifacts(catalog).map((artifact) => artifact.id), ['boot-wim', '7zip']);
    assert.deepEqual(
      planRuntimeArtifacts(catalog, { includeOptional: true }).map((artifact) => artifact.id),
      ['boot-wim', 'optional-en-us', '7zip'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact catalog rejects missing URLs and unsafe targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-invalid-'));
  try {
    let catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'bad-download',
        sourceType: 'download',
        target: 'Win11-iPXE-Lab\\file.bin',
        length: 1,
        sha256: 'A'.repeat(64),
      }],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /url is required/,
    );

    catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'bad-target',
        sourceType: 'generated',
        target: '..\\secrets.json',
        length: 1,
        sha256: 'A'.repeat(64),
      }],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /escapes root/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact verification catches size and hash mismatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-verify-'));
  try {
    const filePath = path.join(root, 'artifact.bin');
    fs.writeFileSync(filePath, 'expected bytes', 'utf8');
    const valid = {
      length: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    };
    assert.equal(verifyArtifactFile(filePath, valid).ok, true);
    assert.equal(verifyArtifactFile(filePath, { ...valid, length: valid.length + 1 }).reason, 'size-mismatch');
    assert.equal(verifyArtifactFile(filePath, { ...valid, sha256: 'D'.repeat(64) }).reason, 'hash-mismatch');
    assert.equal(verifyArtifactFile(path.join(root, 'missing.bin'), valid).reason, 'missing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checked-in runtime artifact catalog is valid', () => {
  const catalog = loadRuntimeArtifactCatalog();
  assert.ok(catalog.artifacts.length >= 1);
  assert.ok(catalog.artifacts.some((artifact) => artifact.id === 'win11-25h2-zh-tw-pro-esd'));
  assert.ok(catalog.artifacts.some((artifact) => artifact.id === '7zip'));
});

test('restore bootstrap auto-installs ADK prerequisites with signed Microsoft installers', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.match(script, /linkid=2289980/);
  assert.match(script, /linkid=2289981/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /WinVerifyTrust/);
  assert.match(script, /CreateFromSignedFile/);
  assert.match(script, /OptionId\.DeploymentTools/);
  assert.match(script, /OptionId\.WindowsPreinstallationEnvironment/);
  assert.match(script, /NoAdkAutoInstall/);
});

test('restore bootstrap creates missing OSDCloud template before workspace build', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.match(script, /Ensure-OsdCloudTemplate/);
  assert.match(script, /Test-OsdCloudTemplateReady/);
  assert.match(script, /Set-OsdCloudTemplateGalleryFallback/);
  assert.match(script, /New-OSDCloudTemplate -Name 'default'/);
  assert.match(script, /Skipping WinPE PowerShell Gallery module injection/);
  assert.match(script, /Media\\sources\\boot\.wim/);
  assert.match(script, /workspace build did not produce required boot\.wim/);
});

test('endpoint sync restores missing live endpoint templates from repo mirror', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Restore-RequiredEndpointFiles/);
  assert.match(script, /PXE-HttpRoot\\osdcloud\\boot\.ipxe/);
  assert.match(script, /Config\\Scripts\\SetupComplete\\SetupComplete\.ps1/);
  assert.match(script, /osdcloud-assets\\Win11-iPXE-Lab/);
});

test('endpoint sync restores missing source boot.wim from published HTTP copy', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Restore-BootWimSourceIfMissing/);
  assert.match(script, /Restored missing source boot\.wim from published HTTP copy/);
  assert.match(script, /Published copy is also missing/);
});

test('deployment bootstrap refreshes endpoint runtime files after validation', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Initialize-DeploymentServer.ps1'), 'utf8');
  assert.match(script, /Repair-EndpointRuntimeIfMissing/);
  assert.match(script, /Media\\sources\\boot\.wim/);
  assert.match(script, /PXE-HttpRoot\\osdcloud\\boot\.wim/);
  assert.match(script, /Refreshing runtime files required for endpoint sync/);
});
