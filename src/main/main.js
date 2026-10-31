const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { createDriver, capabilitiesOf, buttonsOf, detectBrand, wakeOnLan } = require('./drivers');
const { discover } = require('./drivers/discovery');
const store = require('./store');

// Test hook: run against the simulated TVs in tests/ instead of real ones.
const TEST_CONFIG = process.env.TV_TEST_CONFIG ? JSON.parse(process.env.TV_TEST_CONFIG) : {};

// Before the rename this app kept its data, including the keys that decrypt saved pairings, in another folder.
const LEGACY_DATA = path.join(app.getPath('appData'), 'lg-tv-remote');
if (!app.commandLine.hasSwitch('user-data-dir') && fs.existsSync(LEGACY_DATA)) app.setPath('userData', LEGACY_DATA);

let win = null;
let tv = null;
let reconnectTimer = null;
let wantConnected = null; // host the user asked to stay connected to
let reconnectDelay = 2000;
let live = { running: false, intervalMs: 500, token: 0 };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function status(state, extra = {}) {
  send('status', { state, ...extra });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1020,
    minHeight: 660,
    backgroundColor: '#0d0f12',
    autoHideMenuBar: true,
    title: 'Universal TV Remote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

async function connect(host, pairingType = 'PROMPT', requestedBrand = null) {
  clearTimeout(reconnectTimer);
  stopLive();
  if (tv) {
    tv.removeAllListeners('closed');
    tv.close();
  }
  wantConnected = host;
  status('connecting', { host });

  let brand = requestedBrand && requestedBrand !== 'auto' ? requestedBrand : store.getBrand(host);
  if (!brand) {
    try {
      brand = await detectBrand(host, TEST_CONFIG);
    } catch (err) {
      if (wantConnected === host) {
        wantConnected = null;
        status('disconnected', { error: err.message, errorCode: err.code });
      }
      throw err;
    }
    if (wantConnected !== host) return null;
  }
  // A key belongs to one platform, so a different choice for this address starts a new pairing.
  const credentials = store.getBrand(host) === brand ? store.getKey(host) : null;
  const client = createDriver(brand, { host, credentials, config: TEST_CONFIG });
  tv = client;
  client.on('pairing', (type) => status('pairing', { host, pairingType: type }));
  client.on('key', (key) => store.saveTv(host, { key, brand }));
  client.on('socket-error', () => {});
  client.on('closed', ({ byUser }) => {
    if (tv !== client) return;
    stopLive();
    tv = null;
    if (byUser || wantConnected !== host) {
      status('disconnected');
      return;
    }
    status('reconnecting', { host });
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect(host, 'PROMPT', brand).catch(() => {});
    }, reconnectDelay);
  });

  try {
    await client.connect({ pairingType });
  } catch (err) {
    if (tv === client) {
      client.removeAllListeners('closed');
      client.close();
      tv = null;
    }
    // Keep retrying a TV we were already paired with (it may just be off); a failed first pairing stops.
    if (store.getBrand(host) === brand && err.code === 'UNREACHABLE') {
      status('reconnecting', { host, error: err.message, errorCode: err.code });
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect(host, 'PROMPT', brand).catch(() => {});
      }, reconnectDelay);
    } else {
      wantConnected = null;
      status('disconnected', { error: err.message, errorCode: err.code });
    }
    throw err;
  }

  reconnectDelay = 2000;
  const info = await client.getInfo();
  store.saveTv(host, {
    brand,
    label: [info.product, info.model].filter(Boolean).join(' · ') || host,
    mac: info.mac,
    wifiMac: info.wifiMac,
  });
  client.watchState((state) => send('tv-state', state));
  status('connected', { host, info, brand, capabilities: capabilitiesOf(client), buttons: buttonsOf(client) });
  return info;
}

function stopLive() {
  live.running = false;
  live.token += 1;
}

async function liveLoop(token) {
  let failures = 0;
  while (live.running && token === live.token && tv) {
    const started = Date.now();
    try {
      const { mime, data } = await tv.capture();
      if (token !== live.token) return;
      failures = 0;
      send('frame', { src: `data:${mime};base64,${data.toString('base64')}`, tookMs: Date.now() - started });
    } catch (err) {
      failures += 1;
      if (err.code === 'NO_PERMISSION' || failures >= 3) {
        if (token === live.token) {
          stopLive();
          send('live-stopped', { error: err.message, code: err.code });
        }
        return;
      }
    }
    const wait = live.intervalMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

// The renderer translates these by code.
function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requireTv() {
  if (!tv) throw codedError('NOT_CONNECTED', 'Not connected to the TV');
  return tv;
}

// The renderer can only reach these named actions, never arbitrary SSAP URIs.
const actions = {
  button: (name) => requireTv().button(name),
  click: () => requireTv().click(),
  insertText: (text) => requireTv().insertText(text),
  deleteCharacters: (count) => requireTv().deleteCharacters(count),
  sendEnter: () => requireTv().sendEnter(),
  listApps: () => requireTv().listApps(),
  launchApp: (id) => requireTv().launchApp(id),
  listInputs: () => requireTv().listInputs(),
  switchInput: (id) => requireTv().switchInput(id),
  setVolume: (v) => requireTv().setVolume(v),
  setMute: (m) => requireTv().setMute(m),
  powerOff: () => requireTv().powerOff(),
  screenOff: () => requireTv().screenOff(),
  screenOn: () => requireTv().screenOn(),
  toast: (m) => requireTv().toast(m),
  submitPin: (pin) => requireTv().submitPin(pin),
};

function handle(channel, fn) {
  // Return errors as data: Electron otherwise wraps thrown messages in English boilerplate.
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });
}

function registerIpc() {
  handle('tv:action', (name, ...args) => {
    if (!Object.hasOwn(actions, name)) throw new Error(`Unknown action: ${name}`);
    return actions[name](...args);
  });
  handle('tv:connect', (host, pairingType, brand) => connect(String(host).trim(), pairingType, brand));
  handle('tv:disconnect', () => {
    clearTimeout(reconnectTimer);
    wantConnected = null;
    stopLive();
    if (tv) tv.close();
    else status('disconnected');
  });
  handle('tv:forget', (host) => {
    store.forgetTv(host);
    return store.listTvs();
  });
  handle('tv:saved', () => store.listTvs());
  handle('tv:discover', () => discover());
  handle('tv:wake', async (host) => {
    const macs = store.getMacs(host);
    if (!macs.length) throw codedError('NO_MAC', 'The MAC address is not known yet');
    await Promise.all(macs.map((mac) => wakeOnLan(mac)));
  });
  handle('live:start', (intervalMs) => {
    requireTv();
    live.intervalMs = clampInterval(intervalMs);
    if (live.running) return;
    live.running = true;
    live.token += 1;
    liveLoop(live.token);
  });
  handle('live:interval', (intervalMs) => { live.intervalMs = clampInterval(intervalMs); });
  handle('live:stop', () => stopLive());

  // High-frequency pointer traffic is fire-and-forget.
  ipcMain.on('pointer:move', (_e, dx, dy) => { if (tv) tv.move(dx, dy).catch(() => {}); });
  ipcMain.on('pointer:scroll', (_e, dx, dy) => { if (tv) tv.scroll(dx, dy).catch(() => {}); });
}

function clampInterval(value) {
  return Math.max(100, Math.min(5000, Number(value) || 500));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => {
    wantConnected = null;
    clearTimeout(reconnectTimer);
    if (tv) tv.close();
    app.quit();
  });
}
