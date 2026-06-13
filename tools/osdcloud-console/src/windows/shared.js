import crypto from 'node:crypto';
import fs from 'node:fs';

export function getFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    stream.on('error', (err) => reject(err));
  });
}

export function getFileSha256Sync(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

export function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

export function toPowerShellArray(values) {
  return values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(', ');
}

export function asArray(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function escapePowerShellString(value) {
  return String(value ?? '').replaceAll("'", "''");
}

export function pass(name, detail = '') {
  return { name, ok: true, detail };
}

export function fail(name, detail = '') {
  return { name, ok: false, detail };
}

// A non-blocking caveat: the check is satisfied enough to start services, but
// the operator should be aware of a degraded condition (e.g. the service link
// is not up yet). `ok: true` keeps it out of the blocking set; `warn: true`
// lets the UI surface it distinctly.
export function warn(name, detail = '') {
  return { name, ok: true, warn: true, detail };
}
