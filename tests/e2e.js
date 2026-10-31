// Drives the real Electron app against the fake TV and saves screenshots to tests/output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { startFakeTv } = require('./fake-tv');

const OUT = path.join(__dirname, 'output');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, label, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function launch(fake, userData) {
  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`],
    env: { ...process.env, LGTV_FAKE_ENDPOINTS: fake.endpoint },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv-e2e-'));
  const fake = await startFakeTv({ approveAfterMs: 400 });
  const { app, page } = await launch(fake, userData);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
  const pointerNames = () => fake.log.filter((e) => e.channel === 'pointer').map((e) => e.name || e.type);

  await page.screenshot({ path: path.join(OUT, '1-connect.png') });

  // Language switch: both directions, translated labels, translated errors, and the choice survives a reload.
  const setLang = async (lang) => {
    if ((await page.getAttribute('html', 'lang')) !== lang) await page.click('#lang');
    assert.equal(await page.getAttribute('html', 'lang'), lang);
  };
  await setLang('en');
  assert.equal(await page.getAttribute('html', 'dir'), 'ltr');
  assert.equal(await page.textContent('#connect-btn'), 'Connect');
  await page.click('#pin-mode');
  assert.equal(await page.textContent('#connect-msg'), 'Type the TV address first.');
  const hebrew = await page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('body *')) {
      for (const text of [el.childNodes.length === 1 ? el.textContent : '', el.placeholder, el.title, el.alt, el.getAttribute('aria-label')]) {
        if (text && /[֐-׿]/.test(text) && el.id !== 'lang') seen.push(text);
      }
    }
    return seen;
  });
  assert.deepEqual(hebrew, [], 'no Hebrew left in the English interface');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.getAttribute('html', 'lang'), 'en', 'language choice is remembered');
  await setLang('he');
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  assert.equal(await page.textContent('#connect-btn'), 'התחבר');
  console.log('ok language switch');

  await page.fill('#host', '127.0.0.1');
  await page.click('#connect-btn');
  await page.waitForSelector('#stand:not([hidden])');
  assert.equal(await page.textContent('#tv-name'), 'webOSTV 23, OLED55C3');
  console.log('ok pairing through the UI');

  await page.click('[data-button="HOME"]');
  await page.click('[data-button="UP"]');
  await page.click('[data-button="7"]');
  await waitFor(() => pointerNames().join() === 'HOME,UP,7', 'remote keys reach the TV');
  console.log('ok remote keys');

  await page.waitForSelector('#apps button');
  await page.click('#apps button:has-text("YouTube")');
  await waitFor(() => fake.state.appId === 'youtube.leanback.v4', 'app launch');
  const hostile = await page.locator('#apps button').filter({ hasText: '<img' }).count();
  assert.equal(hostile, 1, 'app titles render as text');
  assert.equal(await page.locator('#apps img').count(), 0);
  console.log('ok app launch, titles are text');

  await page.click('#inputs button:has-text("PlayStation")');
  await waitFor(() => fake.log.some((e) => e.uri === 'ssap://tv/switchInput' && e.payload.inputId === 'HDMI_2'), 'input switch');
  console.log('ok input switch');

  await page.fill('#text', 'שלום');
  await page.click('#text-form button[type=submit]');
  await waitFor(() => fake.log.some((e) => e.uri && e.uri.includes('insertText') && e.payload.text === 'שלום'), 'text');
  console.log('ok text');

  await waitFor(async () => (await page.inputValue('#volume')) === '20', 'volume state from TV');
  console.log('ok volume state');

  await page.click('#placeholder-live');
  await page.waitForSelector('#frame:not([hidden])');
  await waitFor(async () => /\d/.test(await page.textContent('#fps')), 'fps display');
  await page.screenshot({ path: path.join(OUT, '2-live.png') });
  console.log('ok live view:', await page.textContent('#fps'));

  await page.click('#lock');
  await waitFor(() => page.evaluate(() => document.pointerLockElement?.id === 'screen'), 'pointer lock');
  await page.waitForSelector('#cursor[data-ready]');
  const box = await page.locator('#screen').boundingBox();
  const startCursor = await page.$eval('#cursor', (el) => el.style.transform);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.move(box.x + 200 + i * 30, box.y + 200 + i * 20);
    await delay(40);
  }
  await waitFor(async () => (await page.$eval('#cursor', (el) => el.style.transform)) !== startCursor, 'on-screen cursor follows the mouse');
  assert.equal(await page.locator('#cursor:not([hidden])').count(), 1);
  await page.screenshot({ path: path.join(OUT, '2b-cursor.png') });
  console.log('ok on-screen cursor:', await page.$eval('#cursor', (el) => el.style.transform));
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('a');
  await waitFor(() => pointerNames().includes('LEFT'), 'keyboard in capture mode');
  await waitFor(() => pointerNames().includes('click'), 'click in capture mode');
  await waitFor(() => fake.log.some((e) => e.uri && e.uri.includes('insertText') && e.payload.text === 'a'), 'typing');
  console.log('ok capture mode; pointer moves seen:', fake.log.filter((e) => e.type === 'move').length);
  await page.evaluate(() => document.exitPointerLock());

  // Connection drop: app should reconnect by itself using the saved key, with no new prompt.
  const registersBefore = fake.log.filter((e) => e.type === 'register').length;
  fake.dropClients();
  await page.waitForSelector('#connect-form:not([hidden])');
  await page.waitForSelector('#stand:not([hidden])', { timeout: 15000 });
  const registers = fake.log.filter((e) => e.type === 'register').slice(registersBefore);
  assert.ok(registers.length >= 1 && registers.every((r) => r.hadKey), 'reconnect uses saved key');
  console.log('ok automatic reconnect');

  // Switching language while connected must not disturb the session.
  await page.click('#lang');
  assert.equal(await page.textContent('#disconnect'), 'Disconnect');
  assert.equal(await page.locator('#stand:not([hidden])').count(), 1);
  await page.click('#lang');
  console.log('ok language switch while connected');

  await page.click('#disconnect');
  await page.waitForSelector('#connect-form:not([hidden])');
  await page.waitForSelector('#tv-list button.pick');
  const stored = fs.readFileSync(path.join(userData, 'tvs.json'), 'utf8');
  assert.ok(!stored.includes('key-1'), 'client key is not stored in plain text');
  await page.screenshot({ path: path.join(OUT, '3-saved.png') });
  console.log('ok disconnect, saved TV listed, key encrypted');

  assert.deepEqual(errors, []);
  await app.close();
  await fake.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('E2E PASSED');
})().catch((err) => {
  console.error('E2E FAILED:', err);
  process.exit(1);
});
