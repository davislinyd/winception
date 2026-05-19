import { loadConfig, mediaHttpServerConfig } from './config.js';
import { DhcpResponder } from './dhcp.js';
import { MediaHttpServer } from './httpServer.js';
import { TftpResponder } from './tftp.js';

const config = loadConfig();
const dhcp = new DhcpResponder(config.dhcp);
const tftp = new TftpResponder(config.tftp);
const http = new MediaHttpServer(mediaHttpServerConfig(config));

async function stop() {
  await Promise.allSettled([dhcp.stop(), tftp.stop(), http.stop()]);
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await http.start();
await tftp.start();
await dhcp.start();

console.log(
  `headless services started http=${config.http.host}:${config.http.port} ` +
    `tftp=${config.tftp.listenIp}:${config.tftp.port} ` +
    `dhcp=${config.dhcp.listenIp}:${config.dhcp.listenPort}`,
);

setInterval(() => {}, 2147483647);
