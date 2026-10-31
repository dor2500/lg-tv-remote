// Checks that the packaged build (run `npm run dist` first) starts and can pair with the fake TV.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { startFakeTv } = require('./fake-tv');

(async () => {
  const fake = await startFakeTv();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv-pkg-'));
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'dist', 'win-unpacked', 'LG TV Remote.exe'),
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, LGTV_FAKE_ENDPOINTS: fake.endpoint },
  });
  const page = await app.firstWindow();
  await page.fill('#host', '127.0.0.1');
  await page.click('#connect-btn');
  await page.waitForSelector('#stand:not([hidden])', { timeout: 10000 });
  await page.click('[data-button="HOME"]');
  await new Promise((r) => setTimeout(r, 400));
  if (!fake.log.some((e) => e.name === 'HOME')) throw new Error('HOME key did not reach the fake TV');
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'output', '4-packaged.png') });
  await app.close();
  await fake.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('PACKAGED SMOKE PASSED');
})().catch((err) => {
  console.error('PACKAGED SMOKE FAILED:', err);
  process.exit(1);
});
