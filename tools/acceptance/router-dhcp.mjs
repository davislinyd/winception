// Independent test DHCP provider. No PXE vendor, boot-server or boot-file options.
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ip = (value) => Buffer.from(value.split('.').map(Number));
export function dhcpReply(packet, config, leases) {
  if (packet.length < 240 || packet[0] !== 1 || packet[1] !== 1 || packet[2] !== 6 || packet.readUInt32BE(236) !== 0x63825363) return null;
  const options = new Map();
  for (let cursor=240; cursor<packet.length;) {
    const code=packet[cursor++]; if(code===255) break; if(code===0) continue;
    if(cursor >= packet.length) return null;
    const length=packet[cursor++]; if(cursor+length>packet.length) return null;
    options.set(code,packet.subarray(cursor,cursor+length)); cursor+=length;
  }
  const type=options.get(53)?.[0]; if(![1,3].includes(type)) return null;
  if(options.get(53).length !== 1 || [50,54].some(code=>options.has(code) && options.get(code).length !== 4)) return null;
  if(type===3 && options.has(54) && !options.get(54).equals(ip(config.serverIp))) return null;
  const mac=packet.subarray(28,34).toString('hex').toUpperCase();
  if (!leases.has(mac)) {
    if(leases.size>=50) return null;
    leases.set(mac,`192.168.177.${100+leases.size}`);
  }
  const address=leases.get(mac);
  if(type===3 && options.has(50) && !options.get(50).equals(ip(address))) return null;
  const reply=Buffer.alloc(240); packet.copy(reply,0,0,236);
  reply[0]=2; reply.writeUInt16BE(0x8000,10); ip(address).copy(reply,16); ip(config.serverIp).copy(reply,20);
  reply.fill(0,44,236); reply.writeUInt32BE(0x63825363,236);
  const option=(code,value)=>Buffer.concat([Buffer.from([code,value.length]),value]);
  const seconds=Buffer.alloc(4);seconds.writeUInt32BE(3600);
  return Buffer.concat([reply,option(53,Buffer.from([type===1?2:5])),option(54,ip(config.serverIp)),
    option(1,ip('255.255.255.0')),option(3,ip(config.serverIp)),option(6,Buffer.concat(config.dnsServers.map(ip))),option(51,seconds),Buffer.from([255])]);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=JSON.parse(fs.readFileSync(process.argv[2]));
  if(config.serverIp!=='192.168.177.254' || !Array.isArray(config.dnsServers) || !config.dnsServers.length) throw new Error('DHCP fixture is restricted to AutoLab');
  const leases=new Map();const socket=dgram.createSocket('udp4');
  socket.on('message',(packet)=>{const reply=dhcpReply(packet,config,leases);if(reply){socket.send(reply,68,'255.255.255.255');fs.writeFileSync(config.leasePath,JSON.stringify(Object.fromEntries(leases)));}});
  socket.bind(67,config.serverIp,()=>socket.setBroadcast(true));
}
