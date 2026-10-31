// Finds TVs on the local network with SSDP and mDNS. Neither crosses a VPN: there the address is entered by hand.
const dgram = require('node:dgram');
const os = require('node:os');

const SSDP_ADDRESS = '239.255.255.250';
const MDNS_ADDRESS = '224.0.0.251';

const SSDP_TARGETS = [
  { st: 'urn:lge-com:service:webos-second-screen:1', brand: 'webos', name: 'LG webOS TV' },
  { st: 'urn:samsung.com:device:RemoteControlReceiver:1', brand: 'samsung', name: 'Samsung TV' },
  { st: 'roku:ecp', brand: 'roku', name: 'Roku' },
  { st: 'urn:schemas-sony-com:service:ScalarWebAPI:1', brand: 'sony', name: 'Sony BRAVIA' },
];
const MDNS_TARGETS = [
  { service: '_androidtvremote2._tcp.local', brand: 'androidtv', name: 'Android TV' },
  { service: '_viziocast._tcp.local', brand: 'vizio', name: 'Vizio TV' },
];
// A Sony TV can answer as both: Android TV needs no setup on the TV, so it wins.
const PREFERENCE = ['androidtv', 'webos', 'samsung', 'roku', 'vizio', 'sony'];

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ssdpSearch(st) {
  return Buffer.from(['M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDRESS}:1900`, 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${st}`, '', ''].join('\r\n'));
}

function parseSsdp(text) {
  const st = /^(?:ST|NT):\s*(.+?)\s*$/im.exec(text);
  const target = st && SSDP_TARGETS.find((item) => item.st.toLowerCase() === st[1].toLowerCase());
  if (!target) return null;
  const lgName = /^DLNADeviceName\.lge\.com:\s*(.+)$/im.exec(text);
  return { brand: target.brand, name: lgName ? safeDecode(lgName[1].trim()) : target.name };
}

function mdnsQuery(service) {
  const labels = service.split('.').map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
  // One question, type PTR, class IN.
  return Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), ...labels, Buffer.from([0, 0, 12, 0, 1])]);
}

function readName(buffer, start) {
  const labels = [];
  let offset = start;
  let end = null;
  for (let jumps = 0; jumps < 32; jumps += 1) {
    if (offset >= buffer.length) return null;
    const size = buffer[offset];
    if (size === 0) return { name: labels.join('.'), end: end === null ? offset + 1 : end };
    if (size >= 192) {
      if (end === null) end = offset + 2;
      offset = ((size & 63) << 8) + buffer[offset + 1];
    } else {
      labels.push(buffer.toString('utf8', offset + 1, offset + 1 + size));
      offset += size + 1;
    }
  }
  return null;
}

// Returns the service instances named by the PTR records of an mDNS response.
function parseMdns(buffer) {
  if (buffer.length < 12) return [];
  const count = (at) => buffer.readUInt16BE(at);
  const questions = count(4);
  const records = count(6) + count(8) + count(10);
  let offset = 12;
  const found = [];
  for (let i = 0; i < questions; i += 1) {
    const name = readName(buffer, offset);
    if (!name) return found;
    offset = name.end + 4;
  }
  for (let i = 0; i < records; i += 1) {
    const name = readName(buffer, offset);
    if (!name || name.end + 10 > buffer.length) return found;
    const type = buffer.readUInt16BE(name.end);
    const size = buffer.readUInt16BE(name.end + 8);
    const data = name.end + 10;
    if (type === 12) {
      const instance = readName(buffer, data);
      const target = instance && MDNS_TARGETS.find((item) => name.name.toLowerCase() === item.service);
      if (target) found.push({ brand: target.brand, name: instance.name.split('.')[0] || target.name });
    }
    offset = data + size;
  }
  return found;
}

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function record(found, host, tv) {
  const current = found.get(host);
  if (!current || PREFERENCE.indexOf(tv.brand) < PREFERENCE.indexOf(current.brand)) found.set(host, { host, ...tv });
}

// A computer with VPN or virtual adapters would otherwise send the search out of only one of them.
function searchFrom(address, found, timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve();
    };
    socket.on('error', done);
    socket.on('message', (message, rinfo) => {
      const ssdp = parseSsdp(message.toString());
      if (ssdp) record(found, rinfo.address, ssdp);
      for (const tv of parseMdns(message)) record(found, rinfo.address, tv);
    });
    socket.bind(0, address, () => {
      const send = () => {
        for (const { st } of SSDP_TARGETS) socket.send(ssdpSearch(st), 1900, SSDP_ADDRESS, () => {});
        for (const { service } of MDNS_TARGETS) socket.send(mdnsQuery(service), 5353, MDNS_ADDRESS, () => {});
      };
      send();
      setTimeout(send, 800);
      setTimeout(done, timeoutMs);
    });
  });
}

async function discover(timeoutMs = 3000) {
  const found = new Map();
  await Promise.all(localAddresses().map((address) => searchFrom(address, found, timeoutMs)));
  return [...found.values()];
}

module.exports = { discover, parseSsdp, parseMdns, mdnsQuery };
