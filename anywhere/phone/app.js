const $ = (id) => document.getElementById(id);

const STRINGS = {
  he: {
    switchTo: 'English', loginHint: 'פתח את אפליקציית TV Anywhere בטלוויזיה, והקלד כאן את המזהה והסיסמה שהיא מציגה.',
    id: 'מזהה', password: 'סיסמה', connect: 'התחבר', disconnect: 'התנתק', power: 'כיבוי',
    tabRemote: 'שלט', tabMouse: 'עכבר', tabApps: 'אפליקציות', tabMore: 'עוד',
    up: 'למעלה', down: 'למטה', left: 'שמאלה', right: 'ימינה', back: 'חזרה', home: 'בית', exit: 'יציאה', mute: 'השתק',
    volDown: 'הנמך', volUp: 'הגבר', chDown: 'ערוץ −', chUp: 'ערוץ +', settings: 'הגדרות', rewind: 'אחורה', play: 'נגן',
    pause: 'השהה', forward: 'קדימה', padHint: 'גרור להזזת הסמן. הקשה: לחיצה. שתי אצבעות: גלילה.', screen: 'מסך הטלוויזיה',
    showScreen: 'הצג את מסך הטלוויזיה', volume: 'עוצמת קול', inputs: 'מקורות', typing: 'הקלדה',
    typingHint: 'טקסט לשדה הפתוח בטלוויזיה', send: 'שלח', deleteChar: 'מחק תו', confirm: 'אישור', screenOff: 'כבה רק את המסך',
    connecting: 'מתחבר...', checking: 'בודק את הפרטים...', errTv: 'הטלוויזיה לא מחוברת. בדוק שהיא דלוקה והאפליקציה פתוחה בה, ושהמזהה נכון.',
    errBusy: 'טלפון אחר כבר מחובר לטלוויזיה הזו.', errPassword: 'הסיסמה שגויה.', errBlocked: 'יותר מדי ניסיונות שגויים. נסה שוב מאוחר יותר.',
    errNetwork: 'אין חיבור לשרת. בדוק את האינטרנט בטלפון.', errRelay: 'השרת עוד לא הוגדר בגרסה הזו של האפליקציה.', errLost: 'החיבור נותק.', errFailed: 'הטלוויזיה לא ביצעה את הפעולה: {error}', errFake: 'התשובה לא הגיעה מהטלוויזיה שלך. החיבור הופסק.',
    confirmOff: 'לכבות את הטלוויזיה? דרך האינטרנט אי אפשר להדליק אותה שוב.',
  },
  en: {
    switchTo: 'עברית', loginHint: 'Open the TV Anywhere app on your TV, and type the ID and password it shows.',
    id: 'ID', password: 'Password', connect: 'Connect', disconnect: 'Disconnect', power: 'Turn off',
    tabRemote: 'Remote', tabMouse: 'Mouse', tabApps: 'Apps', tabMore: 'More',
    up: 'Up', down: 'Down', left: 'Left', right: 'Right', back: 'Back', home: 'Home', exit: 'Exit', mute: 'Mute',
    volDown: 'Volume down', volUp: 'Volume up', chDown: 'CH −', chUp: 'CH +', settings: 'Settings', rewind: 'Rewind', play: 'Play',
    pause: 'Pause', forward: 'Forward', padHint: 'Drag to move the pointer. Tap to click. Two fingers to scroll.', screen: 'The TV screen',
    showScreen: 'Show the TV screen', volume: 'Volume', inputs: 'Inputs', typing: 'Typing',
    typingHint: 'Text for the field open on the TV', send: 'Send', deleteChar: 'Delete character', confirm: 'Confirm', screenOff: 'Turn off screen only',
    connecting: 'Connecting...', checking: 'Checking the details...', errTv: "The TV isn't connected. Check that it is on with the app open, and that the ID is right.",
    errBusy: 'Another phone is already connected to this TV.', errPassword: 'The password is wrong.', errBlocked: 'Too many wrong tries. Try again later.',
    errNetwork: "Can't reach the server. Check your phone's internet.", errRelay: "This version of the app has no server set up yet.", errLost: 'The connection was lost.', errFailed: "The TV didn't do that: {error}", errFake: "That answer didn't come from your TV. The connection was stopped.",
    confirmOff: "Turn off the TV? It can't be turned back on over the internet.",
  },
};

function storedLanguage() {
  try {
    const saved = localStorage.getItem('language');
    if (STRINGS[saved]) return saved;
  } catch {
    // Storage can be unavailable; fall through to the phone's language.
  }
  return navigator.language.toLowerCase().startsWith('he') ? 'he' : 'en';
}

let language = storedLanguage();
const t = (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, value), STRINGS[language][key] || key);

function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
  $('lang').textContent = t('switchTo');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-aria]')) el.setAttribute('aria-label', t(el.dataset.aria));
  for (const el of document.querySelectorAll('[data-alt]')) el.alt = t(el.dataset.alt);
  for (const el of document.querySelectorAll('[data-placeholder]')) el.placeholder = t(el.dataset.placeholder);
}

$('lang').addEventListener('click', () => {
  language = language === 'he' ? 'en' : 'he';
  try {
    localStorage.setItem('language', language);
  } catch {
    // The choice then lasts only for this session.
  }
  applyLanguage();
});

/* Connection */
const link = { ws: null, cipher: null, nextId: 1, pending: new Map(), info: null, live: false, muted: false };

function setMessage(text, isError = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', isError);
}

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function relayUrl() {
  const fromPage = new URLSearchParams(location.search).get('relay');
  // The relay normally serves this page too, so its address is this page's address.
  const sameSite = location.protocol === 'https:' ? `wss://${location.host}` : '';
  return (fromPage || sameSite).replace(/\/$/, '');
}

function connect(id, password) {
  const relay = relayUrl();
  if (!relay) {
    setMessage(t('errRelay'), true);
    return;
  }
  setMessage(t('connecting'));
  $('connect').disabled = true;
  // Let the message paint: the key derivation below holds the page for a moment.
  setTimeout(() => {
    const key = TvSession.deriveKey(password, id);
    const clientNonce = TvSession.newNonce();
    const ws = new WebSocket(`${relay}/client/${id}`);
    link.ws = ws;
    let ended = false;
    const fail = (text) => {
      if (ended) return;
      ended = true;
      ws.close();
      endSession(text);
    };
    ws.onopen = () => {
      setMessage(t('checking'));
      ws.send(JSON.stringify({ t: 'hello', n: clientNonce }));
    };
    ws.onerror = () => fail(t(link.cipher ? 'errLost' : 'errNetwork'));
    ws.onclose = () => fail(t(link.cipher ? 'errLost' : 'errNetwork'));
    let pendingCipher = null;
    ws.onmessage = ({ data }) => {
      if (data === 'pong') return;
      const msg = JSON.parse(data);
      if (msg.relay === 'no-tv') fail(t(link.cipher ? 'errLost' : 'errTv'));
      else if (msg.relay === 'busy') fail(t('errBusy'));
      else if (msg.t === 'denied') fail(t('errPassword'));
      else if (msg.t === 'blocked') fail(t('errBlocked'));
      else if (msg.t === 'challenge') {
        pendingCipher = TvSession.sessionCipher(key, clientNonce, msg.n, true);
        ws.send(JSON.stringify({ t: 'auth', b: pendingCipher.seal({ proof: 'phone' }) }));
      } else if (msg.t === 'ok' && pendingCipher) {
        const proof = pendingCipher.open(msg.b);
        if (!proof || proof.proof !== 'tv') {
          fail(t('errFake'));
          return;
        }
        link.cipher = pendingCipher;
        startSession(proof.info);
      } else if (msg.t === 'd' && link.cipher) {
        const reply = link.cipher.open(msg.b);
        if (!reply) {
          fail(t('errFake'));
          return;
        }
        const callback = link.pending.get(reply.id);
        if (callback) {
          link.pending.delete(reply.id);
          callback(reply);
        }
      }
    };
  }, 30);
}

function endSession(text) {
  clearInterval(link.stateTimer);
  link.live = false;
  link.cipher = null;
  link.ws = null;
  link.pending.clear();
  $('live').checked = false;
  $('view').hidden = true;
  $('remote').hidden = true;
  $('login').hidden = false;
  $('connect').disabled = false;
  setMessage(text || '', Boolean(text));
}

function call(method, ...args) {
  return new Promise((resolve) => {
    if (!link.cipher) {
      resolve({ ok: false, e: 'closed' });
      return;
    }
    const id = link.nextId;
    link.nextId += 1;
    link.pending.set(id, resolve);
    link.ws.send(JSON.stringify({ t: 'd', b: link.cipher.seal({ id, m: method, a: args }) }));
  });
}

async function act(method, ...args) {
  const reply = await call(method, ...args);
  if (!reply.ok && link.cipher) toast(t('errFailed', { error: reply.e }));
  return reply;
}

// Fire-and-forget for pointer traffic, which must not queue up waiting for answers.
function notify(method, ...args) {
  if (link.cipher) link.ws.send(JSON.stringify({ t: 'd', b: link.cipher.seal({ m: method, a: args }) }));
}

$('login').addEventListener('submit', (event) => {
  event.preventDefault();
  connect(TvSession.normalizeId($('id').value), TvSession.normalizePassword($('password').value));
});
$('leave').addEventListener('click', () => {
  const { ws } = link;
  ws.onclose = null;
  ws.close();
  endSession('');
});

/* Remote */
for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
  const key = document.createElement('button');
  key.className = 'key';
  key.textContent = digit;
  key.dataset.button = digit;
  $('digits').append(key);
}

$('remote').addEventListener('click', (event) => {
  const key = event.target.closest('[data-button]');
  if (key) {
    if (navigator.vibrate) navigator.vibrate(10);
    act('button', key.dataset.button);
  }
});

function startSession(info) {
  link.info = info;
  const can = (name) => info.capabilities.includes(name);
  $('login').hidden = true;
  $('remote').hidden = false;
  setMessage('');
  $('tv-name').textContent = info.model || '';
  for (const key of document.querySelectorAll('[data-button]')) key.hidden = !info.buttons.includes(key.dataset.button);
  $('tab-mouse').hidden = !can('pointer');
  $('tab-apps').hidden = !can('apps');
  $('live-row').hidden = !can('capture');
  $('volume-row').hidden = !can('volumeSet');
  $('inputs-row').hidden = !can('inputs');
  $('text-form').hidden = !can('text');
  $('text-del').hidden = !can('textDelete');
  $('screen-off').hidden = !can('screenOff');
  $('mute').hidden = !can('mute') && !info.buttons.includes('MUTE');
  $('power').hidden = !can('powerOff');
  showTab('pad');
  loadLists(can);
  link.stateTimer = setInterval(refreshState, 5000);
  refreshState();
}

async function refreshState() {
  const reply = await call('getState');
  if (!reply.ok || !reply.v) return;
  if (typeof reply.v.muted === 'boolean') link.muted = reply.v.muted;
  if (typeof reply.v.volume === 'number' && document.activeElement !== $('volume')) $('volume').value = reply.v.volume;
}

function listItem(text, onClick) {
  const row = document.createElement('li');
  const button = document.createElement('button');
  button.textContent = text;
  button.addEventListener('click', onClick);
  row.append(button);
  return row;
}

async function loadLists(can) {
  if (can('apps')) {
    const apps = await call('listApps');
    $('app-list').replaceChildren(...(apps.v || []).map((app) => listItem(app.title, () => act('launchApp', app.id))));
  }
  if (can('inputs')) {
    const inputs = await call('listInputs');
    $('input-list').replaceChildren(...(inputs.v || []).map((input) => listItem(input.label, () => act('switchInput', input.id))));
  }
}

function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== name;
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

$('power').addEventListener('click', () => {
  if (confirm(t('confirmOff'))) act('powerOff');
});

$('mute').addEventListener('click', () => {
  if (link.info.capabilities.includes('mute')) {
    link.muted = !link.muted;
    act('setMute', link.muted);
  } else {
    act('button', 'MUTE');
  }
});

let volumeTimer;
$('volume').addEventListener('input', (event) => {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => act('setVolume', Number(event.target.value)), 150);
});

$('text-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('text').value) return;
  const reply = await act('insertText', $('text').value);
  if (reply.ok) $('text').value = '';
});
$('text-del').addEventListener('click', () => act('deleteCharacters', 1));
$('text-enter').addEventListener('click', () => act('sendEnter'));

let screenIsOff = false;
$('screen-off').addEventListener('click', async () => {
  const reply = await act(screenIsOff ? 'screenOn' : 'screenOff');
  if (reply.ok) screenIsOff = !screenIsOff;
});

/* Screen view: asks for the next picture when the last one arrives, so a slow connection just shows fewer. */
async function liveLoop() {
  while (link.live) {
    const reply = await call('capture');
    if (!link.live) return;
    if (reply.ok) {
      $('frame').src = `data:${reply.v.mime};base64,${reply.v.data}`;
      $('view').hidden = false;
    } else {
      toast(t('errFailed', { error: reply.e }));
      link.live = false;
      $('live').checked = false;
      $('view').hidden = true;
    }
  }
}
$('live').addEventListener('change', (event) => {
  link.live = event.target.checked;
  if (link.live) liveLoop();
  else $('view').hidden = true;
});

/* Touchpad */
const pad = { x: 0, y: 0, moved: 0, fingers: 0, started: 0, dx: 0, dy: 0, timer: null };
const touchpad = $('touchpad');

function flushPad() {
  pad.timer = null;
  if (pad.dx || pad.dy) notify('move', pad.dx, pad.dy);
  pad.dx = 0;
  pad.dy = 0;
}

touchpad.addEventListener('touchstart', (event) => {
  event.preventDefault();
  const touch = event.touches[0];
  pad.x = touch.clientX;
  pad.y = touch.clientY;
  pad.moved = 0;
  pad.fingers = Math.max(event.touches.length, event.changedTouches.length === event.touches.length ? 0 : pad.fingers);
  pad.started = Date.now();
}, { passive: false });

touchpad.addEventListener('touchmove', (event) => {
  event.preventDefault();
  const touch = event.touches[0];
  const dx = touch.clientX - pad.x;
  const dy = touch.clientY - pad.y;
  pad.x = touch.clientX;
  pad.y = touch.clientY;
  pad.moved += Math.abs(dx) + Math.abs(dy);
  if (event.touches.length > 1) {
    if (Math.abs(dy) > 3) notify('scroll', 0, dy > 0 ? 1 : -1);
    return;
  }
  pad.dx += Math.round(dx);
  pad.dy += Math.round(dy);
  if (!pad.timer) pad.timer = setTimeout(flushPad, 33);
}, { passive: false });

touchpad.addEventListener('touchend', (event) => {
  event.preventDefault();
  if (pad.moved < 8 && Date.now() - pad.started < 300 && event.touches.length === 0) notify('click');
}, { passive: false });

/* The address fields are grouped for reading, as the TV shows them. */
$('id').addEventListener('input', () => {
  const digits = TvSession.normalizeId($('id').value).slice(0, 9);
  $('id').value = digits.replace(/(\d{3})(?=\d)/g, '$1 ');
});

applyLanguage();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
