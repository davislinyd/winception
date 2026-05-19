import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { appendLog } from './logger.js';

export function newTftpPacket(opCode, payload = Buffer.alloc(0)) {
  const packet = Buffer.alloc(2 + payload.length);
  packet[0] = (opCode >>> 8) & 0xff;
  packet[1] = opCode & 0xff;
  payload.copy(packet, 2);
  return packet;
}

function stringPayload(parts) {
  return Buffer.concat(parts.flatMap((part) => [Buffer.from(part, 'ascii'), Buffer.from([0])]));
}

export function parseTftpRequest(packet) {
  if (packet.length < 4) {
    return null;
  }
  const opCode = (packet[0] << 8) | packet[1];
  if (opCode !== 1) {
    return null;
  }

  const parts = [];
  let start = 2;
  for (let i = 2; i < packet.length; i += 1) {
    if (packet[i] === 0) {
      parts.push(packet.subarray(start, i).toString('ascii'));
      start = i + 1;
    }
  }
  if (parts.length < 2) {
    return null;
  }

  const options = {};
  for (let i = 2; i + 1 < parts.length; i += 2) {
    options[parts[i].toLowerCase()] = parts[i + 1];
  }

  return {
    fileName: parts[0],
    mode: parts[1],
    options,
  };
}

export function resolveTftpPath(rootPath, requestPath) {
  const relative = String(requestPath ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!relative || /(^|\/)\.\.(\/|$)/.test(relative) || relative.includes(':')) {
    return null;
  }

  const rootFull = path.resolve(rootPath);
  const fileFull = path.resolve(rootFull, relative);
  const rootWithSeparator = rootFull.endsWith(path.sep) ? rootFull : `${rootFull}${path.sep}`;
  if (fileFull !== rootFull && !fileFull.startsWith(rootWithSeparator)) {
    return null;
  }
  return fileFull;
}

function tftpErrorPacket(code, message) {
  const messageBytes = Buffer.from(message, 'ascii');
  const payload = Buffer.alloc(2 + messageBytes.length + 1);
  payload[0] = (code >>> 8) & 0xff;
  payload[1] = code & 0xff;
  messageBytes.copy(payload, 2);
  return newTftpPacket(5, payload);
}

function parseAck(packet) {
  if (packet.length < 4) {
    return null;
  }
  const opCode = (packet[0] << 8) | packet[1];
  if (opCode !== 4) {
    return null;
  }
  return (packet[2] << 8) | packet[3];
}

function waitForAck(socket, endpoint, expectedBlock, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      resolve(false);
    }, timeoutMs);

    function onMessage(packet, remote) {
      if (remote.address !== endpoint.address || remote.port !== endpoint.port) {
        return;
      }
      const block = parseAck(packet);
      if (block !== (expectedBlock & 0xffff)) {
        return;
      }
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(true);
    }

    socket.on('message', onMessage);
  });
}

function negotiateBlockSize(options) {
  if (!Object.hasOwn(options, 'blksize')) {
    return 512;
  }
  const requested = Number.parseInt(options.blksize, 10);
  if (!Number.isInteger(requested)) {
    return 512;
  }
  return Math.max(8, Math.min(requested, 1468));
}

async function sendPacketWithRetry(socket, packet, endpoint, expectedAckBlock, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    socket.send(packet, endpoint.port, endpoint.address);
    const acked = await waitForAck(socket, endpoint, expectedAckBlock, 3000);
    if (acked) {
      return true;
    }
  }
  return false;
}

async function sendFile({ filePath, request, endpoint, listenIp, onLog }) {
  const stats = fs.statSync(filePath);
  const transferSocket = dgram.createSocket('udp4');
  const options = path.extname(filePath).toLowerCase() === '.ipxe' ? {} : request.options;
  const blockSize = negotiateBlockSize(options);

  await new Promise((resolve) => transferSocket.bind(0, listenIp, resolve));

  try {
    const oackParts = [];
    if (Object.hasOwn(options, 'tsize')) {
      oackParts.push('tsize', String(stats.size));
    }
    if (Object.hasOwn(options, 'blksize')) {
      oackParts.push('blksize', String(blockSize));
    }

    if (oackParts.length > 0) {
      const oack = newTftpPacket(6, stringPayload(oackParts));
      const acked = await sendPacketWithRetry(transferSocket, oack, endpoint, 0, 6);
      if (!acked) {
        onLog(`OACK not acknowledged by ${endpoint.address}:${endpoint.port} for ${path.basename(filePath)}`);
        return;
      }
    }

    const file = fs.openSync(filePath, 'r');
    try {
      let block = 1;
      let position = 0;
      let read = 0;
      do {
        const chunk = Buffer.alloc(blockSize);
        read = fs.readSync(file, chunk, 0, blockSize, position);
        position += read;
        const payload = Buffer.alloc(2 + read);
        payload[0] = (block >>> 8) & 0xff;
        payload[1] = block & 0xff;
        chunk.copy(payload, 2, 0, read);
        const data = newTftpPacket(3, payload);
        const acked = await sendPacketWithRetry(transferSocket, data, endpoint, block);
        if (!acked) {
          onLog(`DATA block ${block} not acknowledged by ${endpoint.address}:${endpoint.port} for ${path.basename(filePath)}`);
          return;
        }
        block = (block + 1) & 0xffff;
      } while (read === blockSize);
    } finally {
      fs.closeSync(file);
    }

    onLog(`SENT ${path.basename(filePath)} bytes=${stats.size} blockSize=${blockSize} to ${endpoint.address}:${endpoint.port}`);
  } finally {
    transferSocket.close();
  }
}

export class TftpResponder extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
  }

  get running() {
    return Boolean(this.socket);
  }

  log(message) {
    const line = appendLog(this.config.logPath, message);
    this.emit('log', line);
  }

  async start() {
    if (this.socket) {
      return;
    }

    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (error) => {
      this.log(`ERROR ${error.message}`);
      this.emit('error', error);
    });
    this.socket.on('message', (packet, remote) => this.handlePacket(packet, remote));

    await new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.config.port ?? 69, this.config.listenIp, () => {
        this.socket.off('error', reject);
        this.log(`TFTP responder starting on ${this.config.listenIp}:${this.config.port ?? 69} root=${this.config.root}`);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = null;
    await new Promise((resolve) => socket.close(resolve));
    this.log('TFTP responder stopped');
  }

  handlePacket(packet, remote) {
    const request = parseTftpRequest(packet);
    if (!request) {
      return;
    }

    const filePath = resolveTftpPath(this.config.root, request.fileName);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      this.log(`MISS ${request.fileName} from ${remote.address}:${remote.port}`);
      this.socket.send(tftpErrorPacket(1, 'File not found'), remote.port, remote.address);
      return;
    }

    this.log(`RRQ ${request.fileName} from ${remote.address}:${remote.port}`);
    sendFile({
      filePath,
      request,
      endpoint: remote,
      listenIp: this.config.listenIp,
      onLog: (message) => this.log(message),
    }).catch((error) => {
      this.log(`ERROR transfer=${request.fileName} message=${error.message}`);
    });
  }
}
