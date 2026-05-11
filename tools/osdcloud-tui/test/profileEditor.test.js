import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySoftwareCheckboxKey,
  formatDeploymentProfileDeleteChoice,
  formatDeploymentProfileListChoice,
  formatSoftwareCheckboxRow,
  formatSoftwareCheckboxRows,
  toggleSoftwareSelection,
  validateProfileTextInput,
} from '../src/profileEditor.js';

const software = [
  { id: '7zip', name: '7-Zip 26.01 x64' },
  { id: 'chrome', name: 'Google Chrome Enterprise 64-bit' },
];

test('formats software checkbox rows', () => {
  assert.equal(formatSoftwareCheckboxRow(software[0], ['7zip']), '[x] 7zip - 7-Zip 26.01 x64');
  assert.deepEqual(formatSoftwareCheckboxRows(software, ['chrome']), [
    '[ ] 7zip - 7-Zip 26.01 x64',
    '[x] chrome - Google Chrome Enterprise 64-bit',
  ]);
});

test('toggles software checkbox selection with space key behavior', () => {
  assert.deepEqual(toggleSoftwareSelection(software, ['7zip'], 'chrome'), ['7zip', 'chrome']);
  assert.deepEqual(toggleSoftwareSelection(software, ['7zip', 'chrome'], '7zip'), ['chrome']);
  assert.deepEqual(applySoftwareCheckboxKey(software, ['7zip'], 'space', 'chrome'), ['7zip', 'chrome']);
});

test('select all and select none checkbox shortcuts', () => {
  assert.deepEqual(applySoftwareCheckboxKey(software, [], 'a', '7zip'), ['7zip', 'chrome']);
  assert.deepEqual(applySoftwareCheckboxKey(software, ['7zip', 'chrome'], 'n', '7zip'), []);
});

test('formats deployment profile list choices', () => {
  const profile = {
    id: 'default-chrome',
    name: 'Default + Chrome',
    softwareIds: ['7zip', 'chrome'],
  };

  assert.equal(formatDeploymentProfileListChoice(profile), 'Default + Chrome (default-chrome) software=7zip,chrome');
  assert.equal(formatDeploymentProfileDeleteChoice(profile), 'Default + Chrome (default-chrome)');
});

test('validates profile text input', () => {
  assert.deepEqual(validateProfileTextInput({ id: 'ops_01', name: 'Ops 01' }, ['default']), {
    ok: true,
    id: 'ops_01',
    name: 'Ops 01',
  });
  assert.equal(validateProfileTextInput({ id: '', name: 'Missing' }).ok, false);
  assert.equal(validateProfileTextInput({ id: '..\\outside', name: 'Unsafe' }).ok, false);
  assert.equal(validateProfileTextInput({ id: 'default', name: 'Duplicate' }, ['default']).ok, false);
  assert.equal(validateProfileTextInput({ id: 'empty-name', name: '' }).ok, false);
});
