import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const webRoot = path.join(repoRoot, 'tools', 'osdcloud-console', 'web');

function collectFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out.sort();
}

function fail(message) {
  throw new Error(message);
}

function assertNoMatch(label, content, pattern) {
  if (pattern.test(content)) {
    fail(`${label} matched forbidden pattern: ${pattern}`);
  }
}

function assertMatch(label, content, pattern) {
  if (!pattern.test(content)) {
    fail(`${label} did not match required pattern: ${pattern}`);
  }
}

function checkSyntax() {
  for (const filePath of collectFiles(path.join(webRoot, 'js'), '.js')) {
    const result = spawnSync(process.execPath, ['--check', filePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      fail(`JavaScript syntax check failed: ${path.relative(repoRoot, filePath)}`);
    }
  }
}

function checkExternalAssets() {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const css = collectFiles(path.join(webRoot, 'css'), '.css')
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  const runtimeSource = `${html}\n${css}`;
  assertNoMatch('web runtime assets', runtimeSource, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/u);
  assertNoMatch('web runtime assets', runtimeSource, /<script[^>]+src=["']https?:\/\//iu);
  assertNoMatch('web runtime assets', runtimeSource, /<link[^>]+href=["']https?:\/\//iu);
}

function checkDesignInvariants() {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = collectFiles(path.join(webRoot, 'js'), '.js')
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  const styles = collectFiles(path.join(webRoot, 'css'), '.css')
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  assertMatch('workspace navigation', html, /id="tab-prepare"[\s\S]*id="tab-dashboard"[\s\S]*id="tab-fleet"/u);
  assertMatch('local icon helper', script, /function makeIcon\(name, className = ''\)/u);
  assertMatch('local icon hydration', script, /function hydrateActionIcons\(root = document\)/u);
  assertMatch('local utility CSS', styles, /\.flex \{ display: flex; \}/u);
  assertMatch('system font stack', styles, /--font-body:/u);
  assertNoMatch('Material font dependency', styles, /Material Symbols/u);
  assertNoMatch('negative letter spacing', styles, /letter-spacing:\s*-/u);
}

function checkDependencySurface() {
  const packageJson = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
  const packageLock = fs.existsSync(path.join(repoRoot, 'package-lock.json'))
    ? fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')
    : '';
  assertNoMatch('dependency surface', `${packageJson}\n${packageLock}`, /bittorrent-tracker|node_modules\/ip"|node_modules\\ip"/u);
}

checkSyntax();
checkExternalAssets();
checkDesignInvariants();
checkDependencySurface();
console.log('check passed');
