import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDeploymentStatus } from '../src/status.js';

test('formats missing deployment status with visible placeholder', () => {
  const lines = formatDeploymentStatus(null);
  assert.match(lines.join('\n'), /No deployment status yet/);
});

test('formats deployment status without blessed tags', () => {
  const lines = formatDeploymentStatus({
    runId: '20260509-012719-9VDYLD4',
    clientId: '9VDYLD4',
    stage: 'apply-image',
    percent: 2,
    elapsedSeconds: 221,
    receivedAt: '2026-05-08T17:31:06.272Z',
    message: 'HKLM\\{bf1a281b-ad7b-4476-ac95-f47682990ce7}\\Windows status update',
  });

  assert.equal(lines[0], 'Status   : running');
  assert.equal(lines[1], 'Run      : 20260509-012719-9VDYLD4');
  assert.equal(lines[2], 'Client   : 9VDYLD4');
  assert.match(lines[3], /Stage    : apply-image/);
  assert.match(lines.join('\n'), /Status   : running/);
  assert.match(lines.join('\n'), /HKLM\\\{bf1a281b/);
});

test('formats deployment summary start and end records', () => {
  const lines = formatDeploymentStatus({
    runId: 'run-1',
    clientId: 'client-1',
    stage: 'windows-desktop-ready',
    percent: 100,
    message: 'Desktop ready.',
  }, {
    status: 'completed',
    startedAt: '2026-05-09T01:00:00Z',
    winpeEndedAt: '2026-05-09T01:10:00Z',
    completedAt: '2026-05-09T01:15:00Z',
  });

  assert.match(lines.join('\n'), /Status   : completed/);
  assert.match(lines.join('\n'), /Started  : 2026-05-09T01:00:00Z/);
  assert.match(lines.join('\n'), /Finished : 2026-05-09T01:15:00Z/);
});
