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
};

let toastTimer;
function showError(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

async function act(name, ...args) {
  const result = await lgtv.action(name, ...args);
  if (!result.ok) showError(result.error);
  return result;
}

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
    const result = await lgtv.wake(host);
    setMessage(result.ok ? 'נשלחה בקשת הדלקה. החיבור יתחדש כשהטלוויזיה תעלה.' : result.error, !result.ok);
    if (result.ok) startConnect(host);
  }
});

$('mute').addEventListener('click', () => act('setMute', !ui.muted));

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

async function startConnect(host, pairingType) {
  ui.host = host;
  const result = await lgtv.connect(host, pairingType);
  if (!result.ok) setMessage(result.error, true);
}

$('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  startConnect($('host').value.trim());
});

$('pin-mode').addEventListener('click', () => {
  const host = $('host').value.trim();
  if (!host) {
    setMessage('כתוב קודם את כתובת הטלוויזיה.', true);
    return;
  }
  startConnect(host, 'PIN');
});

$('pin-send').addEventListener('click', async () => {
  const result = await lgtv.action('submitPin', $('pin').value.trim());
  if (!result.ok) setMessage(result.error, true);
});

$('scan').addEventListener('click', async () => {
  setMessage('מחפש טלוויזיות...');
  const result = await lgtv.discover();
  if (!result.ok || !result.value.length) {
    setMessage('לא נמצאה טלוויזיה. בדוק שהיא דלוקה, או כתוב את הכתובת שלה מהגדרות הרשת.', true);
    return;
  }
  setMessage(`נמצאו ${result.value.length}. בחר טלוויזיה.`);
  renderTvList(result.value.map((tv) => ({ host: tv.host, label: tv.name })), false);
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
      startConnect(tv.host);
    });
    row.append(pick);
    if (canForget) {
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.textContent = 'שכח';
      forget.addEventListener('click', async () => {
        const result = await lgtv.forget(tv.host);
        if (result.ok) renderTvList(result.value.tvs, true);
      });
      row.append(forget);
    }
    list.append(row);
  }
}

const STATUS_TEXT = {
  connecting: 'מתחבר...',
  reconnecting: 'החיבור נותק. מנסה שוב...',
};

function applyStatus({ state, host, info, error, pairingType }) {
  $('led').dataset.state = state;
  const connected = state === 'connected';
  ui.connected = connected;
  if (host) ui.host = host;

  $('connect-form').hidden = connected;
  $('stand').hidden = !connected;
  $('drawer').hidden = !connected;
  $('volume').disabled = !connected;
  $('pin-row').hidden = !(state === 'pairing' && pairingType === 'PIN');

  if (state === 'pairing') {
    setMessage(pairingType === 'PIN'
      ? 'כתוב כאן את הקוד שמופיע על מסך הטלוויזיה.'
      : 'אשר את הבקשה על מסך הטלוויזיה בעזרת השלט.');
  } else if (STATUS_TEXT[state]) {
    setMessage(error ? `${STATUS_TEXT[state]} (${error})` : STATUS_TEXT[state]);
  } else if (error) {
    setMessage(error, true);
  } else if (state === 'disconnected') {
    setMessage('');
  }

  if (connected) {
    setMessage('');
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

async function refreshSaved() {
  const result = await lgtv.saved();
  if (!result.ok) return;
  renderTvList(result.value.tvs, true);
  if (result.value.lastHost && !$('host').value) $('host').value = result.value.lastHost;
}

/* Apps and inputs */
async function loadLists() {
  const [apps, inputs] = await Promise.all([lgtv.action('listApps'), lgtv.action('listInputs')]);
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
  $('live').textContent = on ? 'הפסק להציג' : 'הצג את המסך';
  if (!on) {
    ui.frames = [];
    $('fps').textContent = '';
    if (!silent) lgtv.liveStop();
    if (ui.connected) {
      $('frame').hidden = true;
      $('placeholder').hidden = false;
    }
  }
}

async function startLive() {
  const result = await lgtv.liveStart(Number($('rate').value));
  if (!result.ok) {
    showError(result.error);
    return;
  }
  ui.live = true;
  $('live').setAttribute('aria-pressed', 'true');
  $('live').textContent = 'הפסק להציג';
}

$('live').addEventListener('click', () => (ui.live ? setLive(false) : startLive()));
$('placeholder-live').addEventListener('click', startLive);
$('rate').addEventListener('change', () => lgtv.liveInterval(Number($('rate').value)));

lgtv.on('frame', ({ src }) => {
  if (!ui.live) return;
  const frame = $('frame');
  frame.src = src;
  frame.hidden = false;
  $('placeholder').hidden = true;
  const now = performance.now();
  ui.frames.push(now);
  ui.frames = ui.frames.filter((t) => now - t < 5000);
  if (ui.frames.length > 1) {
    const fps = (ui.frames.length - 1) / ((now - ui.frames[0]) / 1000);
    $('fps').textContent = `${fps.toFixed(1)} תמונות בשנייה`;
  }
});

lgtv.on('live-stopped', ({ error, code }) => {
  setLive(false, true);
  showError(code === 'NO_PERMISSION'
    ? 'הטלוויזיה הזו חוסמת צילום מסך. השליטה ממשיכה לעבוד.'
    : `התצוגה הופסקה: ${error}`);
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
});

function flushPointer() {
  ui.moveScheduled = false;
  const { pendingMove: m, pendingScroll: s } = ui;
  if (m.dx || m.dy) lgtv.move(m.dx, m.dy);
  if (s.dx || s.dy) lgtv.scroll(s.dx, s.dy);
  ui.pendingMove = { dx: 0, dy: 0 };
  ui.pendingScroll = { dx: 0, dy: 0 };
}

function schedulePointer() {
  if (ui.moveScheduled) return;
  ui.moveScheduled = true;
  setTimeout(flushPointer, 16);
}

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== screen) return;
  ui.pendingMove.dx += event.movementX;
  ui.pendingMove.dy += event.movementY;
  schedulePointer();
});

screen.addEventListener('mousedown', (event) => {
  if (document.pointerLockElement !== screen) return;
  event.preventDefault();
  if (event.button === 0) act('click');
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
  $('screen-toggle').textContent = next ? 'הדלק את המסך' : 'כבה רק את המסך';
});

$('disconnect').addEventListener('click', () => lgtv.disconnect());

/* State from main */
lgtv.on('status', applyStatus);
lgtv.on('tv-state', ({ volume, muted, appId }) => {
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

refreshSaved();
