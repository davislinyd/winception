import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TftpResponder,
  negotiateWindowSize,
  parseTftpRequest,
  resolveAbsoluteAck,
  resolveTftpPath,
} from '../src/tftp.js';

function rrq(fileName, mode = 'octet', options = {}) {
  const parts = [fileName, mode, ...Object.entries(options).flat()];
  return Buffer.concat(parts.flatMap((part) => [Buffer.from(part, 'ascii'), Buffer.from([0])]).toSpliced(0, 0, Buffer.from([0, 1])));
}

test('parses RRQ options', () => {
  const request = parseTftpRequest(rrq('ipxeboot/x86_64-sb/snponly.efi', 'octet', { blksize: '1468', tsize: '0' }));
  assert.equal(request.fileName, 'ipxeboot/x86_64-sb/snponly.efi');
  assert.equal(request.mode, 'octet');
  assert.equal(request.options.blksize, '1468');
  assert.equal(request.options.tsize, '0');
});

test('resolves TFTP paths inside root only', () => {
  const root = path.join(os.tmpdir(), 'tftp-root');
  assert.equal(resolveTftpPath(root, '../secret'), null);
  assert.equal(resolveTftpPath(root, 'C:/secret'), null);
  assert.ok(resolveTftpPath(root, '/ipxeboot/snponly.efi').startsWith(path.resolve(root)));
});

test('resolves bootmgr-style backslash paths', () => {
  const root = path.join(os.tmpdir(), 'tftp-root');
  assert.equal(resolveTftpPath(root, '\\Boot\\BCD'), path.resolve(root, 'Boot/BCD'));
  assert.equal(resolveTftpPath(root, '\\sources\\boot.wim'), path.resolve(root, 'sources/boot.wim'));
});

test('negotiates window size', () => {
  assert.equal(negotiateWindowSize({}), 1);
  assert.equal(negotiateWindowSize({ windowsize: 'junk' }), 1);
  assert.equal(negotiateWindowSize({ windowsize: '16' }), 16);
  assert.equal(negotiateWindowSize({ windowsize: '0' }), 1);
  assert.equal(negotiateWindowSize({ windowsize: '500' }), 64);
});

test('resolves wrapped ACK block numbers to absolute blocks', () => {
  assert.equal(resolveAbsoluteAck(8, 5, 20), 8);
  assert.equal(resolveAbsoluteAck(4, 5, 20), 4); // duplicate ACK of previous window tail
  assert.equal(resolveAbsoluteAck(30, 5, 20), null); // beyond window
  assert.equal(resolveAbsoluteAck(9, 65530, 65545), 65545); // 65545 & 0xffff === 9
  assert.equal(resolveAbsoluteAck(65529, 65530, 65545), 65529); // duplicate ACK across wrap
  assert.equal(resolveAbsoluteAck(131080 & 0xffff, 131073, 131088), 131080); // second wrap
});

function ackPacket(block) {
  return Buffer.from([0, 4, (block >>> 8) & 0xff, block & 0xff]);
}

// Minimal RFC 7440 client: ACKs the last block of each window; on a gap it re-ACKs
// the last in-order block once, then waits for the server to roll the window back.
function tftpFetch({ host, port, fileName, blksize, windowsize, dropBlock = null }) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const chunks = [];
    let expected = 1;
    let sinceAck = 0;
    let lastReackFor = 0;
    let dropArmed = dropBlock !== null;
    let serverPort = null;
    let finished = false;

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('tftp fetch timed out'));
    }, 20000);

    function send(packet) {
      socket.send(packet, serverPort, host);
    }

    function finish() {
      finished = true;
      clearTimeout(timer);
      // Linger briefly so a retransmitted final window can be re-ACKed before close.
      setTimeout(() => {
        socket.close();
        resolve({ data: Buffer.concat(chunks), dropped: dropBlock !== null && !dropArmed });
      }, 100);
    }

    socket.on('message', (packet, remote) => {
      if (finished) {
        return;
      }
      const opCode = (packet[0] << 8) | packet[1];
      serverPort = remote.port;
      if (opCode === 6) {
        send(ackPacket(0));
        return;
      }
      if (opCode === 5) {
        clearTimeout(timer);
        socket.close();
        reject(new Error(`tftp error: ${packet.subarray(4).toString('ascii')}`));
        return;
      }
      if (opCode !== 3) {
        return;
      }

      const wrapped = (packet[2] << 8) | packet[3];
      const delta = (wrapped - (expected & 0xffff)) & 0xffff;
      const payload = packet.subarray(4);

      if (delta !== 0) {
        // Gap (we dropped a block) or stale retransmit: re-ACK last in-order block once.
        if (lastReackFor !== expected) {
          lastReackFor = expected;
          sinceAck = 0;
          send(ackPacket((expected - 1) & 0xffff));
        }
        return;
      }

      if (dropArmed && expected === dropBlock) {
        dropArmed = false;
        return;
      }

      chunks.push(Buffer.from(payload));
      expected += 1;
      sinceAck += 1;

      if (payload.length < blksize) {
        send(ackPacket((expected - 1) & 0xffff));
        finish();
      } else if (sinceAck >= windowsize) {
        sinceAck = 0;
        send(ackPacket((expected - 1) & 0xffff));
      }
    });

    socket.bind(0, host, () => {
      const parts = [fileName, 'octet', 'tsize', '0', 'blksize', String(blksize), 'windowsize', String(windowsize)];
      const payload = Buffer.concat(parts.flatMap((part) => [Buffer.from(part, 'ascii'), Buffer.from([0])]));
      const rrqPacket = Buffer.concat([Buffer.from([0, 1]), payload]);
      socket.send(rrqPacket, port, host);
    });
  });
}

async function withResponder(files, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tftp-test-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), contents);
  }
  const responder = new TftpResponder({ root, listenIp: '127.0.0.1', port: 0, logPath: null });
  await responder.start();
  try {
    return await run({ responder, root, port: responder.socket.address().port });
  } finally {
    await responder.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('serves a windowed transfer byte-for-byte', async () => {
  const contents = crypto.randomBytes((512 * 37) + 123); // multiple windows + short final block
  await withResponder({ 'sources_boot.wim': contents }, async ({ port }) => {
    const { data } = await tftpFetch({
      host: '127.0.0.1',
      port,
      fileName: 'sources_boot.wim',
      blksize: 512,
      windowsize: 4,
    });
    assert.equal(data.length, contents.length);
    assert.ok(data.equals(contents));
  });
});

test('rolls the window back when the client reports a lost block', async () => {
  const contents = crypto.randomBytes(512 * 32); // block-aligned: exercises the zero-byte final block
  await withResponder({ 'payload.bin': contents }, async ({ port }) => {
    const { data, dropped } = await tftpFetch({
      host: '127.0.0.1',
      port,
      fileName: 'payload.bin',
      blksize: 512,
      windowsize: 8,
      dropBlock: 6,
    });
    assert.equal(dropped, true);
    assert.ok(data.equals(contents));
  });
});

test('survives block-number wrap past 65535', async () => {
  const contents = crypto.randomBytes((8 * 70000) + 5); // 70001 blocks at blksize 8
  await withResponder({ 'big.bin': contents }, async ({ port }) => {
    const { data } = await tftpFetch({
      host: '127.0.0.1',
      port,
      fileName: 'big.bin',
      blksize: 8,
      windowsize: 64,
    });
    assert.equal(data.length, contents.length);
    assert.ok(data.equals(contents));
  });
});

test('lock-step transfer still works without windowsize option', async () => {
  const contents = crypto.randomBytes((512 * 3) + 17);
  await withResponder({ 'small.bin': contents }, async ({ port }) => {
    const data = await new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const chunks = [];
      let serverPort = null;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('lock-step fetch timed out'));
      }, 10000);
      socket.on('message', (packet, remote) => {
        const opCode = (packet[0] << 8) | packet[1];
        serverPort = remote.port;
        if (opCode === 6) {
          socket.send(ackPacket(0), serverPort, '127.0.0.1');
          return;
        }
        if (opCode !== 3) {
          return;
        }
        const block = (packet[2] << 8) | packet[3];
        const payload = packet.subarray(4);
        chunks.push(Buffer.from(payload));
        socket.send(ackPacket(block), serverPort, '127.0.0.1');
        if (payload.length < 512) {
          clearTimeout(timer);
          setTimeout(() => {
            socket.close();
            resolve(Buffer.concat(chunks));
          }, 50);
        }
      });
      socket.bind(0, '127.0.0.1', () => {
        const parts = ['small.bin', 'octet', 'blksize', '512'];
        const payload = Buffer.concat(parts.flatMap((part) => [Buffer.from(part, 'ascii'), Buffer.from([0])]));
        socket.send(Buffer.concat([Buffer.from([0, 1]), payload]), port, '127.0.0.1');
      });
    });
    assert.ok(data.equals(contents));
  });
});
