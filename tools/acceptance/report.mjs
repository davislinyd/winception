import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
export function sourceFingerprint(root = process.cwd()) {
  const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split('\n'))]
    .filter(file=>file && !file.startsWith('.ai/') && !file.startsWith('test-results/') && fs.existsSync(path.join(root,file))).sort();
  const hash=crypto.createHash('sha256');
  for(const file of files){hash.update(file+'\0');hash.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest());}
  return hash.digest('hex').toUpperCase();
}
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function networkPassed(report, expected) {
  const address = report?.network;
  const validIp = (ip) => typeof ip === 'string' && /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255);
  if (!address || report.dns !== true || report.https !== true || address.prefixLength !== expected.prefixLength ||
      address.gateway !== expected.gateway || address.dhcpServer !== expected.dhcpServer ||
      !Number.isInteger(expected.prefixLength) || expected.prefixLength < 1 || expected.prefixLength > 30 ||
      !validIp(address.ip) || !validIp(expected.subnet.split('/')[0]) || !Array.isArray(address.dnsServers)) return false;
  const octets = (ip) => ip.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0);
  const mask = (0xffffffff << (32 - expected.prefixLength)) >>> 0;
  return (octets(address.ip) & mask) === (octets(expected.subnet.split('/')[0]) & mask) &&
    [...address.dnsServers].sort().join(',') === [...expected.dnsServers].sort().join(',');
}
export function writeReport(root, report) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'result.html'), `<!doctype html><meta charset="utf-8"><title>Winception acceptance</title><h1>Winception 自動驗收</h1><pre>${escape(JSON.stringify(report, null, 2))}</pre>`);
}
