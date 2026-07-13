import { readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const root = process.cwd();
const zhRoot = resolve(root, 'apps/docs/docs');
const enRoot = resolve(root, 'apps/docs/i18n/en/docusaurus-plugin-content-docs/current');
const zh = inventory(zhRoot);
const en = inventory(enRoot);
const failures = [];
if (JSON.stringify([...zh.keys()]) !== JSON.stringify([...en.keys()])) failures.push('zh-TW and English documentation filenames differ.');
for (const [file, item] of zh) {
  const translated = en.get(file);
  if (!translated || item.id !== translated.id) failures.push(`Documentation ID parity failed: ${file}`);
  if (!item.title || !item.description || !translated?.title || !translated.description) failures.push(`Frontmatter title/description is required in both locales: ${file}`);
}
for (const required of ['getting-started.mdx', 'vm-topology.mdx', 'install.mdx', 'first-login.mdx', 'runtime-pxe.mdx', 'software-test.mdx', 'lifecycle.mdx', 'architecture-security.mdx', 'api-migration.mdx', 'troubleshooting-evidence.mdx', 'release-license.mdx']) {
  if (!zh.has(required)) failures.push(`Required v2 documentation is missing: ${required}`);
}
const wizard = readFileSync(resolve(root, 'apps/docs/src/components/InstallationWizard.tsx'), 'utf8');
for (const marker of ['localStorage', 'schemaVersion: 1', 'Export JSON', 'Import JSON', 'TrustSelfSignedCertificate']) if (!wizard.includes(marker)) failures.push(`Installation wizard capability is missing: ${marker}`);
if (/password|token|secret/iu.test(JSON.stringify(JSON.parse(readFileSync(resolve(root, 'apps/docs/static/search/en.json'), 'utf8')).entries.map((entry) => Object.keys(entry))))) failures.push('Generated search schema contains a secret-like field name.');
const flow = readFileSync(resolve(root, 'apps/docs/src/components/FlowExplorer.tsx'), 'utf8');
for (const marker of ['prefers-reduced-motion', 'aria-live', "flowId", 'Pause']) if (!flow.includes(marker)) failures.push(`Flow explorer capability is missing: ${marker}`);
const config = readFileSync(resolve(root, 'apps/docs/docusaurus.config.ts'), 'utf8');
if (/algolia|analytics|telemetry/iu.test(config)) failures.push('External search or telemetry must not be configured.');
if (failures.length) { failures.forEach((failure) => console.error(failure)); process.exitCode = 1; }
else console.log(`Interactive docs: ${zh.size} bilingual pages with matching IDs.`);

function inventory(directory) {
  return new Map(readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.mdx')).map((entry) => {
    const raw = readFileSync(resolve(directory, entry.name), 'utf8');
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? '';
    const field = (name) => frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'mu'))?.[1]?.trim() ?? '';
    return [basename(entry.name), { id: field('id'), title: field('title'), description: field('description') }];
  }).sort(([left], [right]) => left.localeCompare(right)));
}
