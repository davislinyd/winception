import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoots = ['apps/agent', 'apps/server', 'apps/web', 'packages/contracts', 'packages/domain', 'packages/application', 'packages/infrastructure'];
const files = sourceRoots.flatMap((sourceRoot) => collect(path.join(root, sourceRoot)))
  .filter((file) => /\.(?:ts|tsx)$/u.test(file));
const graph = new Map(files.map((file) => [file, []]));
const violations = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of imports(source)) {
    if (!specifier.startsWith('.')) continue;
    const target = resolveImport(file, specifier);
    if (!target || !graph.has(target)) continue;
    graph.get(file).push(target);
    const fromLayer = layerOf(file);
    const toLayer = layerOf(target);
    if (!allowed(fromLayer, toLayer)) {
      violations.push(`${relative(file)} imports forbidden layer ${toLayer} via ${relative(target)}`);
    }
    const fromFeature = webFeature(file);
    const toFeature = webFeature(target);
    if (fromFeature && toFeature && fromFeature !== toFeature) {
      violations.push(`${relative(file)} imports another Web feature (${toFeature}) via ${relative(target)}`);
    }
  }
}

for (const component of stronglyConnectedComponents(graph)) {
  if (component.length > 1) violations.push(`dependency cycle: ${component.map(relative).join(' -> ')}`);
  if (component.length === 1 && graph.get(component[0])?.includes(component[0])) {
    violations.push(`self dependency: ${relative(component[0])}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
else {
  console.log(`v2 dependency boundary check passed (${files.length} files, 0 cycles).`);
}

function collect(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(target) : [target];
  });
}

function imports(source) {
  const found = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu;
  for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

function resolveImport(source, specifier) {
  const base = path.resolve(path.dirname(source), specifier.replace(/\.js$/u, ''));
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function layerOf(file) {
  const name = relative(file).replaceAll('\\', '/');
  if (name.startsWith('packages/contracts/')) return 'contracts';
  if (name.startsWith('packages/domain/')) return 'domain';
  if (name.startsWith('packages/application/')) return 'application';
  if (name.startsWith('packages/infrastructure/')) return 'infrastructure';
  if (name.startsWith('apps/agent/')) return 'agent';
  if (name.startsWith('apps/server/')) return 'server';
  if (name.startsWith('apps/web/')) return 'web';
  return 'unknown';
}

function allowed(from, to) {
  const rules = {
    contracts: new Set(['contracts']),
    domain: new Set(['contracts', 'domain']),
    application: new Set(['contracts', 'domain', 'application']),
    infrastructure: new Set(['contracts', 'domain', 'application', 'infrastructure']),
    agent: new Set(['contracts', 'domain', 'application', 'infrastructure', 'agent']),
    server: new Set(['contracts', 'domain', 'application', 'infrastructure', 'server']),
    web: new Set(['contracts', 'web']),
  };
  return rules[from]?.has(to) === true;
}

function stronglyConnectedComponents(input) {
  const result = [];
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  let index = 0;

  function visit(node) {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of input.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(next)));
      }
      else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(next)));
      }
    }
    if (lowLinks.get(node) === indexes.get(node)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      result.push(component);
    }
  }

  for (const node of input.keys()) if (!indexes.has(node)) visit(node);
  return result;
}

function relative(file) {
  return path.relative(root, file);
}

function webFeature(file) {
  const normalized = relative(file).replaceAll('\\', '/');
  const match = /^apps\/web\/src\/features\/([^/]+)\//u.exec(normalized);
  return match?.[1] ?? null;
}
