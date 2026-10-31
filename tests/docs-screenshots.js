// Regenerates docs/images from the fake TV, so the docs never contain real broadcasts or personal data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { startFakeTv } = require('./fake-tv');

const OUT = path.join(__dirname, '..', 'docs', 'images');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fake = await startFakeTv({ cleanApps: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv-docs-'));
  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`],
    env: { ...process.env, LGTV_FAKE_ENDPOINTS: fake.endpoint },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: path.join(OUT, 'connect.png') });
  await page.fill('#host', '127.0.0.1');
  await page.click('#connect-btn');
  await page.waitForSelector('#stand:not([hidden])');
  await page.waitForSelector('#apps button');
  await page.screenshot({ path: path.join(OUT, 'control.png') });
  await page.click('#placeholder-live');
  await page.waitForSelector('#frame:not([hidden])');
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, 'live.png') });
  await app.close();
  await fake.close();
  fs.rmSync(userData, { recursive: true, force: true });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
