// Roku TVs and players, over External Control Protocol. It has no pairing.
// https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md
const { BaseDriver, friendly, httpRequest, mapButton } = require('./common');

const KEYS = {
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', ENTER: 'Select', BACK: 'Back', HOME: 'Home', INFO: 'Info',
  PLAY: 'Play', PAUSE: 'Play', REWIND: 'Rev', FASTFORWARD: 'Fwd',
};
const TV_KEYS = {
  VOLUMEUP: 'VolumeUp', VOLUMEDOWN: 'VolumeDown', MUTE: 'VolumeMute', CHANNELUP: 'ChannelUp', CHANNELDOWN: 'ChannelDown',
};
const TV_INPUTS = [
  { id: 'InputTuner', label: 'TV' },
  { id: 'InputHDMI1', label: 'HDMI 1' },
  { id: 'InputHDMI2', label: 'HDMI 2' },
  { id: 'InputHDMI3', label: 'HDMI 3' },
  { id: 'InputHDMI4', label: 'HDMI 4' },
  { id: 'InputAV1', label: 'AV' },
];

function xmlDecode(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function xmlField(xml, name) {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match ? xmlDecode(match[1]) : null;
}

class RokuDriver extends BaseDriver {
  static brand = 'roku';

  static capabilities = ['apps', 'inputs', 'text', 'textDelete', 'powerOff'];

  static buttons = [...Object.keys(KEYS), ...Object.keys(TV_KEYS)];

  constructor({ host, config = {} }) {
    super({ host, config });
    this.base = config.base || `http://${host}:8060`;
    this.isTv = false;
    this.info = null;
  }

  async _request(path, method = 'GET') {
    const res = await httpRequest(`${this.base}${path}`, { method, body: method === 'POST' ? '' : undefined });
    if (res.status === 403) throw friendly('CONTROL_DISABLED', 'Network control is turned off on this Roku');
    if (res.status >= 300) throw friendly('REQUEST_FAILED', `The TV answered with status ${res.status}`);
    return res.body;
  }

  async connect() {
    let xml;
    try {
      xml = await this._request('/query/device-info');
    } catch (err) {
      if (err.code === 'CONTROL_DISABLED') throw err;
      throw friendly('UNREACHABLE', `Cannot reach the TV at ${this.host}`, err);
    }
    this.isTv = xmlField(xml, 'is-tv') === 'true';
    this.info = {
      model: xmlField(xml, 'model-name'),
      product: xmlField(xml, 'vendor-name') || 'Roku',
      mac: xmlField(xml, 'ethernet-mac'),
      wifiMac: xmlField(xml, 'wifi-mac'),
    };
    return null;
  }

  async getInfo() {
    return this.info;
  }

  // Only Roku TVs have volume and channel keys and inputs. Players pass these to the TV by HDMI-CEC or not at all.
  liveCapabilities() {
    const remove = this.isTv ? [] : ['inputs', 'powerOff'];
    return RokuDriver.capabilities.filter((name) => !remove.includes(name));
  }

  liveButtons() {
    return this.isTv ? RokuDriver.buttons : Object.keys(KEYS);
  }

  watchState(onState) {
    this._startPolling(async () => {
      const xml = await this._request('/query/active-app');
      const match = /<app\b[^>]*\bid="([^"]+)"/.exec(xml);
      onState({ appId: match ? match[1] : null });
    });
  }

  _press(key) {
    return this._request(`/keypress/${key}`, 'POST');
  }

  async button(name) {
    await this._press(mapButton({ ...KEYS, ...TV_KEYS }, name));
  }

  async insertText(text) {
    for (const char of String(text)) await this._press(`Lit_${encodeURIComponent(char)}`);
  }

  async deleteCharacters(count = 1) {
    for (let i = 0; i < Number(count); i += 1) await this._press('Backspace');
  }

  async sendEnter() {
    await this._press('Enter');
  }

  async listApps() {
    const xml = await this._request('/query/apps');
    return [...xml.matchAll(/<app\b[^>]*\bid="([^"]+)"[^>]*>([^<]*)<\/app>/g)]
      .map(([, id, title]) => ({ id: xmlDecode(id), title: xmlDecode(title) }));
  }

  async launchApp(id) {
    await this._request(`/launch/${encodeURIComponent(id)}`, 'POST');
  }

  async listInputs() {
    return this.isTv ? TV_INPUTS : [];
  }

  async switchInput(id) {
    if (!TV_INPUTS.some((input) => input.id === id)) throw friendly('BAD_INPUT', `Unknown input: ${id}`);
    await this._press(id);
  }

  async powerOff() {
    await this._press('PowerOff');
  }
}

module.exports = { RokuDriver };
