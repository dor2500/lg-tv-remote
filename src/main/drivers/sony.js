// Sony BRAVIA TVs, over their IP control API. The owner sets a pre-shared key on the TV.
// Based on https://github.com/Drafteed/pybravia and https://pro-bravia.sony.net/develop/integrate/
const { BaseDriver, friendly, httpRequest, mapButton } = require('./common');

const KEYS = {
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', ENTER: 'Confirm', BACK: 'Return', EXIT: 'Exit', HOME: 'Home',
  QMENU: 'ActionMenu', INFO: 'Display', GUIDE: 'GGuide', VOLUMEUP: 'VolumeUp', VOLUMEDOWN: 'VolumeDown', MUTE: 'Mute',
  CHANNELUP: 'ChannelUp', CHANNELDOWN: 'ChannelDown', PLAY: 'Play', PAUSE: 'Pause', STOP: 'Stop', REWIND: 'Rewind',
  FASTFORWARD: 'Forward', RED: 'Red', GREEN: 'Green', YELLOW: 'Yellow', BLUE: 'Blue',
};
for (let digit = 0; digit <= 9; digit += 1) KEYS[digit] = `Num${digit}`;

const AUTH_ERRORS = new Set([401, 402, 403]);

class SonyDriver extends BaseDriver {
  static brand = 'sony';

  static capabilities = ['apps', 'inputs', 'text', 'volumeSet', 'mute', 'screenOff', 'powerOff'];

  static buttons = Object.keys(KEYS);

  constructor({ host, credentials = null, config = {} }) {
    super({ host, config });
    this.psk = credentials;
    this.base = config.base || `http://${host}`;
    this.nextId = 1;
    this.codes = new Map();
    this.info = null;
  }

  async _rpc(service, method, params = [], version = '1.0') {
    const res = await httpRequest(`${this.base}/sony/${service}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PSK': this.psk || '' },
      body: JSON.stringify({ method, params, id: this.nextId++, version }),
    });
    if (AUTH_ERRORS.has(res.status)) throw friendly('BAD_PIN', 'The TV rejected the key');
    let data;
    try {
      data = JSON.parse(res.body);
    } catch (err) {
      throw friendly('REQUEST_FAILED', `The TV answered with status ${res.status}`, err);
    }
    if (data.error) {
      if (AUTH_ERRORS.has(data.error[0])) throw friendly('BAD_PIN', 'The TV rejected the key');
      throw friendly('REQUEST_FAILED', String(data.error[1] || data.error[0]));
    }
    return data.result || [];
  }

  async connect() {
    if (this.psk) {
      try {
        await this._loadSystem();
        return this.psk;
      } catch (err) {
        if (err.code !== 'BAD_PIN') throw this._unreachable(err);
        this.psk = null;
      }
    }
    try {
      await this._rpc('system', 'getPowerStatus');
    } catch (err) {
      throw this._unreachable(err);
    }
    await this._askForCode('PSK', async (key) => {
      this.psk = key;
      try {
        await this._loadSystem();
      } catch (err) {
        this.psk = null;
        throw err;
      }
    });
    this.emit('key', this.psk);
    return this.psk;
  }

  _unreachable(err) {
    return err.code === 'REQUEST_FAILED' ? err : friendly('UNREACHABLE', `Cannot reach the TV at ${this.host}`, err);
  }

  async _loadSystem() {
    const [system = {}] = await this._rpc('system', 'getSystemInformation');
    this.info = { model: system.model || null, product: 'Sony', mac: system.macAddr || null, wifiMac: null };
    const remote = await this._rpc('system', 'getRemoteControllerInfo');
    this.codes = new Map((remote[1] || []).map(({ name, value }) => [name, value]));
  }

  async getInfo() {
    return this.info;
  }

  watchState(onState) {
    this._startPolling(async () => {
      const [list = []] = await this._rpc('audio', 'getVolumeInformation');
      const speaker = list.find((item) => item.target === 'speaker') || list[0];
      if (speaker) onState({ volume: speaker.volume, muted: speaker.mute });
    });
  }

  async button(name) {
    const code = this.codes.get(mapButton(KEYS, name));
    if (!code) throw friendly('UNSUPPORTED', 'This TV does not offer that feature');
    const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
      + 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
      + `<u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>${code}</IRCCCode></u:X_SendIRCC>`
      + '</s:Body></s:Envelope>';
    const res = await httpRequest(`${this.base}/sony/ircc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        SOAPACTION: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
        'X-Auth-PSK': this.psk || '',
      },
      body,
    });
    if (res.status >= 300) throw friendly('REQUEST_FAILED', `The TV answered with status ${res.status}`);
  }

  async insertText(text) {
    await this._rpc('appControl', 'setTextForm', [String(text)]);
  }

  async listApps() {
    const [apps = []] = await this._rpc('appControl', 'getApplicationList');
    return apps.map((app) => ({ id: app.uri, title: app.title }));
  }

  async launchApp(id) {
    await this._rpc('appControl', 'setActiveApp', [{ uri: String(id) }]);
  }

  async listInputs() {
    const [inputs = []] = await this._rpc('avContent', 'getCurrentExternalInputsStatus');
    return inputs.map((input) => ({ id: input.uri, label: input.label || input.title }));
  }

  async switchInput(id) {
    await this._rpc('avContent', 'setPlayContent', [{ uri: String(id) }]);
  }

  async setVolume(volume) {
    const level = Math.max(0, Math.min(100, Math.round(volume)));
    await this._rpc('audio', 'setAudioVolume', [{ target: 'speaker', volume: String(level) }]);
  }

  async setMute(mute) {
    await this._rpc('audio', 'setAudioMute', [{ status: Boolean(mute) }]);
  }

  async screenOff() {
    await this._rpc('system', 'setPowerSavingMode', [{ mode: 'pictureOff' }]);
  }

  async screenOn() {
    await this._rpc('system', 'setPowerSavingMode', [{ mode: 'off' }]);
  }

  async powerOff() {
    await this._rpc('system', 'setPowerStatus', [{ status: false }]);
  }
}

module.exports = { SonyDriver };
