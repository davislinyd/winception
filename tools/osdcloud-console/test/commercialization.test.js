import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentEndpointMissing, isDeploymentEndpointConfigured, isUnconfiguredInitialization, loadConfig } from '../src/config.js';
import { resolveOsImageState } from '../src/osimages/catalog.js';
import { resolveDeploymentProfileState } from '../src/profiles/profiles.js';
import { MediaHttpServer } from '../src/httpServer.js';

function isolatedReleaseConfig(root) {
  const config = JSON.parse(fs.readFileSync(path.resolve('config/osdcloud-console.json'), 'utf8'));
  config.paths.stateRoot = root;
  config.osImage.catalogPath = path.join(root, 'config', 'os-image-catalog.json');
  config.osImage.downloadSourcesPath = path.join(root, 'config', 'os-download-sources.json');
  config.osImage.cacheRoot = path.join(root, 'OS');
  config.osImage.downloadStagingRoot = path.join(root, 'OS', '.downloads');
  config.deploymentProfiles.profilesRoot = path.join(root, 'config', 'deployment-profiles');
  config.deploymentProfiles.softwareCatalogPath = path.join(root, 'config', 'software-catalog.json');
  config.deploymentProfiles.customScriptsCatalogPath = path.join(root, 'config', 'scripts-catalog.json');
  return config;
}

function postJson(base, route, payload, headers = {}) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

function decryptEnvelope(envelope, privateKey) {
  const decode = (value) => Buffer.from(value, 'base64url');
  const key = crypto.privateDecrypt({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, decode(envelope.encryptedKey));
  const authenticated = Buffer.concat([decode(envelope.iv), decode(envelope.ciphertext)]);
  const expectedMac = crypto.createHmac('sha256', key).update(authenticated).digest();
  assert.equal(crypto.timingSafeEqual(expectedMac, decode(envelope.mac)), true);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, decode(envelope.iv));
  return JSON.parse(Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]).toString('utf8'));
}

test('release source is zero-preload and supports an isolated empty state', () => {
  const releaseJson = JSON.parse(fs.readFileSync(path.resolve('config/osdcloud-console.json'), 'utf8'));
  assert.equal(releaseJson.product.channel, 'release');
  assert.equal(releaseJson.product.dataPolicy, 'zero-preload');
  assert.equal(releaseJson.initialization.status, 'unconfigured');
  assert.equal(releaseJson.adapter.serverIp, null);
  assert.equal(releaseJson.dhcp.leaseStartIp, null);
  assert.equal(releaseJson.http.host, null);
  assert.equal(releaseJson.smb.share, null);
  assert.equal(releaseJson.deploymentProfiles.activeProfile, null);
  assert.equal(releaseJson.security.requireLeaseBinding, true);
  for (const fileName of ['software-catalog.json', 'scripts-catalog.json', 'os-image-catalog.json', 'os-download-sources.json']) {
    const catalog = JSON.parse(fs.readFileSync(path.resolve('config', fileName), 'utf8'));
    const collection = fileName === 'software-catalog.json'
      ? catalog.software
      : fileName === 'scripts-catalog.json'
        ? catalog.scripts
        : catalog.images;
    assert.ok(Array.isArray(collection), `${fileName} should declare a collection`);
    assert.equal(collection.length, 0, `${fileName} must contain no preloaded data`);
  }

  const config = loadConfig(path.resolve('config/osdcloud-console.json'), { localConfigPath: false });
  assert.equal(isUnconfiguredInitialization(config), true);
  assert.equal(isDeploymentEndpointConfigured(config), false);
  assert.ok(deploymentEndpointMissing(config).length > 0);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-empty-state-'));
  try {
    const isolated = isolatedReleaseConfig(root);
    const profileState = resolveDeploymentProfileState(isolated);
    assert.deepEqual(profileState.profiles, []);
    assert.equal(profileState.activeProfile, null);
    assert.deepEqual(profileState.selectedSoftware, []);
    const imageState = resolveOsImageState(isolated);
    assert.deepEqual(imageState.images, []);
    assert.equal(imageState.activeImage, null);
    assert.equal(imageState.selectedOs, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('boot-session uses an ephemeral bound envelope and revokes terminal sessions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-boot-session-'));
  const statusRoot = path.join(root, 'status');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'osdcloud-secrets.json'), JSON.stringify({
    windowsUsername: 'deployment-user',
    windowsPassword: 'test-only-password',
    pxeinstallPassword: 'test-only-smb-password',
  }), 'utf8');
  let leaseActive = true;
  const server = new MediaHttpServer({
    root,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
    paths: { stateRoot: root, logsDir: path.join(root, 'logs') },
    dhcp: { leaseStartIp: '127.0.0.1', leaseEndIp: '127.0.0.1' },
    smb: { share: '\\\\127.0.0.1\\OSDCloudiPXE' },
    security: { requireBootSession: true, requireLeaseBinding: true, bootSessionTtlSeconds: 60 },
  }, null, {
    bootLeaseValidator: (address, mac) => leaseActive && address === '127.0.0.1' && mac === 'AA-BB-CC-DD-EE-FF',
  });

  try {
    await server.start();
    const base = `http://127.0.0.1:${server.address.port}`;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const request = {
      clientPublicKey: publicKey.export({ format: 'jwk' }),
      nonce: 'nonce-one',
      bootId: 'boot-one',
      clientId: 'client-one',
      clientMac: 'AA-BB-CC-DD-EE-FF',
      runId: 'run-one',
      clientIp: '127.0.0.1',
    };
    let response = await postJson(base, '/osdcloud/boot-session', request);
    assert.equal(response.status, 201);
    const session = await response.json();
    assert.equal(session.ok, true);
    assert.equal(session.smbPassword, undefined);
    assert.equal(session.windowsPassword, undefined);
    assert.equal(session.windowsUsername, undefined);
    assert.match(JSON.stringify(session), /encryptedKey/u);
    assert.deepEqual(decryptEnvelope(session.envelope, privateKey), {
      smbUser: 'pxeinstall',
      smbPassword: 'test-only-smb-password',
      windowsUsername: 'deployment-user',
      windowsPassword: 'test-only-password',
    });

    response = await postJson(base, '/osdcloud/status', { runId: 'run-one', clientId: 'client-one', stage: 'winpe-start' });
    assert.equal(response.status, 401);

    response = await postJson(base, '/osdcloud/status', { runId: 'run-one', clientId: 'other-client', stage: 'winpe-start' }, {
      'x-winception-boot-session': session.sessionToken,
    });
    assert.equal(response.status, 403);

    response = await postJson(base, '/osdcloud/boot-session', { ...request, nonce: 'nonce-ip-mismatch', clientIp: '10.0.0.5' });
    assert.equal(response.status, 403);
    response = await postJson(base, '/osdcloud/boot-session', { ...request, nonce: 'nonce-mac-mismatch', clientMac: 'AA-BB-CC-DD-EE-01' });
    assert.equal(response.status, 403);

    const storedSession = [...server.bootSessions.values()][0];
    storedSession.expiresAt = Date.now() - 1;
    response = await postJson(base, '/osdcloud/status', { runId: 'run-one', clientId: 'client-one', stage: 'winpe-start' }, {
      'x-winception-boot-session': session.sessionToken,
    });
    assert.equal(response.status, 401);

    const secondRequest = { ...request, nonce: 'nonce-two', bootId: 'boot-two', runId: 'run-two' };
    response = await postJson(base, '/osdcloud/boot-session', secondRequest);
    assert.equal(response.status, 201);
    const secondSession = await response.json();
    response = await postJson(base, '/osdcloud/boot-session', secondRequest);
    assert.equal(response.status, 403);

    leaseActive = false;
    response = await postJson(base, '/osdcloud/status', { runId: 'run-two', clientId: 'client-one', stage: 'winpe-start' }, {
      'x-winception-boot-session': secondSession.sessionToken,
    });
    assert.equal(response.status, 403);
    leaseActive = true;

    response = await postJson(base, '/osdcloud/status', { runId: 'run-two', clientId: 'client-one', stage: 'windows-desktop-ready' }, {
      'x-winception-boot-session': secondSession.sessionToken,
    });
    assert.equal(response.status, 204);
    assert.equal(server.bootSessions.has(secondSession.sessionId), false);
    response = await postJson(base, '/osdcloud/status', { runId: 'run-two', clientId: 'client-one', stage: 'windows-desktop-ready' }, {
      'x-winception-boot-session': secondSession.sessionToken,
    });
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release PXE path never embeds long-lived secrets and gates desktop-ready on cleanup', () => {
  const endpointSync = fs.readFileSync(path.resolve('tools/Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  const startScript = fs.readFileSync(path.resolve('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1'), 'utf8');
  assert.match(startScript, /New-Object System\.Security\.Cryptography\.RSACng\(2048\)/);
  assert.match(startScript, /RSAEncryptionPadding\]::OaepSHA256/);
  assert.doesNotMatch(startScript, /RSACryptoServiceProvider/);
  assert.doesNotMatch(startScript, /\$rsa\.KeySize\s*=/);
  const setupPaths = [
    path.resolve('osdcloud-assets/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1'),
    path.resolve('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1'),
  ];

  assert.match(endpointSync, /ephemeral-boot-session/u);
  assert.match(endpointSync, /Removed legacy embedded deployment secrets/u);
  assert.doesNotMatch(endpointSync, /Copy-Item\s+-LiteralPath\s+\$deploymentSecretSource/u);
  assert.doesNotMatch(endpointSync, /Get-DeploymentSecretSource/u);
  assert.match(startScript, /POST.*boot-session|bootSessionUrl.*boot-session/us);
  assert.doesNotMatch(startScript, /GET.*boot-config|Invoke-RestMethod.*boot-config/us);
  assert.match(startScript, /clientMac/u);
  assert.match(startScript, /X-Winception-Boot-Session/u);

  const setupComplete = fs.readFileSync(setupPaths[0], 'utf8');
  const embeddedSetupComplete = fs.readFileSync(setupPaths[1], 'utf8');
  assert.equal(
    embeddedSetupComplete.replace(/\r\n/gu, '\n'),
    setupComplete.replace(/\r\n/gu, '\n'),
    'boot and source SetupComplete templates must stay synchronized',
  );
  for (const name of ['AutoAdminLogon', 'ForceAutoLogon', 'DefaultPassword', 'AutoLogonCount']) {
    assert.match(setupComplete, new RegExp(name, 'u'));
  }
  assert.match(setupComplete, /C:\\ProgramData\\OSDCloud\\secrets\.json/u);
  assert.match(setupComplete, /windows-auto-logon-cleanup-failed/u);
  assert.equal((setupComplete.match(/function Clear-AutoLogonSecrets/gu) || []).length, 2);
  assert.doesNotMatch(setupComplete, /if \(-not \$cleanup\)/u);
  assert.match(setupComplete, /if \(-not \$cleanup\.ok\)/u);
  assert.match(setupComplete, /if \(\$cleanup\.ok\)/u);
  assert.match(setupComplete, /OSDCLOUD_WINDOWS_PASSWORD/u);
  const desktopReadyIndex = setupComplete.indexOf("Send-Status -Stage 'windows-desktop-ready'");
  const cleanupIndex = setupComplete.lastIndexOf('Clear-AutoLogonSecrets', desktopReadyIndex);
  assert.ok(cleanupIndex >= 0 && desktopReadyIndex > cleanupIndex, 'SetupComplete must perform cleanup before desktop-ready reporting');
});
