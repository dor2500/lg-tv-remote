// Regenerates docs/images in both languages from the fake TV, so these pictures never contain real broadcasts or personal data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { startFakeTv } = require('./fake-tv');

const OUT = path.join(__dirname, '..', 'docs', 'images');

async function capture(lang, suffix) {
  const fake = await startFakeTv({ cleanApps: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtv-docs-'));
  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`],
    env: { ...process.env, TV_TEST_CONFIG: JSON.stringify({ webos: { endpoints: [fake.endpoint] } }) },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if ((await page.getAttribute('html', 'lang')) !== lang) await page.click('#lang');
  await page.screenshot({ path: path.join(OUT, `connect${suffix}.png`) });
  await page.fill('#host', '127.0.0.1');
  await page.click('#connect-btn');
  await page.waitForSelector('#stand:not([hidden])');
  await page.waitForSelector('#apps button');
  await page.screenshot({ path: path.join(OUT, `control${suffix}.png`) });
  await page.click('#placeholder-live');
  await page.waitForSelector('#frame:not([hidden])');
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, `live${suffix}.png`) });
  await app.close();
  await fake.close();
  fs.rmSync(userData, { recursive: true, force: true });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await capture('he', '');
  await capture('en', '-en');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
