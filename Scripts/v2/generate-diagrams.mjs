import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('docs/diagrams/flow-source.json', 'utf8'));
if (source.schemaVersion !== 1) throw new Error('Unsupported diagram source schema.');
const outputs = new Map([
  ['docs/manual-assets/operator-flow.svg', operator(source.operator['zh-TW'])],
  ['docs/manual-assets/operator-flow.en.svg', operator(source.operator.en)],
  ['docs/manual-assets/system-architecture.svg', architecture(source.architecture['zh-TW'])],
  ['docs/manual-assets/system-architecture.en.svg', architecture(source.architecture.en)],
]);
if (process.argv.includes('--write')) {
  for (const [path, content] of outputs) writeFileSync(path, content, 'utf8');
}
else if (process.argv.includes('--check')) {
  const drift = [...outputs].filter(([path, content]) => !existsSync(path) || readFileSync(path, 'utf8') !== content).map(([path]) => path);
  if (drift.length) throw new Error(`Generated diagram drift: ${drift.join(', ')}. Run npm run v2:diagrams:write.`);
}
else throw new Error('Use --write or --check.');

function operator(labels) {
  const positions = [[80,105],[570,105],[80,225],[570,225],[80,525],[570,525],[80,645],[570,645]];
  const boxes = labels.steps.map((label, index) => box(positions[index][0], positions[index][1], 450, 76, `${index + 1}`, label)).join('');
  return svg(1100, 890, labels.title, labels.subtitle, `${boxes}
    ${arrow(530,143,570,143)}<path class="arrow" d="M795 181V205H305V225"/>${arrow(530,263,570,263)}
    <path class="arrow" d="M795 301V350H550"/>
    <polygon class="gate" points="550,350 650,415 550,480 450,415"/><text class="t" x="550" y="410" text-anchor="middle">${escape(labels.gate)}</text>
    <path class="retry" d="M450 415H35V263H78"/><text class="small bad" x="45" y="400">${escape(labels.retry)}</text>
    <path class="arrow" d="M550 480V505H305V525"/><text class="small good" x="665" y="420">${escape(labels.continue)}</text>
    ${arrow(530,563,570,563)}<path class="arrow" d="M795 601V625H305V645"/>${arrow(530,683,570,683)}
    <rect class="branch" x="80" y="770" width="610" height="58" rx="12"/><text class="small" x="100" y="804">${escape(labels.softwareTest)}</text>
    <rect class="branch" x="720" y="770" width="300" height="58" rx="12"/><text class="small" x="740" y="804">${escape(labels.offline)}</text>`);
}

function architecture(labels) {
  const nodes = [
    [45, 130, 210, 78, labels.browser, 'node'], [320, 130, 300, 78, labels.web, 'web'],
    [690, 130, 365, 78, labels.agent, 'agent'], [320, 285, 300, 78, labels.ipc, 'pipe'],
    [45, 440, 250, 82, labels.state, 'node'], [320, 440, 250, 82, labels.files, 'node'],
    [600, 285, 260, 78, labels.adapters, 'node'], [600, 440, 260, 82, labels.runtime, 'runtime'],
    [885, 285, 170, 78, labels.data, 'runtime'], [885, 440, 170, 82, labels.clients, 'done'],
  ].map(([x, y, width, height, text, kind]) => multiBox(x, y, width, height, text, kind)).join('');
  const arrows = [[255,169,320,169],[620,169,690,169],[470,208,470,285],[620,324,690,208],[820,208,730,285],[730,363,730,440],[860,481,885,481],[970,363,970,440],[600,481,570,481],[320,481,295,481]]
    .map(([x1,y1,x2,y2]) => arrow(x1,y1,x2,y2)).join('');
  return svg(1100, 620, labels.title, 'Web management and PXE data plane are separate trust boundaries', `${nodes}${arrows}`);
}

function svg(width, height, title, subtitle, body) {
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title><desc id="desc">${escape(subtitle)}</desc>
  <defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto"><path d="M0 0L8 3.5 0 7Z" fill="#718096"/></marker></defs>
  <style>text{font-family:"Segoe UI","Noto Sans TC",sans-serif;fill:#1f2937}.bg{fill:#f7f2e9}.h{font-size:24px;font-weight:750}.sub{font-size:13px;fill:#6b7280}.node,.branch{fill:#fff;stroke:#cbd5e1;stroke-width:1.5}.web{fill:#e0f2fe;stroke:#0284c7}.agent{fill:#fee2e2;stroke:#dc2626}.pipe,.gate{fill:#fef3c7;stroke:#d97706}.runtime{fill:#ede9fe;stroke:#7c3aed}.done{fill:#dcfce7;stroke:#16a34a}.num{font-size:12px;font-weight:800;fill:#9c4221}.t{font-size:14px;font-weight:700}.small{font-size:12px}.bad{fill:#b91c1c}.good{fill:#15803d}.arrow{fill:none;stroke:#718096;stroke-width:2;marker-end:url(#a)}.retry{fill:none;stroke:#b91c1c;stroke-width:2;stroke-dasharray:6 5;marker-end:url(#a)}</style>
  <rect class="bg" width="${width}" height="${height}" rx="22"/><text class="h" x="${width/2}" y="43" text-anchor="middle">${escape(title)}</text><text class="sub" x="${width/2}" y="68" text-anchor="middle">${escape(subtitle)}</text>${body}
</svg>
`;
}

function box(x, y, width, height, number, label) {
  return `<rect class="node" x="${x}" y="${y}" width="${width}" height="${height}" rx="12"/><text class="num" x="${x + 18}" y="${y + 27}">${number}</text><text class="t" x="${x + width/2}" y="${y + 45}" text-anchor="middle">${escape(label)}</text>`;
}

function multiBox(x, y, width, height, text, kind) {
  const lines = String(text).split('\n');
  return `<rect class="${kind}" x="${x}" y="${y}" width="${width}" height="${height}" rx="12"/>${lines.map((line, index) => `<text class="${index === 0 ? 't' : 'small'}" x="${x + width/2}" y="${y + 31 + index * 22}" text-anchor="middle">${escape(line)}</text>`).join('')}`;
}

function arrow(x1, y1, x2, y2) { return `<path class="arrow" d="M${x1} ${y1}L${x2} ${y2}"/>`; }
function escape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
