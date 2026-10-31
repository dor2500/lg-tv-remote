// Read-only check against a real TV: pairs, reads info and lists, measures screen capture. Sends no keys.
// Usage: node tests/real-tv-check.js <tv-address> [user-data-dir]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const host = process.argv[2];
if (!host) {
  console.error('Usage: node tests/real-tv-check.js <tv-address> [user-data-dir]');
  process.exit(2);
}
const userData = process.argv[3] || path.join(os.tmpdir(), 'lgtv-real-check');
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
  console.log('Connecting. Approve the request on the TV if one appears.');

  const end = Date.now() + 100000;
  while (Date.now() < end) {
    if (await page.locator('#stand:not([hidden])').count()) break;
    const message = await page.textContent('#connect-msg');
    if (await page.locator('#connect-msg.error').count()) throw new Error(`Connection failed: ${message}`);
    await delay(300);
  }
  if (!(await page.locator('#stand:not([hidden])').count())) throw new Error('Timed out waiting for pairing');

  console.log('TV:', await page.textContent('#tv-name'));
  await delay(1500);
  console.log('Apps:', await page.locator('#apps button').count());
  console.log('Inputs:', await page.locator('#inputs button').count());
  console.log('Volume:', await page.inputValue('#volume'));
  await page.screenshot({ path: path.join(OUT, 'real-control.png') });

  await page.selectOption('#rate', '250');
  await page.click('#placeholder-live');
  await delay(12000);
  const shown = await page.locator('#frame:not([hidden])').count();
  console.log('Frame shown:', Boolean(shown), '| rate:', await page.textContent('#fps'));
  console.log('Message:', (await page.locator('#toast:not([hidden])').count()) ? await page.textContent('#toast') : 'none');
  if (shown) {
    const size = await page.$eval('#frame', (img) => `${img.naturalWidth}x${img.naturalHeight}`);
    console.log('Image size:', size);
    await page.screenshot({ path: path.join(OUT, 'real-live.png') });
    const dataUrl = await page.$eval('#frame', (img) => img.src);
    fs.writeFileSync(path.join(OUT, 'real-frame.jpg'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  console.log('Pointer captured without asking:', await page.evaluate(() => Boolean(document.pointerLockElement)));

  // Optional control proof: LGTV_CHECK_KEY names one key to press. It acts on whatever is on screen.
  const checkKey = process.env.LGTV_CHECK_KEY;
  if (checkKey) {
    const save = async (name) => {
      const src = await page.$eval('#frame', (img) => img.src);
      fs.writeFileSync(path.join(OUT, name), Buffer.from(src.split(',')[1], 'base64'));
      return src;
    };
    await save('real-before-key.jpg');
    const result = await page.evaluate((key) => window.lgtv.action('button', key), checkKey);
    console.log(`${checkKey} result:`, JSON.stringify(result));
    await delay(4000);
    await save('real-after-key.jpg');
    await page.screenshot({ path: path.join(OUT, 'real-after-key-app.png') });
  }
  await app.close();
  console.log('Done');
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
