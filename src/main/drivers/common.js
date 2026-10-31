// Shared by all TV drivers. Has no Electron dependency so the drivers can be tested against fake TVs.
const { EventEmitter } = require('node:events');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dgram = require('node:dgram');

const PAIRING_TIMEOUT_MS = 90000;

function friendly(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

const OPTIONAL_METHODS = [
  'click', 'move', 'scroll', 'insertText', 'deleteCharacters', 'sendEnter', 'listApps', 'launchApp', 'listInputs',
  'switchInput', 'setVolume', 'setMute', 'screenOff', 'screenOn', 'capture', 'powerOff',
];

class BaseDriver extends EventEmitter {
  constructor({ host, config = {} }) {
    super();
    this.host = host;
    this.config = config;
    this.closed = false;
    this.pinRequest = null;
    this.poller = null;
  }

  // Asks the user for a code. `verify` runs on each attempt, so a mistyped code can be typed again.
  _askForCode(type, verify) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pinRequest = null;
        reject(friendly('PAIRING_TIMEOUT', 'The pairing was not completed in time'));
      }, this.config.pairingTimeoutMs || PAIRING_TIMEOUT_MS);
      this.pinRequest = {
        verify,
        finish: (value) => { clearTimeout(timer); this.pinRequest = null; resolve(value); },
        fail: (err) => { clearTimeout(timer); this.pinRequest = null; reject(err); },
      };
      this.emit('pairing', type);
    });
  }

  async submitPin(pin) {
    const request = this.pinRequest;
    if (!request) throw friendly('NOT_CONNECTED', 'No pairing is waiting for a code');
    const result = await request.verify(String(pin).trim());
    request.finish(result);
  }

  // These drivers talk over plain requests, so a dead TV is only noticed by asking it something.
  _startPolling(check, intervalMs = 5000) {
    let failures = 0;
    let busy = false;
    this.poller = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await check();
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= 3) this._markClosed(false);
      }
      busy = false;
    }, this.config.pollMs || intervalMs);
  }

  _markClosed(byUser) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.poller);
    if (this.pinRequest) this.pinRequest.fail(friendly('NOT_CONNECTED', 'The connection to the TV closed'));
    this.emit('closed', { byUser });
  }

  close() {
    this._markClosed(true);
  }

  watchState() {}
}

for (const name of OPTIONAL_METHODS) {
  BaseDriver.prototype[name] = async function unsupported() {
    throw friendly('UNSUPPORTED', 'This TV does not offer that feature');
  };
}

// TVs serve self-signed certificates, so they cannot be verified.
function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 6000, maxBytes = 5 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = lib.request(url, {
      method,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers: payload ? { 'Content-Length': payload.length, ...headers } : headers,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(friendly('REQUEST_FAILED', 'The TV sent too much data'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(friendly('TIMEOUT', 'The TV did not answer in time')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function portOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function wakeOnLan(mac, { broadcast = '255.255.255.255', port = 9 } = {}) {
  const hex = String(mac).replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return Promise.reject(friendly('BAD_INPUT', 'Invalid MAC address'));
  const macBytes = Buffer.from(hex, 'hex');
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(macBytes)]);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => { socket.close(); reject(err); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, port, broadcast, (err) => {
        socket.close();
        if (err) reject(err); else resolve();
      });
    });
  });
}

function mapButton(map, name) {
  const upper = String(name).toUpperCase();
  if (!Object.hasOwn(map, upper)) throw friendly('BAD_INPUT', `Unknown button: ${name}`);
  return map[upper];
}

module.exports = { BaseDriver, friendly, httpRequest, portOpen, wakeOnLan, mapButton };
