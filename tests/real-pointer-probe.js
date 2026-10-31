// Moves the TV pointer without clicking and saves frames, to see where it lands and if captures include it.
// Usage: node tests/real-pointer-probe.js <tv-address> <user-data-dir>
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const [host, userData] = process.argv.slice(2);
const OUT = path.join(__dirname, 'output');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env };
  delete env.LGTV_FAKE_ENDPOINTS;
  const app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.fill('#host', host);
  await page.click('#connect-btn');
  await page.waitForSelector('#stand:not([hidden])', { timeout: 30000 });
  await page.selectOption('#rate', '250');
  await page.click('#placeholder-live');
  await page.waitForSelector('#frame:not([hidden])');

  // Compares the app's cursor with the item the TV highlights. Saved images may show TV content: keep them local.
  await page.click('#lock');
  await page.waitForSelector('#cursor[data-ready]', { timeout: 5000 });
  const box = await page.locator('#screen').boundingBox();
  const paths = [['slow', 2, 100], ['medium', 10, 20]];
  let x = box.x + 10;
  let y = box.y + 10;
  for (const [name, step, count] of paths) {
    await page.evaluate(() => document.exitPointerLock());
    await delay(1500); // Chromium refuses to re-lock right after a release
    await page.click('#lock');
    await page.waitForSelector('#cursor[data-ready]', { timeout: 5000 });
    for (let i = 0; i < count; i += 1) {
      x += step;
      y += step;
      await page.mouse.move(x, y);
      await delay(16);
    }
    await delay(700);
    await page.screenshot({ path: path.join(OUT, `cursor-${name}.png`) });
    console.log(name, await page.$eval('#cursor', (el) => el.style.transform));
  }
  await app.close();
  console.log('Done');
})().catch((err) => {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
});
