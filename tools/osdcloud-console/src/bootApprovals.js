import crypto from 'node:crypto';
import { ipv4ToUInt32 } from './dhcp.js';

/** Pairing code computed independently by WinPE and the host. */
export function bootPairingCode(key, nonce, bootId) {
  const digest = crypto.createHash('sha256').update(`${key.n}\n${key.e}\n${nonce}\n${bootId}`, 'utf8').digest('hex');
  return digest.slice(0, 12).toUpperCase().match(/.{4}/gu).join('-');
}

export function isInClientSubnet(address, serverIp, prefixLength) {
  const prefix = Number(prefixLength);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return false;
  try {
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4ToUInt32(address) & mask) === (ipv4ToUInt32(serverIp) & mask);
  } catch { return false; }
}

/** In-memory, bounded authorizations for one boot on an existing-DHCP LAN. */
export class BootApprovals {
  constructor({ now = Date.now, ttlMs = 600_000, limit = 100 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.limit = limit;
    this.requests = new Map();
  }

  purge() {
    const now = this.now();
    for (const [id, request] of this.requests) {
      if (request.expiresAt <= now) request.status = 'expired';
      // Keep a bounded tombstone so a timed-out poll cannot recreate an approval.
      if (request.expiresAt + this.ttlMs <= now) this.requests.delete(id);
    }
  }

  submit(identity) {
    this.purge();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    let request = [...this.requests.values()].find((item) => item.fingerprint === fingerprint);
    if (request && !['pending', 'approved'].includes(request.status)) {
      throw new Error('Client pairing was rejected, expired, or already used. Boot the client again.');
    }
    if (!request) {
      if (this.requests.size >= this.limit) throw new Error('Client pairing queue is full. Try again later.');
      request = { ...identity, fingerprint, requestId: crypto.randomUUID(),
        pairingCode: bootPairingCode(identity.key, identity.nonce, identity.bootId),
        status: 'pending', expiresAt: this.now() + this.ttlMs };
      this.requests.set(request.requestId, request);
    }
    return request;
  }

  list() {
    this.purge();
    return [...this.requests.values()].filter((item) => item.status === 'pending').map((item) => ({
      requestId: item.requestId, pairingCode: item.pairingCode, clientId: item.clientId,
      clientMac: item.clientMac, clientIp: item.remoteIp, bootId: item.bootId, runId: item.runId,
      expiresAt: new Date(item.expiresAt).toISOString(),
    }));
  }

  decide(requestId, approved, pairingCode = '') {
    this.purge();
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') throw new Error('Client pairing is no longer pending.');
    if (approved && pairingCode !== request.pairingCode) throw new Error('Client pairing code does not match.');
    request.status = approved ? 'approved' : 'rejected';
    return { requestId, status: request.status };
  }

  issue(requestId, expiresAt) {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'approved' || request.expiresAt <= this.now()) {
      throw new Error('Client pairing is not approved.');
    }
    request.status = 'issued';
    request.expiresAt = expiresAt;
  }

  valid(session) {
    const request = this.requests.get(session.approvalId);
    return request?.status === 'issued' && request.expiresAt > this.now()
      && request.key.n === session.key?.n && request.key.e === session.key?.e
      && ['remoteIp', 'clientMac', 'bootId', 'nonce', 'clientId', 'runId'].every((field) => request[field] === session[field]);
  }

  revoke(requestId) {
    const request = this.requests.get(requestId);
    if (request) request.status = 'rejected';
  }

  clear() { this.requests.clear(); }
}
