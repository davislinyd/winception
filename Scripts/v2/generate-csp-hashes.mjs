import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputRoot = resolve(process.cwd(), process.argv[2] ?? 'dist/v2/web/manual');
if (!existsSync(outputRoot)) throw new Error(`Documentation output does not exist: ${outputRoot}`);
const hashes = new Set();
for (const file of walk(outputRoot).filter((path) => path.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/giu)) {
    const content = match[1];
    if (!content) continue;
    hashes.add(`sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`);
  }
}
const manifest = { schemaVersion: 1, algorithm: 'sha256', hashes: [...hashes].sort() };
writeFileSync(resolve(outputRoot, 'csp-hashes.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Manual CSP manifest: ${manifest.hashes.length} inline script hashes.`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
