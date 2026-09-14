import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const mac = (value) => String(value).replace(/[:-]/g, '').toUpperCase();
export function createCollector(config, { now = Date.now } = {}) {
  if (!config.testRunId || !/^[A-F0-9]{12}$/.test(mac(config.clientMac)) ||
      !config.machineId || !config.ticket || !Number.isFinite(Date.parse(config.expiresAt))) throw new Error('Invalid acceptance identity');
  const seen = new Set();
  const reports = new Map();
  let clientIp = config.clientIp;
  let runId;
  let bootId;
  const token = Buffer.from(config.ticket);
  const authenticate = (req) => {
    const supplied = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
    return now() < Date.parse(config.expiresAt) && supplied.length === token.length && crypto.timingSafeEqual(supplied, token);
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!authenticate(req)) return send(403, { error: 'Invalid or expired report ticket' });
    const source = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (clientIp && source !== clientIp) return send(403, { error: 'Client source mismatch' });
    if (req.method === 'GET' && req.url === '/command') {
      try {
        const command = fs.existsSync(config.commandPath) ? JSON.parse(fs.readFileSync(config.commandPath)) : { phase: 'wait' };
        return send(200, { phase: ['desktop-ready', 'post-stop', 'abort'].includes(command.phase) ? command.phase : 'wait' });
      } catch { return send(503, { error: 'Command unavailable' }); }
    }
    if (req.method !== 'POST' || req.url !== '/report') return send(404, { error: 'Report only' });
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) return send(413, { error: 'Report too large' }); chunks.push(chunk); }
      const report = JSON.parse(Buffer.concat(chunks));
      if (report.testRunId !== config.testRunId || mac(report.clientMac) !== mac(config.clientMac) ||
          String(report.machineId).toLowerCase() !== String(config.machineId).toLowerCase() ||
          !['baseline', 'post-stop', 'cleanup'].includes(report.phase) || !report.nonce || !report.runId || !report.bootId ||
          (runId && report.runId !== runId) || (bootId && report.bootId !== bootId) ||
          (config.bindSource && report.network?.ip !== source)) return send(403, { error: 'Report identity mismatch' });
      if (seen.has(report.nonce) || reports.has(report.phase)) return send(409, { error: 'Report replay' });
      if (report.phase === 'post-stop' && (!reports.has('baseline') ||
          !fs.existsSync(config.commandPath) || JSON.parse(fs.readFileSync(config.commandPath)).phase !== 'post-stop')) return send(409, { error: 'Report phase mismatch' });
      // Persist a closed schema: never echo or save caller-supplied credentials, commands or stacks.
      const safe = { testRunId: report.testRunId, clientMac: mac(report.clientMac), machineId: report.machineId,
        runId: String(report.runId), bootId: String(report.bootId), phase: report.phase,
        network: { ip: String(report.network?.ip ?? ''), prefixLength: Number(report.network?.prefixLength),
          gateway: String(report.network?.gateway ?? ''), dhcpServer: String(report.network?.dhcpServer ?? ''),
          dnsServers: (report.network?.dnsServers ?? []).map(String) },
        dns: report.dns === true, https: report.https === true, autoLogonCleared: report.autoLogonCleared === true,
        taskRemoved: report.taskRemoved === true, at: new Date(now()).toISOString() };
      clientIp ??= source; runId ??= report.runId; bootId ??= report.bootId;
      seen.add(report.nonce); reports.set(report.phase, safe);
      if (config.outputRoot) fs.writeFileSync(path.join(config.outputRoot, `${report.phase}.json`), JSON.stringify(safe, null, 2));
      return send(200, { accepted: true });
    } catch { return send(400, { error: 'Invalid report' }); }
  });
  return { server, reports };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(process.argv[2]));
  const { server } = createCollector(config);
  server.listen(config.port, config.host);
}
