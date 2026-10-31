const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { WebOSClient, wakeOnLan } = require('../src/main/drivers/webos');
const { startFakeTv } = require('./fake-tv');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(options, clientOptions = {}) {
  const fake = await startFakeTv(options);
  const client = new WebOSClient({ host: '127.0.0.1', endpoints: [fake.endpoint], ...clientOptions });
  const done = async () => {
    client.close();
    await fake.close();
  };
  return { fake, client, done };
}

test('pairs by on-screen prompt and reconnects with the saved key without prompting', async () => {
  const { fake, client, done } = await setup();
  const seen = [];
  client.on('pairing', (type) => seen.push(type));
  const key = await client.connect();
  assert.equal(key, 'key-1');
  assert.deepEqual(seen, ['PROMPT']);
  client.close();

  const again = new WebOSClient({ host: '127.0.0.1', endpoints: [fake.endpoint], clientKey: key });
  const prompts = [];
  again.on('pairing', (t) => prompts.push(t));
  await again.connect();
  assert.deepEqual(prompts, []);
  again.close();
  await done();
});

test('pairs by PIN', async () => {
  const { client, done } = await setup();
  client.on('pairing', (type) => {
    if (type === 'PIN') client.submitPin('1234');
  });
  assert.equal(await client.connect({ pairingType: 'PIN' }), 'key-1');
  await done();
});

test('a revoked key falls back to fresh pairing', async () => {
  const { fake, client, done } = await setup({}, { clientKey: 'revoked' });
  assert.equal(await client.connect(), 'key-1');
  assert.deepEqual(fake.log.filter((e) => e.type === 'register').map((e) => e.hadKey), [true, false]);
  await done();
});

test('a blacklisted signature falls back to unsigned pairing and keeps working', async () => {
  const { fake, client, done } = await setup({ blacklistSigned: true });
  const key = await client.connect();
  assert.deepEqual(fake.log.filter((e) => e.type === 'register').map((e) => e.signed), [true, false]);
  await client.button('HOME');
  await delay(50);
  assert.ok(fake.log.some((e) => e.name === 'HOME'));
  client.close();

  const again = new WebOSClient({ host: '127.0.0.1', endpoints: [fake.endpoint], clientKey: key });
  const prompts = [];
  again.on('pairing', (t) => prompts.push(t));
  assert.equal(await again.connect(), key);
  assert.deepEqual(prompts, []);
  again.close();
  await done();
});

test('a refused pairing reports refusal', async () => {
  const { client, done } = await setup({ rejectPairing: true });
  await assert.rejects(client.connect(), (err) => err.code === 'PAIRING_REJECTED');
  await done();
});

test('an unreachable TV gives a clear error', async () => {
  const client = new WebOSClient({ host: '127.0.0.1', endpoints: ['wss://127.0.0.1:1'] });
  await assert.rejects(client.connect(), (err) => err.code === 'UNREACHABLE');
});

test('falls through to the second endpoint', async () => {
  const fake = await startFakeTv();
  const client = new WebOSClient({ host: '127.0.0.1', endpoints: ['wss://127.0.0.1:1', fake.endpoint] });
  await client.connect();
  assert.equal(client.endpoint, fake.endpoint);
  client.close();
  await fake.close();
});

test('pointer socket sends buttons, movement, clicks and scrolling via the connected host', async () => {
  const { fake, client, done } = await setup();
  await client.connect();
  await client.button('home');
  await client.move(5.4, -3);
  await client.click();
  await client.scroll(0, -1);
  await delay(50);
  const pointer = fake.log.filter((e) => e.channel === 'pointer');
  assert.deepEqual(pointer.map((e) => e.type), ['button', 'move', 'click', 'scroll']);
  assert.equal(pointer[0].name, 'HOME');
  assert.equal(pointer[1].dx, '5');
  assert.equal(pointer[1].dy, '-3');
  await done();
});

test('concurrent input opens one pointer socket and keeps order', async () => {
  const { fake, client, done } = await setup();
  await client.connect();
  await Promise.all(['UP', 'DOWN', 'LEFT', 'RIGHT'].map((b) => client.button(b)));
  await delay(50);
  const asked = fake.log.filter((e) => e.uri && e.uri.includes('getPointerInputSocket'));
  assert.equal(asked.length, 1);
  assert.deepEqual(fake.log.filter((e) => e.channel === 'pointer').map((e) => e.name), ['UP', 'DOWN', 'LEFT', 'RIGHT']);
  await done();
});

test('rejects unknown buttons without sending', async () => {
  const { client, done } = await setup();
  await client.connect();
  await assert.rejects(client.button('type:move\n'), (err) => err.code === 'BAD_INPUT');
  await done();
});

test('capture downloads the image from the connected host, not the reported LAN address', async () => {
  const { client, done } = await setup();
  await client.connect();
  const { mime, data } = await client.capture();
  assert.equal(mime, 'image/svg+xml');
  assert.match(data.toString(), /Fake TV/);
  await done();
});

test('a TV that forbids capture reports NO_PERMISSION', async () => {
  const { client, done } = await setup({ denyCapture: true });
  await client.connect();
  await assert.rejects(client.capture(), (err) => err.code === 'NO_PERMISSION');
  await done();
});

test('apps, inputs, volume, text and failures', async () => {
  const { fake, client, done } = await setup();
  await client.connect();
  assert.equal((await client.listApps())[0].title, 'Netflix');
  assert.equal((await client.listInputs())[1].label, 'PlayStation');
  await client.launchApp('youtube.leanback.v4');
  assert.equal(fake.state.appId, 'youtube.leanback.v4');
  await client.setVolume(150);
  assert.equal(fake.state.volume, 100);
  await client.insertText('שלום');
  assert.equal(fake.log.find((e) => e.uri && e.uri.includes('insertText')).payload.text, 'שלום');
  await assert.rejects(client.switchInput('BROKEN'), /no such input/);
  await done();
});

test('getInfo reports model and firmware', async () => {
  const { client, done } = await setup();
  await client.connect();
  const info = await client.getInfo();
  assert.equal(info.model, 'OLED55C3');
  assert.equal(info.product, 'webOSTV 23');
  assert.equal(info.mac, 'aa:bb:cc:dd:ee:ff');
  await done();
});

test('a request the TV never answers times out', async () => {
  const { client, done } = await setup({}, { requestTimeoutMs: 100 });
  await client.connect();
  await assert.rejects(client.request('ssap://silent/never'), (err) => err.code === 'TIMEOUT');
  await done();
});

test('a dropped connection rejects pending requests and emits closed', async () => {
  const { fake, client, done } = await setup();
  await client.connect();
  const closed = new Promise((r) => client.once('closed', r));
  const pending = client.request('ssap://silent/never');
  fake.dropClients();
  await assert.rejects(pending, (err) => err.code === 'NOT_CONNECTED');
  assert.deepEqual(await closed, { byUser: false });
  await done();
});

test('wake-on-LAN sends a valid magic packet', async () => {
  const server = dgram.createSocket('udp4');
  await new Promise((r) => server.bind(0, '127.0.0.1', r));
  const received = new Promise((r) => server.once('message', r));
  await wakeOnLan('AA:BB:CC:DD:EE:FF', { broadcast: '127.0.0.1', port: server.address().port });
  const packet = await received;
  server.close();
  assert.equal(packet.length, 102);
  assert.equal(packet.subarray(0, 6).toString('hex'), 'ffffffffffff');
  assert.equal(packet.subarray(96).toString('hex'), 'aabbccddeeff');
  await assert.rejects(wakeOnLan('nope'), (err) => err.code === 'BAD_INPUT');
});
