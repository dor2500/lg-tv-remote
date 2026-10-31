const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { WebOSClient, wakeOnLan, discover } = require('./webos');
const store = require('./store');

// Test hook: run against tests/fake-tv.js instead of a real TV.
const FAKE_ENDPOINTS = process.env.LGTV_FAKE_ENDPOINTS ? process.env.LGTV_FAKE_ENDPOINTS.split(',') : null;

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
    title: 'LG TV Remote',
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

async function connect(host, pairingType = 'PROMPT') {
  clearTimeout(reconnectTimer);
  stopLive();
  if (tv) {
    tv.removeAllListeners('closed');
    tv.close();
  }
  wantConnected = host;
  status('connecting', { host });

  const client = new WebOSClient({ host, clientKey: store.getKey(host), endpoints: FAKE_ENDPOINTS });
  tv = client;
  client.on('pairing', (type) => status('pairing', { host, pairingType: type }));
  client.on('key', (key) => store.saveTv(host, { key }));
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
      connect(host).catch(() => {});
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
    if (store.getKey(host) && err.code === 'UNREACHABLE') {
      status('reconnecting', { host, error: err.message, errorCode: err.code });
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect(host).catch(() => {});
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
    label: [info.product, info.model].filter(Boolean).join(' · ') || host,
    mac: info.mac,
    wifiMac: info.wifiMac,
  });
  subscribeState(client);
  status('connected', { host, info, endpoint: client.endpoint });
  return info;
}

function subscribeState(client) {
  const safe = (uri, handler) => {
    try {
      client.subscribe(uri, handler);
    } catch {
      // Live state is a nicety; controls keep working without it.
    }
  };
  safe('ssap://audio/getVolume', (p) => {
    const volume = p.volumeStatus ? p.volumeStatus.volume : p.volume;
    const muted = p.volumeStatus ? p.volumeStatus.muteStatus : p.muted;
    send('tv-state', { volume, muted });
  });
  safe('ssap://com.webos.applicationManager/getForegroundAppInfo', (p) => send('tv-state', { appId: p.appId }));
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
  handle('tv:connect', (host, pairingType) => connect(String(host).trim(), pairingType));
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
