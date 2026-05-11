import fs from 'node:fs';

const packageInfo = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

export const appVersion = packageInfo.version ?? 'unknown';
