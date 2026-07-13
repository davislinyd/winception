import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const limits = new Map([['AGENTS.md', 1500]]);
for (const entry of readdirSync('docs/agent-reference', { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) limits.set(join('docs/agent-reference', entry.name), 2000);
}
const failures = [];
for (const [path, limit] of limits) {
  const content = readFileSync(path, 'utf8');
  const cjk = [...content.matchAll(/[\u3400-\u9fff]/gu)].length;
  const nonCjk = content.replace(/[\u3400-\u9fff]/gu, '').length;
  const estimate = cjk + Math.ceil(nonCjk / 4);
  if (estimate > limit) failures.push(`${path}: estimated ${estimate} tokens exceeds ${limit}`);
}
if (failures.length) throw new Error(failures.join('\n'));
process.stdout.write('Agent documentation budgets passed.\n');
