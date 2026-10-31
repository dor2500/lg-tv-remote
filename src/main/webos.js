// SSAP client for LG webOS TVs. Has no Electron dependency so it can be tested against a fake TV.
const { EventEmitter } = require('node:events');
const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');
const WebSocket = require('ws');
const { MANIFEST, UNSIGNED_MANIFEST } = require('./manifest');

const REQUEST_TIMEOUT_MS = 8000;
const PAIRING_TIMEOUT_MS = 90000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const BUTTONS = new Set([
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'EXIT', 'HOME', 'MENU', 'QMENU', 'INFO', 'DASH',
  'GUIDE', 'VOLUMEUP', 'VOLUMEDOWN', 'MUTE', 'CHANNELUP', 'CHANNELDOWN', 'PLAY', 'PAUSE', 'STOP',
  'REWIND', 'FASTFORWARD', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'ASTERISK', 'CC', 'SAP',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

class WebOSClient extends EventEmitter {
  constructor({ host, clientKey = null, endpoints = null, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
    super();
    this.host = host;
    this.clientKey = clientKey;
    this.endpoints = endpoints || [`wss://${host}:3001`, `ws://${host}:3000`];
    this.requestTimeoutMs = requestTimeoutMs;
    this.ws = null;
    this.pointer = null;
    this.pointerOpening = null;
    this.nextId = 1;
    this.pending = new Map();
    this.subscriptions = new Map();
    this.heartbeat = null;
    this.closedByUser = false;
  }

  async connect({ pairingType = 'PROMPT' } = {}) {
    this.closedByUser = false;
    try {
      return await this._openAndRegister(pairingType, MANIFEST);
    } catch (err) {
      if (err.code !== 'CERT_BLACKLISTED') throw err;
      this._dropSocket();
      return this._openAndRegister(pairingType, UNSIGNED_MANIFEST);
    }
  }

  _dropSocket() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws.terminate();
    }
    this.ws = null;
  }

  async _openAndRegister(pairingType, manifest) {
    let lastError;
    for (const url of this.endpoints) {
      try {
        this.ws = await openSocket(url);
        this.endpoint = url;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!this.ws) throw friendly('UNREACHABLE', `לא הצלחתי להגיע לטלוויזיה ב-${this.host}`, lastError);

    this.ws.on('message', (data) => this._onMessage(data));
    this.ws.on('close', () => this._onClose());
    this.ws.on('error', (err) => this.emit('socket-error', err));
    this._startHeartbeat();

    try {
      await this._register(pairingType, manifest);
    } catch (err) {
      // A stale key (factory reset, revoked pairing) is rejected: pair again from scratch.
      if (err.code !== 'PAIRING_REJECTED' && err.code !== 'CERT_BLACKLISTED' && this.clientKey) {
        this.clientKey = null;
        await this._register(pairingType, manifest);
      } else {
        throw err;
      }
    }
    return this.clientKey;
  }

  _register(pairingType, manifest) {
    return new Promise((resolve, reject) => {
      const id = `register_${this.nextId++}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(friendly('PAIRING_TIMEOUT', 'לא התקבל אישור מהטלוויזיה. אשר את הבקשה על המסך ונסה שוב.'));
      }, PAIRING_TIMEOUT_MS);
      this.pending.set(id, {
        timer,
        isRegister: true,
        resolve: (payload) => {
          this.clientKey = payload['client-key'];
          this.emit('key', this.clientKey);
          resolve(this.clientKey);
        },
        reject,
      });
      const payload = { forcePairing: false, pairingType, manifest };
      if (this.clientKey) payload['client-key'] = this.clientKey;
      this._send({ type: 'register', id, payload });
    });
  }

  submitPin(pin) {
    return this.request('ssap://pairing/setPin', { pin: String(pin) });
  }

  _send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw friendly('NOT_CONNECTED', 'אין חיבור לטלוויזיה');
    this.ws.send(JSON.stringify(message));
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const sub = this.subscriptions.get(msg.id);
    if (sub) {
      if (msg.type !== 'error') sub(msg.payload || {});
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;

    if (pending.isRegister) {
      if (msg.type === 'registered') {
        this._settle(msg.id).resolve(msg.payload);
      } else if (msg.type === 'error') {
        const text = msg.error || 'הטלוויזיה דחתה את החיבור';
        let code = 'REGISTER_ERROR';
        if (/blacklisted/i.test(text)) code = 'CERT_BLACKLISTED';
        else if (/denied|cancel|reject/i.test(text)) code = 'PAIRING_REJECTED';
        this._settle(msg.id).reject(friendly(code, text));
      } else if (msg.payload && msg.payload.pairingType) {
        this.emit('pairing', String(msg.payload.pairingType).toUpperCase());
      }
      return;
    }

    const entry = this._settle(msg.id);
    const payload = msg.payload || {};
    if (msg.type === 'error' || payload.returnValue === false) {
      const text = msg.error || payload.errorText || 'הפקודה נכשלה';
      entry.reject(friendly(/^401/.test(text) ? 'NO_PERMISSION' : 'REQUEST_FAILED', text));
    } else {
      entry.resolve(payload);
    }
  }

  _settle(id) {
    const entry = this.pending.get(id);
    clearTimeout(entry.timer);
    this.pending.delete(id);
    return entry;
  }

  _onClose() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const [id] of this.pending) {
      this._settle(id).reject(friendly('NOT_CONNECTED', 'החיבור לטלוויזיה נסגר'));
    }
    this.subscriptions.clear();
    this._closePointer();
    this.ws = null;
    this.emit('closed', { byUser: this.closedByUser });
  }

  // A dropped VPN link leaves a half-open socket, so check liveness instead of waiting for a close event.
  _startHeartbeat() {
    let alive = true;
    this.ws.on('pong', () => { alive = true; });
    this.heartbeat = setInterval(() => {
      if (!this.ws) return;
      if (!alive) {
        this.ws.terminate();
        return;
      }
      alive = false;
      this.ws.ping();
    }, 10000);
  }

  request(uri, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `req_${this.nextId++}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(friendly('TIMEOUT', 'הטלוויזיה לא ענתה בזמן'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { timer, resolve, reject });
      try {
        this._send({ type: 'request', id, uri, payload });
      } catch (err) {
        this._settle(id);
        reject(err);
      }
    });
  }

  subscribe(uri, callback, payload = {}) {
    const id = `sub_${this.nextId++}`;
    this.subscriptions.set(id, callback);
    this._send({ type: 'subscribe', id, uri, payload });
    return id;
  }

  // Pointer socket: buttons, mouse movement and scrolling use a second text-based socket.
  async _getPointer() {
    if (this.pointer && this.pointer.readyState === WebSocket.OPEN) return this.pointer;
    if (!this.pointerOpening) {
      this.pointerOpening = (async () => {
        const { socketPath } = await this.request('ssap://com.webos.service.networkinput/getPointerInputSocket');
        if (!socketPath) throw friendly('REQUEST_FAILED', 'הטלוויזיה לא החזירה ערוץ שליטה');
        const socket = await openSocket(this._toTvUrl(socketPath));
        socket.on('close', () => { if (this.pointer === socket) this.pointer = null; });
        socket.on('error', (err) => this.emit('socket-error', err));
        this.pointer = socket;
        return socket;
      })().finally(() => { this.pointerOpening = null; });
    }
    return this.pointerOpening;
  }

  _closePointer() {
    if (this.pointer) this.pointer.terminate();
    this.pointer = null;
  }

  // The TV reports its own LAN address. Over a VPN or subnet route, keep using the host we connected to.
  _toTvUrl(raw) {
    const url = new URL(raw);
    url.hostname = this.host.includes(':') && !this.host.startsWith('[') ? `[${this.host}]` : this.host;
    return url.toString();
  }

  async _pointerSend(text) {
    const socket = await this._getPointer();
    socket.send(text);
  }

  async button(name) {
    const upper = String(name).toUpperCase();
    if (!BUTTONS.has(upper)) throw friendly('BAD_INPUT', `כפתור לא מוכר: ${name}`);
    await this._pointerSend(`type:button\nname:${upper}\n\n`);
  }

  async move(dx, dy, down = false) {
    await this._pointerSend(`type:move\ndx:${Math.round(dx)}\ndy:${Math.round(dy)}\ndown:${down ? 1 : 0}\n\n`);
  }

  async click() {
    await this._pointerSend('type:click\n\n');
  }

  async scroll(dx, dy) {
    await this._pointerSend(`type:scroll\ndx:${Math.round(dx)}\ndy:${Math.round(dy)}\n\n`);
  }

  insertText(text) {
    return this.request('ssap://com.webos.service.ime/insertText', { text: String(text), replace: false });
  }

  deleteCharacters(count = 1) {
    return this.request('ssap://com.webos.service.ime/deleteCharacters', { count: Number(count) });
  }

  sendEnter() {
    return this.request('ssap://com.webos.service.ime/sendEnterKey');
  }

  async listApps() {
    const { launchPoints = [] } = await this.request('ssap://com.webos.applicationManager/listLaunchPoints');
    return launchPoints.map((p) => ({ id: p.id, title: p.title }));
  }

  launchApp(id) {
    return this.request('ssap://com.webos.applicationManager/launch', { id: String(id) });
  }

  async listInputs() {
    const { devices = [] } = await this.request('ssap://tv/getExternalInputList');
    return devices.map((d) => ({ id: d.id, label: d.label || d.id }));
  }

  switchInput(inputId) {
    return this.request('ssap://tv/switchInput', { inputId: String(inputId) });
  }

  setVolume(volume) {
    return this.request('ssap://audio/setVolume', { volume: Math.max(0, Math.min(100, Math.round(volume))) });
  }

  setMute(mute) {
    return this.request('ssap://audio/setMute', { mute: Boolean(mute) });
  }

  powerOff() {
    return this.request('ssap://system/turnOff');
  }

  screenOff() {
    return this.request('ssap://com.webos.service.tvpower/power/turnOffScreen', { standbyMode: 'active' });
  }

  screenOn() {
    return this.request('ssap://com.webos.service.tvpower/power/turnOnScreen', { standbyMode: 'active' });
  }

  toast(message) {
    return this.request('ssap://system.notifications/createToast', { message: String(message) });
  }

  // Each call is optional: firmware differs and a missing field must not fail the connection.
  async getInfo() {
    const [system, software, connection] = await Promise.allSettled([
      this.request('ssap://system/getSystemInfo'),
      this.request('ssap://com.webos.service.update/getCurrentSWInformation'),
      this.request('ssap://com.webos.service.connectionmanager/getinfo'),
    ]);
    const value = (r) => (r.status === 'fulfilled' ? r.value : {});
    const conn = value(connection);
    return {
      model: value(system).modelName || null,
      product: value(software).product_name || null,
      firmware: value(software).major_ver ? `${value(software).major_ver}.${value(software).minor_ver}` : null,
      mac: (conn.wiredInfo && conn.wiredInfo.macAddress) || null,
      wifiMac: (conn.wifiInfo && conn.wifiInfo.macAddress) || null,
    };
  }

  async capture() {
    const { imageUri } = await this.request('ssap://tv/executeOneShot');
    if (!imageUri) throw friendly('NO_IMAGE', 'הטלוויזיה לא החזירה תמונה');
    return downloadImage(this._toTvUrl(imageUri));
  }

  close() {
    this.closedByUser = true;
    this._closePointer();
    if (this.ws) this.ws.close();
  }
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    // TVs serve a self-signed certificate, so it cannot be verified.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
    ws.once('open', () => {
      ws.removeAllListeners('error');
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false, timeout: 10000 }, (res) => {
      const mime = String(res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
      if (res.statusCode !== 200 || !mime.startsWith('image/')) {
        res.resume();
        reject(friendly('NO_IMAGE', `הורדת התמונה נכשלה (${res.statusCode})`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          req.destroy(friendly('NO_IMAGE', 'התמונה גדולה מדי'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ mime, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(friendly('TIMEOUT', 'הורדת התמונה ארכה יותר מדי')));
    req.on('error', reject);
  });
}

function friendly(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function wakeOnLan(mac, { broadcast = '255.255.255.255', port = 9 } = {}) {
  const hex = String(mac).replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return Promise.reject(friendly('BAD_INPUT', 'כתובת MAC לא תקינה'));
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

// SSDP search for TVs on the local network. It does not cross a VPN: there the address is entered by hand.
function discover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const search = [
      'M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2',
      'ST: urn:lge-com:service:webos-second-screen:1', '', '',
    ].join('\r\n');
    socket.on('message', (msg, rinfo) => {
      const text = msg.toString();
      if (!/webos-second-screen/i.test(text)) return;
      const name = /^DLNADeviceName\.lge\.com:\s*(.+)$/im.exec(text);
      found.set(rinfo.address, { host: rinfo.address, name: name ? safeDecode(name[1].trim()) : 'LG webOS TV' });
    });
    socket.on('error', () => { try { socket.close(); } catch {} resolve([...found.values()]); });
    socket.bind(() => {
      const packet = Buffer.from(search);
      socket.send(packet, 1900, '239.255.255.250');
      setTimeout(() => socket.send(packet, 1900, '239.255.255.250', () => {}), 800);
      setTimeout(() => { socket.close(); resolve([...found.values()]); }, timeoutMs);
    });
  });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

module.exports = { WebOSClient, wakeOnLan, discover, BUTTONS };
