// Vizio SmartCast TVs, over their HTTPS API. Pairing uses a code shown on the TV.
// Based on https://github.com/raman325/pyvizio and https://github.com/exiva/Vizio_SmartCast_API
const { BaseDriver, friendly, httpRequest, mapButton } = require('./common');

const DEVICE_ID = 'universal-tv-remote';
const DEVICE_NAME = 'Universal TV Remote';
const PATHS = {
  inputs: '/menu_native/dynamic/tv_settings/devices/name_input',
  currentInput: '/menu_native/dynamic/tv_settings/devices/current_input',
  volume: '/menu_native/dynamic/tv_settings/audio/volume',
};

const KEYS = {
  FASTFORWARD: [2, 0], REWIND: [2, 1], PAUSE: [2, 2], PLAY: [2, 3], DOWN: [3, 0], LEFT: [3, 1], ENTER: [3, 2],
  UP: [3, 8], RIGHT: [3, 7], BACK: [4, 0], INFO: [4, 6], MENU: [4, 8], QMENU: [4, 8], HOME: [4, 15], VOLUMEDOWN: [5, 0],
  VOLUMEUP: [5, 1], MUTE: [5, 4], CHANNELDOWN: [8, 0], CHANNELUP: [8, 1], EXIT: [9, 0],
};

// Field case differs between firmware versions.
function field(object, name) {
  if (!object) return undefined;
  const key = Object.keys(object).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

class VizioDriver extends BaseDriver {
  static brand = 'vizio';

  static capabilities = ['inputs', 'volumeSet', 'powerOff'];

  static buttons = Object.keys(KEYS);

  constructor({ host, credentials = null, config = {} }) {
    super({ host, config });
    this.token = credentials;
    // Firmware 4.0 and later uses 7345, older firmware uses 9000.
    this.bases = config.bases || [`https://${host}:7345`, `https://${host}:9000`];
    this.base = null;
  }

  async _call(method, path, body) {
    if (!this.base) throw friendly('NOT_CONNECTED', 'Not connected to the TV');
    return this._callAt(this.base, method, path, body);
  }

  async _callAt(base, method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.AUTH = this.token;
    const res = await httpRequest(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data;
    try {
      data = JSON.parse(res.body);
    } catch (err) {
      throw friendly('REQUEST_FAILED', 'The TV sent an unexpected answer', err);
    }
    const result = String(field(field(data, 'status'), 'result') || '').toUpperCase();
    if (result === 'PAIRING_DENIED') throw friendly('BAD_PIN', 'The code is not correct');
    if (result === 'REQUIRES_PAIRING') throw friendly('NOT_PAIRED', 'The TV needs a new pairing');
    if (result !== 'SUCCESS') throw friendly('REQUEST_FAILED', `The TV answered: ${result || 'unknown'}`);
    return data;
  }

  async _findBase() {
    let lastError;
    for (const base of this.bases) {
      try {
        await this._callAt(base, 'GET', '/state/device/deviceinfo');
        return base;
      } catch (err) {
        if (err.code === 'REQUEST_FAILED' || err.code === 'NOT_PAIRED') return base;
        lastError = err;
      }
    }
    throw friendly('UNREACHABLE', `Cannot reach the TV at ${this.host}`, lastError);
  }

  async connect() {
    this.base = await this._findBase();
    if (this.token) {
      try {
        await this._call('GET', '/state/device/power_mode');
        return this.token;
      } catch (err) {
        if (err.code !== 'NOT_PAIRED') throw err;
        this.token = null;
      }
    }
    const started = await this._call('PUT', '/pairing/start', { DEVICE_ID, DEVICE_NAME });
    const item = field(started, 'item');
    const pairingToken = field(item, 'pairing_req_token');
    const challenge = field(item, 'challenge_type');
    const token = await this._askForCode('PIN', async (pin) => {
      const paired = await this._call('PUT', '/pairing/pair', {
        DEVICE_ID, CHALLENGE_TYPE: challenge, RESPONSE_VALUE: pin, PAIRING_REQ_TOKEN: pairingToken,
      });
      return field(field(paired, 'item'), 'auth_token');
    });
    this.token = token;
    this.emit('key', token);
    return token;
  }

  watchState(onState) {
    this._startPolling(async () => {
      const data = await this._call('GET', PATHS.volume);
      const value = field((field(data, 'items') || [])[0], 'value');
      if (typeof value === 'number') onState({ volume: value });
    });
  }

  _press([codeset, code]) {
    return this._call('PUT', '/key_command/', { KEYLIST: [{ CODESET: codeset, CODE: code, ACTION: 'KEYPRESS' }] });
  }

  async button(name) {
    await this._press(mapButton(KEYS, name));
  }

  async listInputs() {
    const data = await this._call('GET', PATHS.inputs);
    return (field(data, 'items') || []).map((item) => {
      const value = field(item, 'value');
      const label = (value && typeof value === 'object' && field(value, 'name')) || field(item, 'name');
      return { id: field(item, 'name'), label };
    });
  }

  async _modify(path, value) {
    const current = await this._call('GET', path);
    const hash = field((field(current, 'items') || [])[0], 'hashval');
    await this._call('PUT', path, { REQUEST: 'MODIFY', VALUE: value, HASHVAL: hash });
  }

  async switchInput(id) {
    await this._modify(PATHS.currentInput, String(id));
  }

  async setVolume(volume) {
    await this._modify(PATHS.volume, Math.max(0, Math.min(100, Math.round(volume))));
  }

  async powerOff() {
    await this._press([11, 0]);
  }

  async getInfo() {
    try {
      const data = await this._call('GET', '/state/device/deviceinfo');
      const value = field((field(data, 'items') || [])[0], 'value');
      const system = field(value, 'system_info');
      return { model: field(value, 'model_name') || field(system, 'model_name') || null, product: 'Vizio', mac: null, wifiMac: null };
    } catch {
      return { model: null, product: 'Vizio', mac: null, wifiMac: null };
    }
  }
}

module.exports = { VizioDriver };
