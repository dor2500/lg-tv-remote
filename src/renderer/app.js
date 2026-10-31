const $ = (id) => document.getElementById(id);

const ui = {
  host: null,
  connected: false,
  live: false,
  apps: [],
  currentApp: null,
  frames: [],
  screenOff: false,
  muted: false,
  pendingMove: { dx: 0, dy: 0 },
  pendingScroll: { dx: 0, dy: 0 },
  moveScheduled: false,
  cursor: { x: 0, y: 0 },
  homing: false,
  lastStatus: { state: 'disconnected' },
  capabilities: [],
};

const can = (capability) => ui.capabilities.includes(capability);

let toastTimer;
function showError(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

async function act(name, ...args) {
  const result = await tvRemote.action(name, ...args);
  if (!result.ok) showError(errorText(result));
  return result;
}

/* Language */
function renderDynamicText() {
  $('live').textContent = t(ui.live ? 'stopScreen' : 'showScreen');
  $('screen-toggle').textContent = t(ui.screenOff ? 'screenOn' : 'screenOff');
  $('fps').textContent = '';
  ui.frames = [];
  $('view-text').textContent = t(can('capture') ? 'viewOff' : 'viewUnsupported');
  renderStatusMessage(ui.lastStatus);
}

$('lang').addEventListener('click', () => {
  setLanguage(language === 'he' ? 'en' : 'he');
  renderDynamicText();
  if (!ui.connected) refreshSaved();
});

/* Remote keys */
const numpad = $('numpad');
for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
  const key = document.createElement('button');
  key.className = digit === '0' ? 'key zero' : 'key';
  key.textContent = digit;
  key.dataset.button = digit;
  numpad.append(key);
}

document.querySelector('.remote').addEventListener('click', (event) => {
  const key = event.target.closest('[data-button]');
  if (key) act('button', key.dataset.button);
});

$('power').addEventListener('click', async () => {
  if (ui.connected) {
    act('powerOff');
  } else if (ui.host || $('host').value.trim()) {
    const host = ui.host || $('host').value.trim();
    const result = await tvRemote.wake(host);
    setMessage(result.ok ? t('wakeSent') : errorText(result), !result.ok);
    if (result.ok) startConnect(host);
  }
});

$('mute').addEventListener('click', () => (can('mute') ? act('setMute', !ui.muted) : act('button', 'MUTE')));

let volumeTimer;
$('volume').addEventListener('input', (event) => {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => act('setVolume', Number(event.target.value)), 120);
});

/* Connecting */
function setMessage(text, isError = false) {
  const message = $('connect-msg');
  message.textContent = text || '';
  message.classList.toggle('error', isError);
}

async function startConnect(host, pairingType, brand = $('brand').value) {
  ui.host = host;
  const result = await tvRemote.connect(host, pairingType, brand);
  if (!result.ok) setMessage(errorText(result), true);
}

$('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  startConnect($('host').value.trim());
});

$('pin-mode').addEventListener('click', () => {
  const host = $('host').value.trim();
  if (!host) {
    setMessage(t('enterAddressFirst'), true);
    return;
  }
  startConnect(host, 'PIN', 'webos');
});

// Only LG TVs can be asked to pair by code instead of by an on-screen prompt.
function renderBrandChoice() {
  const brand = $('brand').value;
  $('pin-mode').hidden = brand !== 'auto' && brand !== 'webos';
}
$('brand').addEventListener('change', renderBrandChoice);

$('pin-send').addEventListener('click', async () => {
  const result = await tvRemote.action('submitPin', $('pin').value.trim());
  if (!result.ok) setMessage(errorText(result), true);
});

$('scan').addEventListener('click', async () => {
  setMessage(t('scanning'));
  const result = await tvRemote.discover();
  if (!result.ok || !result.value.length) {
    setMessage(t('scanNone'), true);
    return;
  }
  setMessage(t('scanFound', { count: result.value.length }));
  renderTvList(result.value.map((tv) => ({ host: tv.host, brand: tv.brand, label: tv.name })), false);
});

function renderTvList(tvs, canForget) {
  const list = $('tv-list');
  list.replaceChildren();
  for (const tv of tvs) {
    const row = document.createElement('li');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pick';
    pick.textContent = tv.label === tv.host ? tv.host : `${tv.label} (${tv.host})`;
    pick.addEventListener('click', () => {
      $('host').value = tv.host;
      $('brand').value = tv.brand;
      renderBrandChoice();
      startConnect(tv.host, undefined, tv.brand);
    });
    row.append(pick);
    if (canForget) {
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.textContent = t('forget');
      forget.addEventListener('click', async () => {
        const result = await tvRemote.forget(tv.host);
        if (result.ok) renderTvList(result.value.tvs, true);
      });
      row.append(forget);
    }
    list.append(row);
  }
}

const STATUS_TEXT = {
  connecting: 'connecting',
  reconnecting: 'reconnecting',
};

function renderStatusMessage({ state, error, errorCode, pairingType }) {
  const detail = error ? errorText({ code: errorCode, error }) : '';
  if (state === 'pairing') {
    const messages = { PIN: 'pairingPin', CODE: 'pairingPin', PSK: 'pairingPsk' };
    setMessage(t(messages[pairingType] || 'pairingPrompt'));
  } else if (STATUS_TEXT[state]) {
    setMessage(detail ? `${t(STATUS_TEXT[state])} (${detail})` : t(STATUS_TEXT[state]));
  } else if (detail) {
    setMessage(detail, true);
  } else {
    setMessage('');
  }
}

function applyStatus(status) {
  const { state, host, info, pairingType } = status;
  ui.lastStatus = status;
  $('led').dataset.state = state;
  const connected = state === 'connected';
  ui.connected = connected;
  if (host) ui.host = host;

  $('connect-form').hidden = connected;
  $('stand').hidden = !connected;
  $('drawer').hidden = !connected;
  $('volume').disabled = !connected;
  $('pin-row').hidden = !(state === 'pairing' && pairingType !== 'PROMPT');

  renderStatusMessage(status);

  if (connected) {
    applyCapabilities(status);
    $('tv-name').textContent = [info.product, info.model].filter(Boolean).join(', ');
    loadLists();
    setLive(false);
  } else {
    setLive(false, true);
    if (document.pointerLockElement) document.exitPointerLock();
    $('placeholder').hidden = true;
    $('frame').hidden = true;
    if (state === 'disconnected') refreshSaved();
  }
}

// Each TV platform offers different features, so only what this TV can do stays on screen.
function applyCapabilities({ capabilities, buttons }) {
  ui.capabilities = capabilities;
  for (const key of document.querySelectorAll('[data-button]')) key.hidden = !buttons.includes(key.dataset.button);
  $('mute').hidden = !can('mute') && !buttons.includes('MUTE');
  $('volume').hidden = !can('volumeSet');
  const capture = can('capture');
  for (const id of ['live', 'fps', 'placeholder-live']) $(id).hidden = !capture;
  document.querySelector('.rate').hidden = !capture;
  $('view-text').textContent = t(capture ? 'viewOff' : 'viewUnsupported');
  $('lock').hidden = !can('pointer');
  $('screen-toggle').hidden = !can('screenOff');
  $('panel-apps').hidden = !can('apps');
  $('apps-hint').hidden = !can('appsCommon');
  $('panel-inputs').hidden = !can('inputs');
  $('panel-text').hidden = !can('text');
  $('text-del').hidden = !can('textDelete');
}

async function refreshSaved() {
  const result = await tvRemote.saved();
  if (!result.ok) return;
  renderTvList(result.value.tvs, true);
  if (result.value.lastHost && !$('host').value) {
    $('host').value = result.value.lastHost;
    const last = result.value.tvs.find((tv) => tv.host === result.value.lastHost);
    if (last) $('brand').value = last.brand;
    renderBrandChoice();
  }
}

/* Apps and inputs */
async function loadLists() {
  const [apps, inputs] = await Promise.all([
    can('apps') ? tvRemote.action('listApps') : { ok: true, value: [] },
    can('inputs') ? tvRemote.action('listInputs') : { ok: true, value: [] },
  ]);
  ui.apps = apps.ok ? apps.value : [];
  renderApps();
  const list = $('inputs');
  list.replaceChildren();
  for (const input of inputs.ok ? inputs.value : []) {
    list.append(listButton(input.label, () => act('switchInput', input.id)));
  }
}

function listButton(text, onClick, current = false) {
  const row = document.createElement('li');
  const button = document.createElement('button');
  button.textContent = text;
  if (current) button.setAttribute('aria-current', 'true');
  button.addEventListener('click', onClick);
  row.append(button);
  return row;
}

function renderApps() {
  const filter = $('app-filter').value.trim().toLowerCase();
  const list = $('apps');
  list.replaceChildren();
  for (const app of ui.apps) {
    if (filter && !String(app.title).toLowerCase().includes(filter)) continue;
    list.append(listButton(app.title, () => act('launchApp', app.id), app.id === ui.currentApp));
  }
}
$('app-filter').addEventListener('input', renderApps);

/* Text */
$('text-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value;
  if (!text) return;
  const result = await act('insertText', text);
  if (result.ok) $('text').value = '';
});
$('text-del').addEventListener('click', () => act('deleteCharacters', 1));
$('text-enter').addEventListener('click', () => act('sendEnter'));

/* Screen view */
function setLive(on, silent = false) {
  ui.live = on;
  $('live').setAttribute('aria-pressed', String(on));
  $('live').textContent = t(on ? 'stopScreen' : 'showScreen');
  if (!on) {
    ui.frames = [];
    $('fps').textContent = '';
    if (!silent) tvRemote.liveStop();
    if (ui.connected) {
      $('frame').hidden = true;
      $('placeholder').hidden = false;
    }
  }
}

async function startLive() {
  const result = await tvRemote.liveStart(Number($('rate').value));
  if (!result.ok) {
    showError(errorText(result));
    return;
  }
  ui.live = true;
  $('live').setAttribute('aria-pressed', 'true');
  $('live').textContent = t('stopScreen');
}

$('live').addEventListener('click', () => (ui.live ? setLive(false) : startLive()));
$('placeholder-live').addEventListener('click', startLive);
$('rate').addEventListener('change', () => tvRemote.liveInterval(Number($('rate').value)));

tvRemote.on('frame', ({ src }) => {
  if (!ui.live) return;
  const frame = $('frame');
  frame.src = src;
  frame.hidden = false;
  $('placeholder').hidden = true;
  const now = performance.now();
  ui.frames.push(now);
  ui.frames = ui.frames.filter((time) => now - time < 5000);
  if (ui.frames.length > 1) {
    const fps = (ui.frames.length - 1) / ((now - ui.frames[0]) / 1000);
    $('fps').textContent = t('fps', { value: fps.toFixed(1) });
  }
});

tvRemote.on('live-stopped', (result) => {
  setLive(false, true);
  showError(result.code === 'NO_PERMISSION'
    ? t('captureBlocked')
    : t('liveStopped', { error: errorText({ code: result.code, error: result.error }) }));
});

/* Mouse and keyboard capture */
const screen = $('screen');

$('lock').addEventListener('click', () => screen.requestPointerLock());
$('frame').addEventListener('click', () => {
  if (document.pointerLockElement !== screen) screen.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === screen;
  screen.classList.toggle('locked', locked);
  $('lock-hint').hidden = !locked;
  $('cursor').hidden = !locked;
  if (locked) homeCursor();
});

// The TV's pointer position cannot be read, and captures leave it out. Pushing it into the top-left
// corner gives a known start, then this estimate follows it. Hitting a screen edge corrects drift.
const TV_WIDTH = 1920;
const TV_HEIGHT = 1080;

// Measured on an OLED55C6: the TV accelerates by speed. 2 units per event moved about 1 pixel per unit, 10 moved about 3.
function pointerGain(dx, dy) {
  return 0.5 + 0.25 * Math.hypot(dx, dy);
}

function renderCursor() {
  const { clientWidth: width, clientHeight: height } = screen;
  const scale = Math.min(width / TV_WIDTH, height / TV_HEIGHT);
  const left = (width - TV_WIDTH * scale) / 2 + ui.cursor.x * scale;
  const top = (height - TV_HEIGHT * scale) / 2 + ui.cursor.y * scale;
  $('cursor').style.transform = `translate(${left}px, ${top}px)`;
}

async function homeCursor() {
  ui.homing = true;
  ui.cursor = { x: 0, y: 0 };
  renderCursor();
  delete $('cursor').dataset.ready;
  for (let i = 0; i < 40 && document.pointerLockElement === screen; i += 1) {
    tvRemote.move(-60, -40);
    await new Promise((r) => setTimeout(r, 16));
  }
  ui.pendingMove = { dx: 0, dy: 0 };
  ui.homing = false;
  $('cursor').dataset.ready = 'true';
}

window.addEventListener('resize', renderCursor);

function flushPointer() {
  ui.moveScheduled = false;
  const { pendingMove: m, pendingScroll: s } = ui;
  if (m.dx || m.dy) {
    tvRemote.move(m.dx, m.dy);
    const gain = pointerGain(m.dx, m.dy);
    ui.cursor.x = Math.max(0, Math.min(TV_WIDTH, ui.cursor.x + m.dx * gain));
    ui.cursor.y = Math.max(0, Math.min(TV_HEIGHT, ui.cursor.y + m.dy * gain));
    renderCursor();
  }
  if (s.dx || s.dy) tvRemote.scroll(s.dx, s.dy);
  ui.pendingMove = { dx: 0, dy: 0 };
  ui.pendingScroll = { dx: 0, dy: 0 };
}

function schedulePointer() {
  if (ui.moveScheduled) return;
  ui.moveScheduled = true;
  setTimeout(flushPointer, 16);
}

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== screen || ui.homing) return;
  ui.pendingMove.dx += event.movementX;
  ui.pendingMove.dy += event.movementY;
  schedulePointer();
});

screen.addEventListener('mousedown', (event) => {
  if (document.pointerLockElement !== screen || ui.homing) return;
  event.preventDefault();
  if (event.button === 0) {
    act('click');
    $('cursor').classList.add('pressed');
    setTimeout(() => $('cursor').classList.remove('pressed'), 120);
  }
  if (event.button === 2) act('button', 'BACK');
});

screen.addEventListener('contextmenu', (event) => event.preventDefault());

screen.addEventListener('wheel', (event) => {
  if (document.pointerLockElement !== screen) return;
  ui.pendingScroll.dy += Math.sign(event.deltaY) * -1;
  schedulePointer();
}, { passive: true });

const KEY_BUTTONS = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENTER',
};

document.addEventListener('keydown', (event) => {
  if (document.pointerLockElement !== screen) return;
  event.preventDefault();
  if (KEY_BUTTONS[event.key]) act('button', KEY_BUTTONS[event.key]);
  else if (event.key === 'Backspace') act('deleteCharacters', 1);
  else if (event.key.length === 1 && !event.ctrlKey && !event.altKey) act('insertText', event.key);
});

/* Footer */
$('screen-toggle').addEventListener('click', async () => {
  const next = !ui.screenOff;
  const result = await act(next ? 'screenOff' : 'screenOn');
  if (!result.ok) return;
  ui.screenOff = next;
  $('screen-toggle').setAttribute('aria-pressed', String(next));
  $('screen-toggle').textContent = t(next ? 'screenOn' : 'screenOff');
});

$('disconnect').addEventListener('click', () => tvRemote.disconnect());

/* State from main */
tvRemote.on('status', applyStatus);
tvRemote.on('tv-state', ({ volume, muted, appId }) => {
  if (typeof volume === 'number' && document.activeElement !== $('volume')) $('volume').value = volume;
  if (typeof muted === 'boolean') {
    ui.muted = muted;
    $('mute').setAttribute('aria-pressed', String(muted));
  }
  if (appId !== undefined) {
    ui.currentApp = appId;
    renderApps();
  }
});

applyLanguage();
renderDynamicText();
refreshSaved();
