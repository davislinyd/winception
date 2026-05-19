import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parseTftpRequest, resolveTftpPath } from '../src/tftp.js';

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
