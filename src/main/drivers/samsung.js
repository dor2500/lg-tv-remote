// Samsung Tizen TVs (2016 and later), over the WebSocket remote channel.
// Based on https://github.com/xchwarze/samsung-tv-ws-api
const WebSocket = require('ws');
const { BaseDriver, friendly, httpRequest, mapButton } = require('./common');

const CLIENT_NAME = 'Universal TV Remote';
const CONNECT_TIMEOUT_MS = 90000;
const APPS_TIMEOUT_MS = 6000;

const KEYS = {
  UP: 'KEY_UP', DOWN: 'KEY_DOWN', LEFT: 'KEY_LEFT', RIGHT: 'KEY_RIGHT', ENTER: 'KEY_ENTER', BACK: 'KEY_RETURN',
  EXIT: 'KEY_EXIT', HOME: 'KEY_HOME', MENU: 'KEY_MENU', QMENU: 'KEY_TOOLS', INFO: 'KEY_INFO', GUIDE: 'KEY_GUIDE',
  VOLUMEUP: 'KEY_VOLUP', VOLUMEDOWN: 'KEY_VOLDOWN', MUTE: 'KEY_MUTE', CHANNELUP: 'KEY_CHUP', CHANNELDOWN: 'KEY_CHDOWN',
  PLAY: 'KEY_PLAY', PAUSE: 'KEY_PAUSE', STOP: 'KEY_STOP', REWIND: 'KEY_REWIND', FASTFORWARD: 'KEY_FF',
  RED: 'KEY_RED', GREEN: 'KEY_GREEN', YELLOW: 'KEY_YELLOW', BLUE: 'KEY_BLUE',
};
for (let digit = 0; digit <= 9; digit += 1) KEYS[digit] = `KEY_${digit}`;

const INPUTS = [1, 2, 3, 4].map((n) => ({ id: `KEY_HDMI${n}`, label: `HDMI ${n}` }));

class SamsungDriver extends BaseDriver {
  static brand = 'samsung';

  static capabilities = ['apps', 'inputs', 'text', 'powerOff'];

  static buttons = Object.keys(KEYS);

  constructor({ host, credentials = null, config = {} }) {
    super({ host, config });
    this.token = credentials;
    this.ws = null;
    this.heartbeat = null;
    this.appsWaiter = null;
    this.textStarted = false;
    this.restBase = config.restBase || `http://${host}:8001`;
  }

  _urls() {
    const name = Buffer.from(CLIENT_NAME).toString('base64');
    const path = `/api/v2/channels/samsung.remote.control?name=${encodeURIComponent(name)}`;
    const token = this.token ? `&token=${encodeURIComponent(this.token)}` : '';
    if (this.config.endpoints) return this.config.endpoints.map((base) => `${base}${path}${token}`);
    // Port 8002 is the encrypted channel. TVs from 2016 only have 8001.
    return [`wss://${this.host}:8002${path}${token}`, `ws://${this.host}:8001${path}`];
  }

  async connect() {
    let lastError;
    for (const url of this._urls()) {
      try {
        await this._open(url);
        return this.token;
      } catch (err) {
        if (err.code === 'PAIRING_REJECTED' || err.code === 'PAIRING_TIMEOUT') throw err;
        lastError = err;
      }
    }
    throw friendly('UNREACHABLE', `Cannot reach the TV at ${this.host}`, lastError);
  }

  _open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
      let settled = false;
      const timer = setTimeout(() => finish(friendly('PAIRING_TIMEOUT', 'The TV did not approve the pairing in time')), CONNECT_TIMEOUT_MS);
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          ws.removeAllListeners();
          ws.on('error', () => {});
          ws.terminate();
          reject(err);
        } else {
          resolve();
        }
      };
      ws.on('open', () => { if (!this.token) this.emit('pairing', 'PROMPT'); });
      ws.on('error', (err) => { if (settled) this.emit('socket-error', err); else finish(err); });
      ws.on('close', () => {
        if (!settled) finish(friendly('UNREACHABLE', 'The TV closed the connection'));
        else if (this.ws === ws) this._onClose();
      });
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.event === 'ms.channel.unauthorized') {
          finish(friendly('PAIRING_REJECTED', 'The TV declined the connection'));
        } else if (msg.event === 'ms.channel.connect') {
          const token = msg.data && msg.data.token;
          if (token && token !== this.token) {
            this.token = token;
            this.emit('key', token);
          }
          this.ws = ws;
          this._startHeartbeat(ws);
          finish();
        } else if (msg.event === 'ed.installedApp.get' && this.appsWaiter) {
          this.appsWaiter((msg.data && msg.data.data) || []);
        } else if (msg.event === 'ms.remote.imeEnd' || msg.event === 'ms.remote.imeStart') {
          this.textStarted = false;
        }
      });
    });
  }

  _startHeartbeat(ws) {
    let alive = true;
    ws.on('pong', () => { alive = true; });
    this.heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 10000);
  }

  _onClose() {
    clearInterval(this.heartbeat);
    this.ws = null;
    this._markClosed(this.closedByUser === true);
  }

  _send(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw friendly('NOT_CONNECTED', 'Not connected to the TV');
    this.ws.send(JSON.stringify({ method, params }));
  }

  _key(key) {
    this._send('ms.remote.control', { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' });
  }

  async button(name) {
    this._key(mapButton(KEYS, name));
  }

  async insertText(text) {
    if (!this.textStarted) {
      // Some TVs need this broadcast before they accept text.
      this._send('ms.channel.emit', { event: 'custom.remote.textReceived', to: 'broadcast' });
      this.textStarted = true;
    }
    this._send('ms.remote.control', {
      Cmd: Buffer.from(String(text), 'utf8').toString('base64'), DataOfCmd: 'base64', TypeOfRemote: 'SendInputString',
    });
  }

  async sendEnter() {
    this._send('ms.remote.control', { TypeOfRemote: 'SendInputEnd' });
    this.textStarted = false;
  }

  listApps() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.appsWaiter = null;
        reject(friendly('TIMEOUT', 'The TV did not send its app list'));
      }, APPS_TIMEOUT_MS);
      this.appsWaiter = (apps) => {
        clearTimeout(timer);
        this.appsWaiter = null;
        this.appTypes = new Map(apps.map((app) => [app.appId, app.app_type]));
        resolve(apps.map((app) => ({ id: app.appId, title: app.name })));
      };
      try {
        this._send('ms.channel.emit', { event: 'ed.installedApp.get', to: 'host' });
      } catch (err) {
        clearTimeout(timer);
        this.appsWaiter = null;
        reject(err);
      }
    });
  }

  async launchApp(id) {
    const type = this.appTypes && this.appTypes.get(id) === 2 ? 'DEEP_LINK' : 'NATIVE_LAUNCH';
    this._send('ms.channel.emit', {
      event: 'ed.apps.launch', to: 'host', data: { action_type: type, appId: String(id), metaTag: '' },
    });
  }

  async listInputs() {
    return INPUTS;
  }

  async switchInput(id) {
    if (!INPUTS.some((input) => input.id === id)) throw friendly('BAD_INPUT', `Unknown input: ${id}`);
    this._key(id);
  }

  async powerOff() {
    this._key('KEY_POWER');
  }

  async getInfo() {
    try {
      const res = await httpRequest(`${this.restBase}/api/v2/`);
      const { device = {} } = JSON.parse(res.body);
      return { model: device.modelName || null, product: 'Samsung', mac: null, wifiMac: device.wifiMac || null };
    } catch {
      return { model: null, product: 'Samsung', mac: null, wifiMac: null };
    }
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.heartbeat);
    if (this.ws) this.ws.close();
    else this._markClosed(true);
  }
}

module.exports = { SamsungDriver };
