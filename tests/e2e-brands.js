// Drives the real Electron app against each simulated brand, checking pairing and that the interface fits the TV.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { startFakeSamsung, startFakeRoku, startFakeVizio, startFakeSony, startFakeAndroidTv } = require('./fake-brands');

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

async function withApp(config, run) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-brands-'));
  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`],
    env: { ...process.env, TV_TEST_CONFIG: JSON.stringify(config) },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await run(page, userData);
  assert.deepEqual(errors, []);
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
}

const visible = (page, selector) => page.locator(selector).isVisible();

async function connect(page, brand) {
  await page.selectOption('#brand', brand);
  await page.fill('#host', '127.0.0.1');
  await page.click('#connect-btn');
}

async function sendCode(page, code) {
  await page.waitForSelector('#pin-row:not([hidden])');
  await page.fill('#pin', code);
  await page.click('#pin-send');
}

async function expectNoViewOrMouse(page) {
  assert.equal(await visible(page, '#live'), false);
  assert.equal(await visible(page, '#lock'), false);
  assert.equal(await visible(page, '#placeholder-live'), false);
  assert.equal(await visible(page, '#view-text'), true);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const samsung = await startFakeSamsung();
  await withApp({ samsung: samsung.config }, async (page) => {
    await connect(page, 'auto');
    await page.waitForSelector('#stand:not([hidden])');
    assert.match(await page.textContent('#tv-name'), /Samsung, QE55Q80/);
    await expectNoViewOrMouse(page);
    assert.equal(await visible(page, '#volume'), false);
    await page.click('[data-button="HOME"]');
    await page.click('#mute');
    await page.click('#apps button:has-text("Netflix")');
    await waitFor(() => samsung.log.some((e) => e.params && e.params.event === 'ed.apps.launch'), 'app launch');
    assert.ok(samsung.log.some((e) => e.params && e.params.DataOfCmd === 'KEY_HOME'));
    assert.ok(samsung.log.some((e) => e.params && e.params.DataOfCmd === 'KEY_MUTE'));
    await page.screenshot({ path: path.join(OUT, 'brand-samsung.png') });
    console.log('ok samsung, detected automatically');

    // A restart keeps the brand and the token, with no new approval.
    samsung.dropClients();
    await page.waitForSelector('#stand:not([hidden])', { timeout: 15000 });
    assert.equal(samsung.log.filter((e) => e.type === 'connect').at(-1).token, 'samsung-token');
    console.log('ok samsung reconnects with its token');
    await page.click('#disconnect');
    await page.click('#tv-list button.pick');
    await page.waitForSelector('#stand:not([hidden])');
    assert.equal(await page.inputValue('#brand'), 'samsung');
    console.log('ok saved TV remembers its brand');
  });
  await samsung.close();

  const android = await startFakeAndroidTv();
  await withApp({ androidtv: android.config }, async (page, userData) => {
    await connect(page, 'androidtv');
    assert.equal(await visible(page, '#pin-mode'), false);
    await page.waitForSelector('#pin-row:not([hidden])', { timeout: 15000 });
    await sendCode(page, '000000');
    await waitFor(async () => /(not correct|לא נכון)/.test(await page.textContent('#connect-msg')), 'wrong code message');
    await sendCode(page, android.code);
    await page.waitForSelector('#stand:not([hidden])');
    assert.equal(await visible(page, '#apps-hint'), true);
    assert.equal(await visible(page, '[data-button="EXIT"]'), false);
    await page.click('[data-button="UP"]');
    await page.click('#inputs button:has-text("HDMI 2")');
    await page.click('#apps button:has-text("YouTube")');
    await waitFor(() => android.log.some((e) => e.type === 'launch'), 'app link');
    assert.ok(android.log.some((e) => e.type === 'key' && e.code === 19));
    assert.ok(android.log.some((e) => e.type === 'key' && e.code === 244));
    const stored = fs.readFileSync(path.join(userData, 'tvs.json'), 'utf8');
    assert.ok(!stored.includes('PRIVATE KEY'), 'the private key is not stored in plain text');
    await page.screenshot({ path: path.join(OUT, 'brand-android.png') });
    console.log('ok android tv: code pairing with a retry, keys, inputs, apps');
  });
  await android.close();

  const roku = await startFakeRoku();
  await withApp({ roku: roku.config }, async (page) => {
    await connect(page, 'auto');
    await page.waitForSelector('#stand:not([hidden])');
    assert.equal(await visible(page, '[data-button="1"]'), false);
    await page.fill('#text', 'hi');
    await page.click('#text-form button[type=submit]');
    await waitFor(() => roku.log.includes('POST /keypress/Lit_i'), 'text');
    await page.waitForSelector('#apps button[aria-current="true"]');
    assert.equal(await page.locator('#apps img').count(), 0);
    console.log('ok roku: no pairing, text, running app marked');
  });
  await roku.close();

  const vizio = await startFakeVizio();
  await withApp({ vizio: vizio.config }, async (page) => {
    await connect(page, 'vizio');
    await sendCode(page, '1234');
    await page.waitForSelector('#stand:not([hidden])');
    assert.equal(await visible(page, '#panel-apps'), false);
    assert.equal(await visible(page, '#volume'), true);
    await page.click('#inputs button:has-text("Console")');
    await waitFor(() => vizio.log.some((e) => e.body && e.body.VALUE === 'HDMI-1'), 'input');
    console.log('ok vizio: code pairing, no app panel, inputs');
  });
  await vizio.close();

  const sony = await startFakeSony();
  await withApp({ sony: sony.config }, async (page) => {
    await connect(page, 'sony');
    await sendCode(page, 'secret');
    await page.waitForSelector('#stand:not([hidden])');
    assert.equal(await visible(page, '#screen-toggle'), true);
    await page.click('[data-button="HOME"]');
    await waitFor(() => sony.log.some((e) => e.ircc === 'AAAAHOME'), 'IRCC key');
    console.log('ok sony: key pairing, IRCC');
  });
  await sony.close();

  await withApp({ webos: { endpoints: ['ws://127.0.0.1:9'] }, samsung: { restBase: 'http://127.0.0.1:9' }, roku: { base: 'http://127.0.0.1:9' }, vizio: { bases: ['https://127.0.0.1:9'] }, androidtv: { connectHost: '127.0.0.1', remotePort: 9, pairingPort: 9 }, sony: { base: 'http://127.0.0.1:9' } }, async (page) => {
    await page.evaluate(() => { if (document.documentElement.lang !== 'en') document.getElementById('lang').click(); });
    await connect(page, 'auto');
    await waitFor(async () => /No supported TV/.test(await page.textContent('#connect-msg')), 'detection failure message');
    console.log('ok detection failure is explained');
  });

  console.log('BRAND E2E PASSED');
})().catch((err) => {
  console.error('BRAND E2E FAILED:', err);
  process.exit(1);
});
