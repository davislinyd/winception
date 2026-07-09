import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stateRootForConfig, webServerConfig } from './config.js';

const tokenFileName = 'web-console-token.json';

function normalizeHost(host) {
  return String(host ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/u, '$1');
}

export function isLoopbackWebHost(host) {
  const normalized = normalizeHost(host);
  return normalized === ''
    || normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){0,3}$/u.test(normalized);
}

export function webConsoleTokenPath(config = {}) {
  return path.join(stateRootForConfig(config), 'config', tokenFileName);
}

function readTokenFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
  const token = String(parsed.token ?? '').trim();
  return token ? token : null;
}

export function ensureWebConsoleToken(config = {}) {
  const filePath = webConsoleTokenPath(config);
  const existing = readTokenFile(filePath);
  if (existing) {
    return { token: existing, filePath, created: false };
  }
  const token = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    token,
    createdAt: new Date().toISOString(),
    purpose: 'Winception Web Console API token for non-loopback access.',
  }, null, 2)}\n`, 'utf8');
  return { token, filePath, created: true };
}

export function webAuthState(config = {}) {
  const web = webServerConfig(config);
  const required = !isLoopbackWebHost(web.host);
  return {
    ok: true,
    required,
    hostMode: required ? 'non-loopback' : 'loopback',
  };
}

export function tokenMatches(provided, expected) {
  const left = Buffer.from(String(provided ?? ''), 'utf8');
  const right = Buffer.from(String(expected ?? ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
