// Opens the app against the fake TV, to try the interface without a real TV.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
const { startFakeTv } = require('./fake-tv');

(async () => {
  const fake = await startFakeTv({ approveAfterMs: 1500 });
  console.log('Fake TV is running. Enter any address in the app, e.g. 127.0.0.1');
  const child = spawn(electron, [path.join(__dirname, '..')], {
    stdio: 'inherit',
    env: { ...process.env, LGTV_FAKE_ENDPOINTS: fake.endpoint },
  });
  child.on('exit', () => process.exit(0));
})();
