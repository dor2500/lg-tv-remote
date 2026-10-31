// The list of supported TV platforms, plus finding out which one is at a given address.
const { friendly, httpRequest, portOpen, wakeOnLan } = require('./common');
const { WebOSClient } = require('./webos');
const { SamsungDriver } = require('./samsung');
const { RokuDriver } = require('./roku');
const { VizioDriver } = require('./vizio');
const { SonyDriver } = require('./sony');
const { AndroidTvDriver } = require('./androidtv');

const DRIVERS = {
  webos: WebOSClient,
  samsung: SamsungDriver,
  androidtv: AndroidTvDriver,
  roku: RokuDriver,
  vizio: VizioDriver,
  sony: SonyDriver,
};

function createDriver(brand, { host, credentials, config = {} }) {
  const Driver = Object.hasOwn(DRIVERS, brand) ? DRIVERS[brand] : null;
  if (!Driver) throw friendly('BAD_INPUT', `Unknown TV type: ${brand}`);
  return new Driver({ host, credentials, config: config[brand] || {} });
}

function capabilitiesOf(driver) {
  return driver.liveCapabilities ? driver.liveCapabilities() : driver.constructor.capabilities;
}

function buttonsOf(driver) {
  return driver.liveButtons ? driver.liveButtons() : driver.constructor.buttons;
}

async function bodyOf(url, options) {
  try {
    const res = await httpRequest(url, { timeoutMs: 2500, ...options });
    return res.body;
  } catch {
    return '';
  }
}

function portOf(url, fallback) {
  return url ? Number(new URL(url).port) : fallback;
}

// Ordered from the most certain answer to the least. A Sony TV also answers as Android TV, which needs no setup on the TV.
const PROBES = [
  ['roku', async (host, c) => /<device-info>/.test(await bodyOf(`${c.base || `http://${host}:8060`}/query/device-info`))],
  ['samsung', async (host, c) => /samsung/i.test(await bodyOf(`${c.restBase || `http://${host}:8001`}/api/v2/`))],
  ['webos', async (host, c) => {
    const endpoint = c.endpoints && c.endpoints[0];
    return portOpen(endpoint ? new URL(endpoint).hostname : host, portOf(endpoint, 3001));
  }],
  ['vizio', async (host, c) => {
    const bases = c.bases || [`https://${host}:7345`, `https://${host}:9000`];
    const bodies = await Promise.all(bases.map((base) => bodyOf(`${base}/state/device/deviceinfo`)));
    return bodies.some((body) => /"status"/i.test(body));
  }],
  ['androidtv', async (host, c) => {
    const target = c.connectHost || host;
    const open = await Promise.all([portOpen(target, c.remotePort || 6466), portOpen(target, c.pairingPort || 6467)]);
    return open[0] && open[1];
  }],
  ['sony', async (host, c) => {
    const body = await bodyOf(`${c.base || `http://${host}`}/sony/guide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getVersions', params: [], id: 1, version: '1.0' }),
    });
    return /"result"/.test(body);
  }],
];

async function detectBrand(host, config = {}) {
  const results = await Promise.all(PROBES.map(([brand, probe]) => probe(host, config[brand] || {}).catch(() => false)));
  const index = results.indexOf(true);
  if (index < 0) throw friendly('NOT_DETECTED', `No supported TV answered at ${host}`);
  return PROBES[index][0];
}

module.exports = { DRIVERS, createDriver, capabilitiesOf, buttonsOf, detectBrand, wakeOnLan };
