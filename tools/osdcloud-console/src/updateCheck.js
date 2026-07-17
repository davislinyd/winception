import fs from 'node:fs';
import path from 'node:path';
import { stateRootForConfig } from './config.js';
import { appVersion } from './version.js';

export const releaseCheckCacheName = 'release-check.json';
export const releaseCheckTtlMs = 24 * 60 * 60 * 1000;
export const releaseCheckTimeoutMs = 5 * 1000;
export const latestReleaseUrl = 'https://api.github.com/repos/davislinyd/winception/releases/latest';

const stableSemverPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/**
 * Parse a stable semantic version. Pre-release and build metadata are intentionally
 * excluded so the stable channel cannot surface alpha/beta/rc releases.
 *
 * @param {unknown} value
 * @returns {{ major: number, minor: number, patch: number, value: string } | null}
 */
export function parseStableSemver(value) {
  const match = stableSemverPattern.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    value: `${major}.${minor}.${patch}`,
  };
}

/**
 * Compare two parsed stable semantic versions.
 *
 * @param {{ major: number, minor: number, patch: number }} left
 * @param {{ major: number, minor: number, patch: number }} right
 * @returns {number}
 */
export function compareStableSemver(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) {
      return left[field] > right[field] ? 1 : -1;
    }
  }
  return 0;
}

/**
 * Return the HostTools State cache path used by the release checker.
 *
 * @param {object} config
 * @returns {string}
 */
export function releaseCheckCachePath(config) {
  return path.join(stateRootForConfig(config), 'updates', releaseCheckCacheName);
}

function normalizedTimestamp(value) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function canonicalReleaseUrl(version) {
  return `https://github.com/davislinyd/winception/releases/tag/v${encodeURIComponent(version)}`;
}

function normalizeLatestRelease(raw) {
  if (!raw || typeof raw !== 'object' || raw.draft === true || raw.prerelease === true) {
    return null;
  }
  const parsed = parseStableSemver(raw.tag_name);
  const publishedAt = normalizedTimestamp(raw.published_at);
  if (!parsed || !publishedAt) {
    return null;
  }
  return {
    version: parsed.value,
    publishedAt,
    htmlUrl: canonicalReleaseUrl(parsed.value),
  };
}

function normalizeCachedLatest(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const parsed = parseStableSemver(raw.version);
  const publishedAt = normalizedTimestamp(raw.publishedAt);
  if (!parsed || !publishedAt) {
    return null;
  }
  return {
    version: parsed.value,
    publishedAt,
    htmlUrl: canonicalReleaseUrl(parsed.value),
  };
}

function normalizeCache(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) {
    return null;
  }
  const lastSuccessfulAt = normalizedTimestamp(raw.lastSuccessfulAt);
  if (!lastSuccessfulAt) {
    return null;
  }
  return {
    schemaVersion: 1,
    etag: typeof raw.etag === 'string' && raw.etag ? raw.etag : null,
    lastAttemptAt: normalizedTimestamp(raw.lastAttemptAt) ?? lastSuccessfulAt,
    lastSuccessfulAt,
    latest: normalizeCachedLatest(raw.latest),
  };
}

function readCache(cachePath) {
  try {
    return normalizeCache(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  } catch {
    return null;
  }
}

function writeCache(cachePath, cache) {
  const directory = path.dirname(cachePath);
  const temporaryPath = path.join(directory, `.${releaseCheckCacheName}.${process.pid}.tmp`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, cachePath);
  } catch {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Cache persistence is best effort and must never affect the Console.
    }
  }
}

function availabilityFor(currentVersion, latest) {
  const current = parseStableSemver(currentVersion);
  const remote = parseStableSemver(latest?.version);
  if (!current || !remote) {
    return 'unknown';
  }
  return compareStableSemver(remote, current) > 0 ? 'available' : 'current';
}

function cacheIsFresh(cache, nowMs, ttlMs) {
  const lastSuccessfulMs = Date.parse(cache?.lastSuccessfulAt ?? '');
  const ageMs = nowMs - lastSuccessfulMs;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs;
}

/**
 * Host-side, cache-backed checker for the latest formal Winception GitHub release.
 * It deliberately contains no download, install, restart, telemetry, or token flow.
 */
export class ReleaseUpdateChecker {
  constructor(config, options = {}) {
    this.currentVersion = options.currentVersion ?? appVersion;
    this.cachePath = options.cachePath ?? releaseCheckCachePath(config);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? releaseCheckTimeoutMs;
    this.ttlMs = options.ttlMs ?? releaseCheckTtlMs;
    this.setTimeout = options.setTimeout ?? globalThis.setTimeout;
    this.clearTimeout = options.clearTimeout ?? globalThis.clearTimeout;
    this.cache = readCache(this.cachePath);
    this.inFlight = null;
    this.state = this.stateFromCache('idle');
  }

  stateFromCache(checkStatus, checkedAt = this.cache?.lastAttemptAt ?? null) {
    const latest = this.cache?.latest ?? null;
    return {
      availability: availabilityFor(this.currentVersion, latest),
      checkStatus,
      currentVersion: this.currentVersion,
      latest: latest ? { ...latest } : null,
      checkedAt,
      lastSuccessfulAt: this.cache?.lastSuccessfulAt ?? null,
    };
  }

  getState() {
    return {
      ...this.state,
      latest: this.state.latest ? { ...this.state.latest } : null,
    };
  }

  async check(options = {}) {
    const force = options.force === true;
    if (this.inFlight) {
      return this.inFlight;
    }
    if (!force && cacheIsFresh(this.cache, this.now().getTime(), this.ttlMs)) {
      this.state = this.stateFromCache('success');
      return this.getState();
    }

    this.state = {
      ...this.stateFromCache('checking', this.state.checkedAt),
      checkedAt: this.state.checkedAt,
    };
    this.inFlight = this.performCheck()
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async performCheck() {
    const checkedAt = this.now().toISOString();
    if (typeof this.fetch !== 'function') {
      this.state = this.stateFromCache('unavailable', checkedAt);
      return this.getState();
    }

    const abortController = new AbortController();
    const timer = this.setTimeout(() => abortController.abort(), this.timeoutMs);
    try {
      const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Winception/${this.currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (this.cache?.etag) {
        headers['If-None-Match'] = this.cache.etag;
      }
      const response = await this.fetch(latestReleaseUrl, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });
      const etag = response.headers?.get?.('etag') ?? this.cache?.etag ?? null;
      if (response.status === 304 && this.cache) {
        this.cache = {
          ...this.cache,
          etag,
          lastAttemptAt: checkedAt,
          lastSuccessfulAt: checkedAt,
        };
        writeCache(this.cachePath, this.cache);
        this.state = this.stateFromCache('success', checkedAt);
        return this.getState();
      }
      if (response.status === 404) {
        this.cache = {
          schemaVersion: 1,
          etag,
          lastAttemptAt: checkedAt,
          lastSuccessfulAt: checkedAt,
          latest: null,
        };
        writeCache(this.cachePath, this.cache);
        this.state = this.stateFromCache('success', checkedAt);
        return this.getState();
      }
      if (!response.ok) {
        throw new Error('GitHub release check failed.');
      }
      const latest = normalizeLatestRelease(await response.json());
      if (!latest) {
        throw new Error('GitHub release response is not a stable release.');
      }
      this.cache = {
        schemaVersion: 1,
        etag,
        lastAttemptAt: checkedAt,
        lastSuccessfulAt: checkedAt,
        latest,
      };
      writeCache(this.cachePath, this.cache);
      this.state = this.stateFromCache('success', checkedAt);
      return this.getState();
    } catch {
      this.state = this.stateFromCache('unavailable', checkedAt);
      return this.getState();
    } finally {
      this.clearTimeout(timer);
    }
  }
}
