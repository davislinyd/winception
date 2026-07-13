import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DpapiSecretProtector } from '../src/dpapi.js';
import { loadServiceSettings } from '../src/serviceSettings.js';

test('DPAPI adapter round-trips a secret without command-line exposure', { skip: process.platform !== 'win32' }, async () => {
  const protector = new DpapiSecretProtector(join(process.cwd(), 'tools', 'v2', 'Protect-WinceptionSecret.ps1'));
  const plaintext = 'unit-test-value-that-must-not-appear-in-output';
  const ciphertext = await protector.protect('unitTestSecret', plaintext);
  assert.notEqual(ciphertext, plaintext);
  assert.equal(await protector.unprotect('unitTestSecret', ciphertext), plaintext);
});

test('service settings decrypt installer tokens from an ACL-ready JSON document', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-settings-'));
  try {
    const appRoot = process.cwd();
    const protector = new DpapiSecretProtector(join(appRoot, 'tools', 'v2', 'Protect-WinceptionSecret.ps1'));
    const managementToken = 'management-token-at-least-thirty-two-characters';
    const agentToken = 'agent-token-at-least-thirty-two-characters-000';
    const settingsPath = join(root, 'service-settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 1,
      appRoot,
      stateRoot: root,
      legacyConfigPath: join(root, 'legacy.json'),
      agentPipe: String.raw`\\.\pipe\ProtectedPrefix\Administrators\Winception.Agent.v2`,
      managementHost: '127.0.0.1',
      managementPort: 8080,
      managementTokenProtected: await protector.protect('management-token', managementToken),
      agentTokenProtected: await protector.protect('agent-token', agentToken),
    }), 'utf8');
    const settings = await loadServiceSettings(settingsPath);
    assert.equal(settings.managementToken, managementToken);
    assert.equal(settings.agentToken, agentToken);
    assert.equal('managementTokenProtected' in settings, false);
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});
