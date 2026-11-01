// Drives the phone app in a phone-sized Electron window, through a relay, to an agent with a fake adapter.
// Pass a relay address to test a running one, such as `wrangler dev`. Otherwise it starts the Node relay.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { _electron: electron } = require('playwright-core');

global.TvSession = require('../anywhere/shared/session');
const Agent = require('../anywhere/agent/core');
const { startRelay } = require('../anywhere/relay/server');

const OUT = path.join(__dirname, 'output');
const SITE = path.join(__dirname, '..', 'anywhere', 'dist', 'phone');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

async function waitFor(check, label, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => (values.has(k) ? values.get(k) : null), setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const relay = process.argv[2] ? null : await startRelay({ port: 0, host: '127.0.0.1' });
  const relayUrl = process.argv[2] || `ws://127.0.0.1:${relay.port}`;

  const log = [];
  const record = (name) => (...args) => { const done = args.pop(); log.push([name, ...args]); done(null); };
  const adapter = {
    info: () => ({
      brand: 'webos', model: 'OLED55C6', capabilities: ['apps', 'inputs', 'text', 'textDelete', 'volumeSet', 'mute', 'screenOff', 'powerOff', 'pointer', 'capture'],
      buttons: ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'HOME', 'EXIT', 'VOLUMEUP', 'VOLUMEDOWN', 'MUTE', 'CHANNELUP', 'CHANNELDOWN', 'QMENU', 'PLAY', 'PAUSE', 'REWIND', 'FASTFORWARD', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    }),
    getState: (done) => done(null, { volume: 25, muted: false }),
    button: record('button'), move: record('move'), click: record('click'), scroll: record('scroll'), insertText: record('insertText'),
    deleteCharacters: record('deleteCharacters'), sendEnter: record('sendEnter'), launchApp: record('launchApp'), switchInput: record('switchInput'),
    setVolume: record('setVolume'), setMute: record('setMute'), powerOff: record('powerOff'), screenOff: record('screenOff'), screenOn: record('screenOn'),
    listApps: (done) => done(null, [{ id: 'yt', title: 'YouTube' }, { id: 'evil', title: '<img src=x onerror=alert(1)>' }]),
    listInputs: (done) => done(null, [{ id: 'HDMI_1', label: 'HDMI 1' }]),
    capture: (done) => done(null, { mime: 'image/png', data: PIXEL }),
  };
  const agent = new Agent({ relay: relayUrl, adapter, storage: memoryStorage(), WebSocketClass: WebSocket, onChange: () => {} });
  agent.start();
  await waitFor(() => agent.status === 'online', 'agent online');

  const site = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.replace(/^\//, '') || 'index.html';
    const file = path.join(SITE, path.basename(name));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));

  const main = path.join(OUT, 'anywhere-electron-main.js');
  fs.writeFileSync(main, `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 390, height: 844, useContentSize: true, webPreferences: { sandbox: true } });
  win.loadURL(process.env.PHONE_URL);
});`);
  const app = await electron.launch({ args: [main], env: { ...process.env, PHONE_URL: `http://127.0.0.1:${site.address().port}/?relay=${encodeURIComponent(relayUrl)}` } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  if ((await page.getAttribute('html', 'lang')) !== 'en') await page.click('#lang');
  await page.screenshot({ path: path.join(OUT, 'phone-login.png') });

  await page.fill('#id', agent.codes.id);
  assert.match(await page.inputValue('#id'), /^\d{3} \d{3} \d{3}$/);
  await page.fill('#password', 'WRONGWRONG');
  await page.click('#connect');
  await waitFor(async () => /password is wrong/.test(await page.textContent('#message')), 'wrong password message');
  console.log('ok wrong password is explained');

  await page.fill('#id', '000000000');
  await page.click('#connect');
  await waitFor(async () => /isn't connected/.test(await page.textContent('#message')), 'unknown ID message');
  console.log('ok unknown ID is explained');

  await page.fill('#id', agent.codes.id);
  await page.fill('#password', agent.codes.password.toLowerCase());
  await page.click('#connect');
  await page.waitForSelector('#remote:not([hidden])');
  assert.equal(await page.textContent('#tv-name'), 'OLED55C6');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'no sideways scrolling on a phone');
  await page.screenshot({ path: path.join(OUT, 'phone-remote.png') });
  console.log('ok connected');

  const seen = (name) => log.some((entry) => entry[0] === name);
  await page.click('[data-button="HOME"]');
  await page.click('[data-button="UP"]');
  await waitFor(() => log.filter((e) => e[0] === 'button').length === 2, 'buttons');
  assert.deepEqual(log.filter((e) => e[0] === 'button').map((e) => e[1]), ['HOME', 'UP']);
  console.log('ok buttons');

  await page.click('#tab-apps');
  await page.click('#app-list button:has-text("YouTube")');
  await waitFor(() => seen('launchApp'), 'launch');
  assert.equal(await page.locator('#app-list img').count(), 0, 'app names are text');
  console.log('ok apps');

  await page.click('.tab[data-tab="more"]');
  await page.click('#input-list button');
  await page.fill('#text', 'שלום');
  await page.click('#text-form button[type=submit]');
  await waitFor(() => log.some((e) => e[0] === 'insertText' && e[1] === 'שלום'), 'text');
  await waitFor(() => seen('switchInput'), 'input');
  await page.click('#live');
  await page.waitForSelector('#view:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'phone-live.png') });
  await page.click('#live');
  console.log('ok inputs, typing, screen view');

  await page.click('#tab-mouse');
  const box = await page.locator('#touchpad').boundingBox();
  const session = await page.context().newCDPSession(page);
  const touch = (type, x, y) => session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + y }] });
  await touch('touchStart', 50, 50);
  await touch('touchMove', 90, 80);
  await delay(80);
  await touch('touchEnd');
  await waitFor(() => seen('move'), 'touchpad movement');
  await touch('touchStart', 60, 60);
  await touch('touchEnd');
  await waitFor(() => seen('click'), 'tap to click');
  console.log('ok touchpad');

  await page.click('#power');
  await waitFor(() => seen('powerOff'), 'power off after confirmation');

  await page.click('#leave');
  await page.waitForSelector('#login:not([hidden])');
  await waitFor(() => !agent.peer, 'TV sees the phone leave');
  console.log('ok disconnect');

  assert.deepEqual(errors, []);
  await app.close();
  if (agent.ws) { agent.ws.onclose = null; agent.ws.close(); }
  site.close();
  if (relay) await relay.close();
  fs.rmSync(main, { force: true });
  console.log('PHONE E2E PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('PHONE E2E FAILED:', err);
  process.exit(1);
});
