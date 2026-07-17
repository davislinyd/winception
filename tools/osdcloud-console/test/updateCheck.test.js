import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReleaseUpdateChecker, compareStableSemver, parseStableSemver, releaseCheckCachePath } from '../src/updateCheck.js';

function makeResponse(status, payload = null, headers = {}) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function release(tagName, extra = {}) {
  return {
    tag_name: tagName,
    draft: false,
    prerelease: false,
    published_at: '2026-07-17T00:00:00.000Z',
    ...extra,
  };
}

function makeChecker(root, options = {}) {
  return new ReleaseUpdateChecker({ paths: { stateRoot: root } }, {
    currentVersion: '1.0.3',
    now: options.now ?? (() => new Date('2026-07-17T00:00:00.000Z')),
    ...options,
  });
}

test('stable semantic versions accept an optional v prefix and compare numerically', () => {
  assert.deepEqual(parseStableSemver('v10.2.3'), { major: 10, minor: 2, patch: 3, value: '10.2.3' });
  assert.equal(parseStableSemver('v2.0.0-alpha.1'), null);
  assert.equal(parseStableSemver('1.02.3'), null);
  assert.equal(compareStableSemver(parseStableSemver('1.10.0'), parseStableSemver('1.9.99')), 1);
});

test('release checker records a newer stable release without exposing its body', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-update-check-'));
  try {
    const checker = makeChecker(root, {
      fetch: async () => makeResponse(200, release('v1.0.4'), { etag: '"v104"' }),
    });
    const state = await checker.check({ force: true });

    assert.deepEqual(state, {
      availability: 'available',
      checkStatus: 'success',
      currentVersion: '1.0.3',
      latest: {
        version: '1.0.4',
        publishedAt: '2026-07-17T00:00:00.000Z',
        htmlUrl: 'https://github.com/davislinyd/winception/releases/tag/v1.0.4',
      },
      checkedAt: '2026-07-17T00:00:00.000Z',
      lastSuccessfulAt: '2026-07-17T00:00:00.000Z',
    });
    const cache = JSON.parse(fs.readFileSync(releaseCheckCachePath({ paths: { stateRoot: root } }), 'utf8'));
    assert.equal(cache.etag, '"v104"');
    assert.equal(cache.latest.version, '1.0.4');
    assert.equal(JSON.stringify(cache).includes('body'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a fresh cache skips automatic network checks and a stale ETag cache accepts 304', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-update-etag-'));
  try {
    let now = new Date('2026-07-17T00:00:00.000Z');
    const first = makeChecker(root, {
      now: () => now,
      fetch: async () => makeResponse(200, release('v1.0.4'), { etag: '"v104"' }),
    });
    await first.check({ force: true });

    let freshCalls = 0;
    const fresh = makeChecker(root, {
      now: () => now,
      fetch: async () => {
        freshCalls += 1;
        return makeResponse(200, release('v9.9.9'));
      },
    });
    assert.equal((await fresh.check()).availability, 'available');
    assert.equal(freshCalls, 0);

    now = new Date('2026-07-18T00:00:01.000Z');
    let requestHeaders = null;
    const stale = makeChecker(root, {
      now: () => now,
      fetch: async (_url, options) => {
        requestHeaders = options.headers;
        return makeResponse(304, null, { etag: '"v104"' });
      },
    });
    const state = await stale.check();
    assert.equal(requestHeaders['If-None-Match'], '"v104"');
    assert.equal(state.checkStatus, 'success');
    assert.equal(state.availability, 'available');
    assert.equal(state.lastSuccessfulAt, '2026-07-18T00:00:01.000Z');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid or prerelease responses are unavailable and never become an update', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-update-prerelease-'));
  try {
    const checker = makeChecker(root, {
      fetch: async () => makeResponse(200, release('v2.0.0-alpha.1', { prerelease: true })),
    });
    const state = await checker.check({ force: true });
    assert.equal(state.availability, 'unknown');
    assert.equal(state.checkStatus, 'unavailable');
    assert.equal(state.latest, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('network failure preserves the last verified update result and concurrent checks share one request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-update-fallback-'));
  try {
    let resolveRequest;
    let calls = 0;
    const checker = makeChecker(root, {
      fetch: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
    });
    const first = checker.check({ force: true });
    const second = checker.check({ force: true });
    assert.equal(calls, 1);
    resolveRequest(makeResponse(200, release('v1.0.4')));
    await Promise.all([first, second]);

    checker.fetch = async () => {
      throw new Error('offline');
    };
    const state = await checker.check({ force: true });
    assert.equal(state.checkStatus, 'unavailable');
    assert.equal(state.availability, 'available');
    assert.equal(state.latest.version, '1.0.4');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timeout is reported as unavailable without throwing to the Console', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-update-timeout-'));
  try {
    let aborted = false;
    const checker = makeChecker(root, {
      timeoutMs: 1,
      fetch: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }, { once: true });
      }),
    });
    const state = await checker.check({ force: true });
    assert.equal(aborted, true);
    assert.equal(state.checkStatus, 'unavailable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
