import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { addPackagedPowerShellModulePath } from '../src/powerShellModules.js';

test('packaged PowerShell modules are prepended once for every Agent child process', () => {
  const root = mkdtempSync(join(tmpdir(), 'winception-modules-'));
  try {
    const moduleRoot = join(root, 'powershell-modules');
    mkdirSync(moduleRoot);
    const environment: NodeJS.ProcessEnv = { PSModulePath: 'existing' };
    assert.equal(addPackagedPowerShellModulePath(root, environment), moduleRoot);
    assert.equal(environment.PSModulePath, `${moduleRoot}${delimiter}existing`);
    assert.equal(addPackagedPowerShellModulePath(root, environment), moduleRoot);
    assert.equal(environment.PSModulePath?.split(delimiter).filter((entry) => entry === moduleRoot).length, 1);
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing packaged PowerShell module root leaves the environment unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'winception-modules-'));
  try {
    const environment: NodeJS.ProcessEnv = { PSModulePath: 'existing' };
    assert.equal(addPackagedPowerShellModulePath(root, environment), null);
    assert.equal(environment.PSModulePath, 'existing');
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});
