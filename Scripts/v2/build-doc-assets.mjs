import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const root = process.cwd();
const mode = process.argv[2] ?? '--check';
if (!['--check', '--write'].includes(mode)) throw new Error('Use --check or --write.');

const outputs = new Map();
const flowSource = JSON.parse(readFileSync(resolve(root, 'docs/diagrams/flow-source.json'), 'utf8'));
outputs.set(resolve(root, 'apps/docs/static/data/flows.json'), `${JSON.stringify({ schemaVersion: flowSource.schemaVersion, animations: flowSource.animations }, null, 2)}\n`);

for (const locale of ['zh-TW', 'en']) {
  const docsRoot = locale === 'zh-TW'
    ? resolve(root, 'apps/docs/docs')
    : resolve(root, 'apps/docs/i18n/en/docusaurus-plugin-content-docs/current');
  const files = listMdxFiles(docsRoot);
  const entries = files.map((path) => searchEntry(path, docsRoot, locale));
  outputs.set(resolve(root, `apps/docs/static/search/${locale}.json`), `${JSON.stringify({ schemaVersion: 1, locale, entries }, null, 2)}\n`);
}

let drift = false;
for (const [path, content] of outputs) {
  if (mode === '--write') {
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  } else if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
    console.error(`Generated documentation asset is stale: ${path}`);
    drift = true;
  }
}
if (drift) process.exitCode = 1;

function listMdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listMdxFiles(path) : entry.name.endsWith('.mdx') ? [path] : [];
  }).sort();
}

function searchEntry(path, docsRoot, locale) {
  const raw = readFileSync(path, 'utf8');
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? '';
  const id = field(frontmatter, 'id') || basename(path, '.mdx');
  const title = field(frontmatter, 'title') || raw.match(/^#\s+(.+)$/mu)?.[1] || id;
  const description = field(frontmatter, 'description');
  const headings = [...raw.matchAll(/^#{2,4}\s+(.+)$/gmu)].map((match) => match[1].replace(/[`*_]/gu, ''));
  const body = raw
    .replace(/^---[\s\S]*?---/u, '')
    .replace(/^import .+$/gmu, '')
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/[#>*_`[\](){}|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 2400);
  const relative = path.slice(docsRoot.length + 1).replaceAll('\\', '/').replace(/\.mdx$/u, '');
  return { id, title, description, headings, body, url: `${locale === 'en' ? '/en' : ''}/docs/${relative}` };
}

function field(frontmatter, key) {
  return frontmatter.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?$`, 'mu'))?.[1]?.trim() ?? '';
}
