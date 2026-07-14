import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { appendLog } from './logger.js';

export function ipv4ToBytes(address) {
  return address.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Invalid IPv4 address: ${address}`);
    }
    return value;
  });
}

export function ipv4ToUInt32(address) {
  return ipv4ToBytes(address).reduce((value, byte) => ((value << 8) | byte) >>> 0, 0);
}

export function uint32ToIPv4(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

export function uint32ToBytes(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

export function broadcastAddress(address, mask) {
  const addressValue = ipv4ToUInt32(address);
  const maskValue = ipv4ToUInt32(mask);
  return uint32ToIPv4(((addressValue & maskValue) | (~maskValue >>> 0)) >>> 0);
}

export function getDhcpOptionValue(packet, optionCode) {
  for (let i = 240; i < packet.length;) {
    const code = packet[i];
    if (code === 255) {
      break;
    }
    if (code === 0) {
      i += 1;
      continue;
    }
    if (i + 1 >= packet.length) {
      break;
    }
    const length = packet[i + 1];
    if (i + 2 + length > packet.length) {
      break;
    }
    if (code === optionCode) {
      return packet.subarray(i + 2, i + 2 + length);
    }
    i += 2 + length;
  }
  return null;
}

export function getDhcpMessageType(packet) {
  const value = getDhcpOptionValue(packet, 53);
  return value && value.length > 0 ? value[0] : 0;
}

export function getRequestedIp(packet) {
  const value = getDhcpOptionValue(packet, 50);
  if (!value || value.length !== 4) {
    return null;
  }
  return [...value].join('.');
}

export function getClientMac(packet) {
  const hardwareLength = Math.max(1, Math.min(Number(packet[2] || 0), 16));
  const bytes = packet.subarray(28, 28 + hardwareLength);
  return [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('-');
}

export function normalizeMacAddress(mac) {
  const hex = String(mac ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 12) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return hex.match(/.{2}/g).join('-');
}

export function isIpxeClient(packet) {
  if (getDhcpOptionValue(packet, 175)) {
    return true;
  }

  for (const optionCode of [60, 77]) {
    const value = getDhcpOptionValue(packet, optionCode);
    if (value && Buffer.from(value).toString('ascii').includes('iPXE')) {
      return true;
    }
  }

  return false;
}

export function isPxeClient(packet) {
  const value = getDhcpOptionValue(packet, 60);
  return value ? Buffer.from(value).toString('ascii').startsWith('PXEClient') : false;
}

export function effectiveBootFile(config, ipxeClient) {
  if ((config.bootMode ?? 'secureboot') === 'secureboot') {
    // Microsoft-signed boot chain: always hand out the signed boot manager, even to
    // clients claiming to be iPXE — the secureboot path never chains through HTTP.
    return config.secureBootFile ?? 'bootmgfw.efi';
  }
  return ipxeClient ? config.ipxeBootUrl : config.bootFile;
}

function addOption(options, code, value) {
  if (value.length > 255) {
    throw new Error(`DHCP option ${code} is too long: ${value.length} bytes`);
  }
  options.push(code, value.length, ...value);
}

function dnsOptionBytes(servers) {
  return servers.flatMap(ipv4ToBytes);
}

function pxeVendorOption(serverIp) {
  const bytes = [];
  const addSubOption = (code, value) => bytes.push(code, value.length, ...value);
  const serverBytes = ipv4ToBytes(serverIp);
  const menuText = [...Buffer.from('iPXE', 'ascii')];
  const promptText = [...Buffer.from('Boot iPXE', 'ascii')];
  addSubOption(6, [7]);
  addSubOption(8, [0, 0, 1, ...serverBytes]);
  addSubOption(9, [0, 0, menuText.length, ...menuText]);
  addSubOption(10, [0, ...promptText]);
  bytes.push(255);
  return bytes;
}

export class LeasePool {
  constructor(startIp, endIp, reservations = []) {
    this.start = ipv4ToUInt32(startIp);
    this.end = ipv4ToUInt32(endIp);
    if (this.end < this.start) {
      throw new Error(`LeaseEndIp must be greater than or equal to LeaseStartIp: ${startIp} - ${endIp}`);
    }
    this.byMac = new Map();
    this.reservations = new Map();
    this.reservedIps = new Map();

    for (const reservation of reservations ?? []) {
      const mac = normalizeMacAddress(reservation.mac ?? reservation.Mac ?? reservation.macAddress ?? reservation.MacAddress);
      const ip = String(reservation.ip ?? reservation.IP ?? reservation.ipAddress ?? reservation.IPAddress ?? '').trim();
      ipv4ToUInt32(ip);
      if (this.reservedIps.has(ip) && this.reservedIps.get(ip) !== mac) {
        throw new Error(`DHCP reservation IP ${ip} is assigned to multiple MAC addresses`);
      }
      this.reservations.set(mac, ip);
      this.reservedIps.set(ip, mac);
    }
  }

  hasAddress(address) {
    if (!address) {
      return false;
    }
    const value = ipv4ToUInt32(address);
    return value >= this.start && value <= this.end;
  }

  isLeased(address, requestMac) {
    const normalizedMac = normalizeMacAddress(requestMac);
    if (this.reservedIps.has(address) && this.reservedIps.get(address) !== normalizedMac) {
      return true;
    }

    for (const [mac, leasedAddress] of this.byMac.entries()) {
      if (mac !== normalizedMac && leasedAddress === address) {
        return true;
      }
    }
    return false;
  }

  getLease(mac, requestedIp) {
    const normalizedMac = normalizeMacAddress(mac);
    const reservedIp = this.reservations.get(normalizedMac);
    if (reservedIp) {
      this.byMac.set(normalizedMac, reservedIp);
      return reservedIp;
    }

    if (this.byMac.has(normalizedMac)) {
      return this.byMac.get(normalizedMac);
    }

    if (this.hasAddress(requestedIp) && !this.isLeased(requestedIp, normalizedMac)) {
      this.byMac.set(normalizedMac, requestedIp);
      return requestedIp;
    }

    for (let candidate = this.start; candidate <= this.end; candidate += 1) {
      const candidateIp = uint32ToIPv4(candidate >>> 0);
      if (!this.isLeased(candidateIp, normalizedMac)) {
        this.byMac.set(normalizedMac, candidateIp);
        return candidateIp;
      }
    }

    throw new Error('No available DHCP leases');
  }
}

export function newProxyDhcpReply(request, messageType, config) {
  const ipxeClient = isIpxeClient(request);
  const bootFile = effectiveBootFile(config, ipxeClient);
  const reply = Buffer.alloc(240);
  reply[0] = 2;
  reply[1] = request[1];
  reply[2] = request[2];
  reply[3] = 0;
  request.copy(reply, 4, 4, 8);
  request.copy(reply, 8, 8, 12);
  // yiaddr = 0.0.0.0 — proxy mode does not assign an IP
  Buffer.from(ipv4ToBytes(config.listenIp)).copy(reply, 20);
  request.copy(reply, 28, 28, 44);
  Buffer.from(bootFile, 'ascii').copy(reply, 108, 0, Math.min(Buffer.byteLength(bootFile), 128));
  reply[236] = 99;
  reply[237] = 130;
  reply[238] = 83;
  reply[239] = 99;

  const options = [];
  addOption(options, 53, [messageType]);
  addOption(options, 54, ipv4ToBytes(config.listenIp));
  addOption(options, 60, [...Buffer.from('PXEClient', 'ascii')]);
  addOption(options, 66, [...Buffer.from(config.listenIp, 'ascii')]);
  addOption(options, 67, [...Buffer.from(bootFile, 'ascii')]);
  if (!ipxeClient) {
    addOption(options, 43, pxeVendorOption(config.listenIp));
  }
  options.push(255);
  return Buffer.concat([reply, Buffer.from(options)]);
}

export function newDhcpReply(request, messageType, assignedIp, effectiveBootFile, ipxeClient, config) {
  const reply = Buffer.alloc(240);
  reply[0] = 2;
  reply[1] = request[1];
  reply[2] = request[2];
  reply[3] = 0;
  request.copy(reply, 4, 4, 8);
  request.copy(reply, 8, 8, 12);
  Buffer.from(ipv4ToBytes(assignedIp)).copy(reply, 16);
  Buffer.from(ipv4ToBytes(config.listenIp)).copy(reply, 20);
  request.copy(reply, 28, 28, 44);
  Buffer.from(effectiveBootFile, 'ascii').copy(reply, 108, 0, Math.min(Buffer.byteLength(effectiveBootFile), 128));
  reply[236] = 99;
  reply[237] = 130;
  reply[238] = 83;
  reply[239] = 99;

  const options = [];
  addOption(options, 53, [messageType]);
  addOption(options, 54, ipv4ToBytes(config.listenIp));
  addOption(options, 51, uint32ToBytes(config.leaseSeconds ?? 3600));
  addOption(options, 1, ipv4ToBytes(config.subnetMask));
  addOption(options, 3, ipv4ToBytes(config.router));
  addOption(options, 6, dnsOptionBytes(config.dnsServers ?? []));
  addOption(options, 28, ipv4ToBytes(broadcastAddress(config.listenIp, config.subnetMask)));
  addOption(options, 60, [...Buffer.from('PXEClient', 'ascii')]);
  addOption(options, 66, [...Buffer.from(config.listenIp, 'ascii')]);
  addOption(options, 67, [...Buffer.from(effectiveBootFile, 'ascii')]);
  options.push(255);
  return Buffer.concat([reply, Buffer.from(options)]);
}

export class DhcpResponder extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
    this.sendSocket = null;
    this.leasePool = null;
    this.leasePoolKey = null;
    this.refreshLeasePool();
  }

  get running() {
    return Boolean(this.socket);
  }

  log(message) {
    const line = appendLog(this.config.logPath, message);
    this.emit('log', line);
  }

  refreshLeasePool() {
    if ((this.config.dhcpMode ?? 'server') === 'proxy') {
      this.leasePool = null;
      this.leasePoolKey = null;
      return;
    }
    const nextKey = `${this.config.leaseStartIp}-${this.config.leaseEndIp}-${JSON.stringify(this.config.reservations ?? [])}`;
    if (this.leasePool && this.leasePoolKey === nextKey) {
      return;
    }

    this.leasePool = new LeasePool(this.config.leaseStartIp, this.config.leaseEndIp, this.config.reservations);
    this.leasePoolKey = nextKey;
  }

  async start() {
    if (this.socket) {
      return;
    }

    this.refreshLeasePool();
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', (error) => {
      this.log(`ERROR ${error.message}`);
      this.emit('error', error);
    });
    this.socket.on('message', (packet) => this.handlePacket(packet));

    await new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      // Windows delivers the initial DHCP broadcast only to an INADDR_ANY socket.
      // Endpoint sync limits UDP 67 to the selected PXE interface in Windows Firewall.
      this.socket.bind(this.config.listenPort ?? 67, '0.0.0.0', () => {
        this.socket.off('error', reject);
        this.socket.setBroadcast(true);
        if ((this.config.dhcpMode ?? 'server') === 'proxy') {
          this.log(`PXE proxy starting on ${this.config.listenIp} mode=${this.config.bootMode ?? 'secureboot'} boot=${effectiveBootFile(this.config, false)}`);
        } else {
          this.log(`DHCP responder starting on ${this.config.listenIp} leases=${this.config.leaseStartIp}-${this.config.leaseEndIp} router=${this.config.router} dns=${(this.config.dnsServers ?? []).join(',')} mode=${this.config.bootMode ?? 'secureboot'} boot=${effectiveBootFile(this.config, false)} ipxe=${this.config.ipxeBootUrl}`);
        }
        resolve();
      });
    });

    this.sendSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.sendSocket.on('error', (error) => {
      this.log(`ERROR ${error.message}`);
      this.emit('error', error);
    });
    try {
      await new Promise((resolve, reject) => {
        this.sendSocket.once('error', reject);
        this.sendSocket.bind(this.config.listenPort ?? 67, this.config.listenIp, () => {
          this.sendSocket.off('error', reject);
          this.sendSocket.setBroadcast(true);
          resolve();
        });
      });
    } catch (error) {
      const socket = this.socket;
      const sendSocket = this.sendSocket;
      this.socket = null;
      this.sendSocket = null;
      await new Promise((resolve) => socket.close(resolve));
      try {
        sendSocket.close();
      } catch {
        // A bind failure can leave the socket unopened.
      }
      throw error;
    }
  }

  async stop() {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    const sendSocket = this.sendSocket;
    this.socket = null;
    this.sendSocket = null;
    await Promise.all([
      new Promise((resolve) => socket.close(resolve)),
      sendSocket ? new Promise((resolve) => sendSocket.close(resolve)) : Promise.resolve(),
    ]);
    this.log('DHCP responder stopped');
  }

  handlePacket(packet) {
    if (!this.socket || packet.length < 240) {
      return;
    }

    const messageType = getDhcpMessageType(packet);
    const mac = getClientMac(packet);

    if (messageType !== 1 && messageType !== 3) {
      return;
    }

    if ((this.config.dhcpMode ?? 'server') === 'proxy') {
      if (!isPxeClient(packet)) {
        return;
      }
      try {
        const replyType = messageType === 1 ? 2 : 5;
        const reply = newProxyDhcpReply(packet, replyType, this.config);
        (this.sendSocket ?? this.socket).send(
          reply,
          this.config.replyPort ?? 68,
          '255.255.255.255',
        );
        const bootFile = effectiveBootFile(this.config, isIpxeClient(packet));
        this.log(`${messageType === 1 ? 'PROXY-OFFER' : 'PROXY-ACK'} to ${mac} boot=${bootFile}`);
      } catch (error) {
        this.log(`ERROR proxy type=${messageType === 1 ? 'DISCOVER' : 'REQUEST'} from ${mac} message=${error.message}`);
      }
      return;
    }

    const requestedIp = getRequestedIp(packet);
    const ipxeClient = isIpxeClient(packet);
    const bootFile = effectiveBootFile(this.config, ipxeClient);

    try {
      const assignedIp = this.leasePool.getLease(mac, requestedIp);
      const replyType = messageType === 1 ? 2 : 5;
      const reply = newDhcpReply(packet, replyType, assignedIp, bootFile, ipxeClient, this.config);
      (this.sendSocket ?? this.socket).send(
        reply,
        this.config.replyPort ?? 68,
        '255.255.255.255',
      );

      this.log(`${messageType === 1 ? 'OFFER' : 'ACK'} ${assignedIp} to ${mac} requested=${requestedIp} boot=${bootFile}`);
    } catch (error) {
      this.log(`ERROR type=${messageType === 1 ? 'DISCOVER' : 'REQUEST'} from ${mac} requested=${requestedIp} message=${error.message}`);
    }
  }
}
