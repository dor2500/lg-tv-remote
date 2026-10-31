// Android TV and Google TV, over the protocol of Google's remote app: TLS on two ports with protobuf messages.
// Based on https://github.com/tronikos/androidtvremote2
const crypto = require('node:crypto');
const tls = require('node:tls');
const selfsigned = require('selfsigned');
const { BaseDriver, friendly, mapButton } = require('./common');

const PAIRING_PORT = 6467;
const REMOTE_PORT = 6466;
const HANDSHAKE_TIMEOUT_MS = 6000;
const IDLE_TIMEOUT_MS = 16000; // The TV pings every 5 seconds and closes after 3 unanswered pings.
const CLIENT_NAME = 'Universal TV Remote';

// Feature flags agreed with the TV: ping, key, IME, power, volume, app link.
const FEATURES = 1 | 2 | 4 | 32 | 64 | 512;

const KEY_SHORT_PRESS = 3;
const KEYS = {
  HOME: 3, BACK: 4, UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22, ENTER: 23, VOLUMEUP: 24, VOLUMEDOWN: 25, MENU: 82, QMENU: 176,
  STOP: 86, REWIND: 89, FASTFORWARD: 90, PLAY: 126, PAUSE: 127, MUTE: 164, INFO: 165, CHANNELUP: 166, CHANNELDOWN: 167,
  GUIDE: 172, RED: 183, GREEN: 184, YELLOW: 185, BLUE: 186,
};
for (let digit = 0; digit <= 9; digit += 1) KEYS[digit] = 7 + digit;
const KEY_POWER = 26;
const KEY_DELETE = 67;
const KEY_ENTER = 66;
const INPUTS = [1, 2, 3, 4].map((n) => ({ id: String(242 + n), label: `HDMI ${n}` }));

// The protocol has no way to list apps, so this offers common ones. An app that isn't installed does not open.
const COMMON_APPS = [
  { id: 'vnd.youtube://', title: 'YouTube' },
  { id: 'https://www.netflix.com/title.0', title: 'Netflix' },
  { id: 'https://app.primevideo.com', title: 'Prime Video' },
  { id: 'https://www.disneyplus.com', title: 'Disney+' },
  { id: 'spotify://', title: 'Spotify' },
  { id: 'plex://', title: 'Plex' },
  { id: 'twitch://home', title: 'Twitch' },
];

/* Minimal protobuf: messages are lists of [field, value]. Zero numbers are left out, as proto3 does. */
function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

function encode(fields) {
  const parts = [];
  for (const [number, value] of fields) {
    if (typeof value === 'number') {
      if (value !== 0) parts.push(varint(number * 8), varint(value));
    } else {
      let bytes;
      if (Array.isArray(value)) bytes = encode(value);
      else bytes = Buffer.from(value);
      parts.push(varint(number * 8 + 2), varint(bytes.length), bytes);
    }
  }
  return Buffer.concat(parts);
}

function readVarint(buffer, start) {
  let value = 0;
  let scale = 1;
  let offset = start;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    offset += 1;
    value += (byte & 127) * scale;
    if (byte < 128) return [value, offset];
    scale *= 128;
  }
  return null;
}

// Returns a map of field number to its last value: a number, or a Buffer for anything length-delimited.
function decode(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    if (!tag) throw friendly('REQUEST_FAILED', 'The TV sent a broken message');
    const wire = tag[0] % 8;
    const number = Math.floor(tag[0] / 8);
    offset = tag[1];
    if (wire === 0) {
      const item = readVarint(buffer, offset);
      if (!item) throw friendly('REQUEST_FAILED', 'The TV sent a broken message');
      fields.set(number, item[0]);
      offset = item[1];
    } else if (wire === 2) {
      const size = readVarint(buffer, offset);
      if (!size) throw friendly('REQUEST_FAILED', 'The TV sent a broken message');
      fields.set(number, buffer.subarray(size[1], size[1] + size[0]));
      offset = size[1] + size[0];
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw friendly('REQUEST_FAILED', 'The TV sent a broken message');
    }
  }
  return fields;
}

// Messages on both ports are prefixed with their length.
function frame(fields) {
  const body = encode(fields);
  return Buffer.concat([varint(body.length), body]);
}

function onFrames(socket, handler) {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const size = readVarint(pending, 0);
      if (!size || pending.length < size[1] + size[0]) return;
      const body = pending.subarray(size[1], size[1] + size[0]);
      pending = pending.subarray(size[1] + size[0]);
      try {
        handler(decode(body));
      } catch (err) {
        socket.destroy(err);
        return;
      }
    }
  });
}

function keyParts(pem) {
  const { n, e } = new crypto.X509Certificate(pem).publicKey.export({ format: 'jwk' });
  const hex = (value) => Buffer.from(value, 'base64url').toString('hex').replace(/^0+/, '');
  return { modulus: hex(n), exponent: `0${hex(e)}` };
}

// The secret proves both sides saw the code. Its first byte repeats the code's first byte, which catches typos.
function pairingSecret(clientPem, serverPem, code) {
  const client = keyParts(clientPem);
  const server = keyParts(serverPem);
  const hash = crypto.createHash('sha256');
  for (const part of [client.modulus, client.exponent, server.modulus, server.exponent, code.slice(2)]) {
    hash.update(Buffer.from(part, 'hex'));
  }
  return hash.digest();
}

function createIdentity() {
  const pems = selfsigned.generate([{ name: 'commonName', value: 'universal-tv-remote' }], { days: 3650, keySize: 2048, algorithm: 'sha256' });
  return { cert: pems.cert, key: pems.private };
}

function isNetworkError(err) {
  return ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'CONNECT_TIMEOUT'].includes(err.code);
}

function outer(fields) {
  return frame([[1, 2], [2, 200], ...fields]);
}

class AndroidTvDriver extends BaseDriver {
  static brand = 'androidtv';

  static capabilities = ['apps', 'appsCommon', 'inputs', 'text', 'textDelete', 'powerOff'];

  static buttons = Object.keys(KEYS);

  constructor({ host, credentials = null, config = {} }) {
    super({ host, config });
    this.identity = credentials ? JSON.parse(credentials) : null;
    this.pairingPort = config.pairingPort || PAIRING_PORT;
    this.remotePort = config.remotePort || REMOTE_PORT;
    this.connectHost = config.connectHost || host;
    this.socket = null;
    this.vendor = null;
    this.model = null;
    this.imeCounter = 0;
    this.imeField = 0;
    this.state = null;
  }

  _dial(port) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: this.connectHost, port, cert: this.identity.cert, key: this.identity.key, rejectUnauthorized: false,
      });
      const timer = setTimeout(() => {
        const err = friendly('CONNECT_TIMEOUT', 'The TV did not answer');
        socket.destroy(err);
      }, HANDSHAKE_TIMEOUT_MS);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        socket.removeListener('error', reject);
        resolve(socket);
      });
      socket.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  async connect() {
    if (this.identity) {
      try {
        await this._openRemote();
        return null;
      } catch (err) {
        if (isNetworkError(err)) throw friendly('UNREACHABLE', `Cannot reach the TV at ${this.host}`, err);
        // Any other failure means the TV no longer accepts this certificate, so pair again below.
      }
    } else {
      this.identity = createIdentity();
    }
    await this._pair();
    this.emit('key', JSON.stringify(this.identity));
    await this._openRemote();
    return null;
  }

  async _pair() {
    let socket;
    try {
      socket = await this._dial(this.pairingPort);
    } catch (err) {
      throw friendly('UNREACHABLE', `Cannot reach the TV at ${this.host}`, err);
    }
    socket.on('close', () => {
      if (this.pinRequest) this.pinRequest.fail(friendly('PAIRING_REJECTED', 'The TV ended the pairing'));
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(friendly('TIMEOUT', 'The TV did not answer in time')), HANDSHAKE_TIMEOUT_MS);
        socket.on('error', reject);
        socket.on('close', () => reject(friendly('PAIRING_REJECTED', 'The TV ended the pairing')));
        onFrames(socket, (msg) => {
          if (msg.get(2) !== 200) {
            const code = msg.get(2) === 402 ? 'BAD_PIN' : 'PAIRING_REJECTED';
            const err = friendly(code, `The TV answered with status ${msg.get(2)}`);
            if (this.secretWaiter) this.secretWaiter.reject(err);
            else reject(err);
          } else if (msg.has(11)) {
            socket.write(outer([[20, [[1, [[1, 3], [2, 6]]], [3, 1]]]]));
          } else if (msg.has(20)) {
            socket.write(outer([[30, [[1, [[1, 3], [2, 6]]], [2, 1]]]]));
          } else if (msg.has(31)) {
            clearTimeout(timer);
            resolve();
          } else if (msg.has(41) && this.secretWaiter) {
            this.secretWaiter.resolve();
          }
        });
        socket.write(outer([[10, [[1, 'atvremote'], [2, CLIENT_NAME]]]]));
      });
      const serverPem = socket.getPeerX509Certificate().toString();
      await this._askForCode('CODE', (raw) => this._sendSecret(socket, serverPem, raw));
    } finally {
      socket.removeAllListeners('close');
      socket.removeAllListeners('error');
      socket.on('error', () => {});
      socket.destroy();
    }
  }

  _sendSecret(socket, serverPem, raw) {
    const code = raw.toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(code)) return Promise.reject(friendly('BAD_PIN', 'The code is 6 letters and digits'));
    const secret = pairingSecret(this.identity.cert, serverPem, code);
    if (secret[0] !== parseInt(code.slice(0, 2), 16)) return Promise.reject(friendly('BAD_PIN', 'The code is not correct'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(friendly('TIMEOUT', 'The TV did not answer in time')), HANDSHAKE_TIMEOUT_MS);
      this.secretWaiter = {
        resolve: () => { clearTimeout(timer); this.secretWaiter = null; resolve(); },
        reject: (err) => { clearTimeout(timer); this.secretWaiter = null; reject(err); },
      };
      socket.write(outer([[40, [[1, secret]]]]));
    });
  }

  _openRemote() {
    return this._dial(this.remotePort).then((socket) => new Promise((resolve, reject) => {
      let started = false;
      // TLS 1.3 reports a refused client certificate only after the handshake, so wait for the TV's first messages.
      const timer = setTimeout(() => socket.destroy(friendly('NOT_PAIRED', 'The TV did not start the session')), HANDSHAKE_TIMEOUT_MS);
      socket.on('error', (err) => {
        if (started) this.emit('socket-error', err);
        else { clearTimeout(timer); reject(err); }
      });
      socket.on('close', () => {
        clearTimeout(timer);
        clearTimeout(this.idleTimer);
        if (!started) reject(friendly('NOT_PAIRED', 'The TV closed the session'));
        else if (this.socket === socket) {
          this.socket = null;
          this._markClosed(this.closedByUser === true);
        }
      });
      onFrames(socket, (msg) => {
        this._resetIdle(socket);
        this._onRemoteMessage(socket, msg, () => {
          if (started) return;
          started = true;
          clearTimeout(timer);
          this.socket = socket;
          resolve();
        });
      });
    }));
  }

  _resetIdle(socket) {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => socket.destroy(), this.config.idleMs || IDLE_TIMEOUT_MS);
  }

  _onRemoteMessage(socket, msg, onStarted) {
    if (msg.has(1)) {
      const info = decode(msg.get(1)).get(2);
      if (info) {
        const device = decode(info);
        this.model = device.has(1) ? device.get(1).toString() : null;
        this.vendor = device.has(2) ? device.get(2).toString() : null;
      }
      const supported = decode(msg.get(1)).get(1) || 0;
      this.features = FEATURES & supported;
      socket.write(frame([[1, [[1, this.features], [2, [[3, 1], [4, '1'], [5, 'atvremote'], [6, '1.0.0']]]]]]));
    } else if (msg.has(2)) {
      socket.write(frame([[2, [[1, this.features]]]]));
    } else if (msg.has(8)) {
      socket.write(frame([[9, [[1, decode(msg.get(8)).get(1) || 0]]]]));
    } else if (msg.has(40)) {
      onStarted();
    } else if (msg.has(50)) {
      const volume = decode(msg.get(50));
      const max = volume.get(6) || 100;
      this._state({ volume: Math.round(((volume.get(7) || 0) / max) * 100), muted: volume.get(8) === 1 });
    } else if (msg.has(20)) {
      const app = decode(msg.get(20)).get(1);
      const packageName = app && decode(app).get(12);
      if (packageName) this._state({ appId: packageName.toString() });
    } else if (msg.has(21)) {
      const edit = decode(msg.get(21));
      this.imeCounter = edit.get(1) || 0;
      this.imeField = edit.get(2) || 0;
    }
  }

  _state(update) {
    if (this.stateHandler) this.stateHandler(update);
  }

  watchState(onState) {
    this.stateHandler = onState;
  }

  _write(fields) {
    if (!this.socket) throw friendly('NOT_CONNECTED', 'Not connected to the TV');
    this.socket.write(frame(fields));
  }

  _key(code) {
    this._write([[10, [[1, code], [2, KEY_SHORT_PRESS]]]]);
  }

  async button(name) {
    this._key(mapButton(KEYS, name));
  }

  async insertText(text) {
    const value = String(text);
    const end = value.length - 1;
    this._write([[21, [[1, this.imeCounter], [2, this.imeField], [3, [[1, 1], [2, [[1, end], [2, end], [3, value]]]]]]]]);
  }

  async deleteCharacters(count = 1) {
    for (let i = 0; i < Number(count); i += 1) this._key(KEY_DELETE);
  }

  async sendEnter() {
    this._key(KEY_ENTER);
  }

  async listApps() {
    return COMMON_APPS;
  }

  async launchApp(id) {
    if (!COMMON_APPS.some((app) => app.id === id)) throw friendly('BAD_INPUT', `Unknown app: ${id}`);
    this._write([[90, [[1, id]]]]);
  }

  async listInputs() {
    return INPUTS;
  }

  async switchInput(id) {
    if (!INPUTS.some((input) => input.id === id)) throw friendly('BAD_INPUT', `Unknown input: ${id}`);
    this._key(Number(id));
  }

  async powerOff() {
    this._key(KEY_POWER);
  }

  async getInfo() {
    return { model: this.model, product: this.vendor || 'Android TV', mac: null, wifiMac: null };
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.idleTimer);
    if (this.socket) this.socket.destroy();
    else this._markClosed(true);
  }
}

module.exports = { AndroidTvDriver, pairingSecret, encode, decode, frame, onFrames };
