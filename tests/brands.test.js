const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDriver, capabilitiesOf, buttonsOf, detectBrand } = require('../src/main/drivers');
const { parseSsdp, parseMdns, mdnsQuery } = require('../src/main/drivers/discovery');
const { startFakeSamsung, startFakeRoku, startFakeVizio, startFakeSony, startFakeAndroidTv } = require('./fake-brands');
const { startFakeTv } = require('./fake-tv');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (emitter, event) => new Promise((r) => emitter.once(event, r));

async function waitFor(check, label) {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

test('samsung: pairs, keeps its token, sends keys, text and apps', async () => {
  const fake = await startFakeSamsung();
  const config = { samsung: fake.config };
  const tv = createDriver('samsung', { host: '127.0.0.1', config });
  const pairing = [];
  const keys = [];
  tv.on('pairing', (type) => pairing.push(type));
  tv.on('key', (key) => keys.push(key));
  await tv.connect();
  assert.deepEqual(pairing, ['PROMPT']);
  assert.deepEqual(keys, ['samsung-token']);
  assert.equal(Buffer.from(fake.log[0].name, 'base64').toString(), 'Universal TV Remote');

  await tv.button('BACK');
  assert.deepEqual(await tv.listApps(), [{ id: '11101200001', title: 'Netflix' }, { id: 'org.tizen.browser', title: 'Internet' }]);
  await tv.launchApp('11101200001');
  await tv.launchApp('org.tizen.browser');
  await tv.insertText('שלום');
  await tv.switchInput('KEY_HDMI2');
  await tv.powerOff();
  await waitFor(() => fake.log.filter((e) => e.params && e.params.DataOfCmd === 'KEY_POWER').length === 1, 'all commands');
  assert.ok(fake.log.some((e) => e.params && e.params.DataOfCmd === 'KEY_RETURN'));
  const launches = fake.log.filter((e) => e.params && e.params.event === 'ed.apps.launch').map((e) => e.params.data.action_type);
  assert.deepEqual(launches, ['DEEP_LINK', 'NATIVE_LAUNCH']);
  const text = fake.log.find((e) => e.params && e.params.TypeOfRemote === 'SendInputString');
  assert.equal(Buffer.from(text.params.Cmd, 'base64').toString(), 'שלום');
  assert.deepEqual(await tv.getInfo(), { model: 'QE55Q80', product: 'Samsung', mac: null, wifiMac: 'aa:bb:cc:00:00:01' });
  await assert.rejects(tv.switchInput('KEY_POWER'), { code: 'BAD_INPUT' });
  await assert.rejects(tv.button('type:evil'), { code: 'BAD_INPUT' });
  await assert.rejects(tv.capture(), { code: 'UNSUPPORTED' });

  const closed = once(tv, 'closed');
  fake.dropClients();
  assert.deepEqual(await closed, { byUser: false });

  const again = createDriver('samsung', { host: '127.0.0.1', credentials: 'samsung-token', config });
  const seen = [];
  again.on('pairing', (type) => seen.push(type));
  await again.connect();
  assert.deepEqual(seen, []);
  assert.equal(fake.log.at(-1).token, 'samsung-token');
  const closedByUser = once(again, 'closed');
  again.close();
  assert.deepEqual(await closedByUser, { byUser: true });
  await fake.close();
});

test('samsung: a declined request is reported', async () => {
  const fake = await startFakeSamsung({ approve: false });
  const tv = createDriver('samsung', { host: '127.0.0.1', config: { samsung: fake.config } });
  await assert.rejects(tv.connect(), { code: 'PAIRING_REJECTED' });
  await fake.close();
});

test('roku: keys, literal text, apps with escaped names, and active app', async () => {
  const fake = await startFakeRoku();
  const tv = createDriver('roku', { host: '127.0.0.1', config: { roku: fake.config } });
  await tv.connect();
  assert.deepEqual(await tv.getInfo(), { model: '55R635', product: 'TCL', mac: null, wifiMac: 'aa:bb:cc:00:00:02' });
  assert.ok(buttonsOf(tv).includes('VOLUMEUP'));
  await tv.button('ENTER');
  await tv.insertText('a €');
  await tv.deleteCharacters(2);
  await tv.switchInput('InputHDMI2');
  await tv.powerOff();
  assert.deepEqual(fake.log.filter((l) => l.includes('/keypress/')), [
    'POST /keypress/Select', 'POST /keypress/Lit_a', 'POST /keypress/Lit_%20', 'POST /keypress/Lit_%E2%82%AC',
    'POST /keypress/Backspace', 'POST /keypress/Backspace', 'POST /keypress/InputHDMI2', 'POST /keypress/PowerOff',
  ]);
  assert.deepEqual(await tv.listApps(), [{ id: '12', title: 'Netflix' }, { id: '837', title: 'Tom & Jerry <b>' }]);
  await tv.launchApp('12');
  assert.ok(fake.log.includes('POST /launch/12'));
  const states = [];
  tv.watchState((s) => states.push(s));
  await waitFor(() => states.length > 0, 'active app');
  assert.deepEqual(states[0], { appId: '12' });
  tv.close();
  await fake.close();
});

test('roku: a player has no TV keys or inputs, and disabled control is explained', async () => {
  const player = await startFakeRoku({ isTv: false });
  const tv = createDriver('roku', { host: '127.0.0.1', config: { roku: player.config } });
  await tv.connect();
  assert.ok(!buttonsOf(tv).includes('VOLUMEUP'));
  assert.ok(!capabilitiesOf(tv).includes('inputs'));
  await assert.rejects(tv.button('VOLUMEUP').then(() => { throw Object.assign(new Error('x'), { code: 'SENT' }); }), { code: 'SENT' });
  await player.close();

  const locked = await startFakeRoku({ locked: true });
  const lockedTv = createDriver('roku', { host: '127.0.0.1', config: { roku: locked.config } });
  await lockedTv.connect();
  await assert.rejects(lockedTv.button('HOME'), { code: 'CONTROL_DISABLED' });
  await locked.close();
});

test('roku: losing the TV closes the driver', async () => {
  const fake = await startFakeRoku();
  const tv = createDriver('roku', { host: '127.0.0.1', config: { roku: fake.config } });
  await tv.connect();
  tv.watchState(() => {});
  const closed = once(tv, 'closed');
  await fake.close();
  assert.deepEqual(await closed, { byUser: false });
});

test('vizio: pairs by code with a retry, then controls keys, inputs and volume', async () => {
  const fake = await startFakeVizio();
  const config = { vizio: fake.config };
  const tv = createDriver('vizio', { host: '127.0.0.1', config });
  const keys = [];
  tv.on('key', (key) => keys.push(key));
  const asked = once(tv, 'pairing');
  const connected = tv.connect();
  assert.equal(await asked, 'PIN');
  await assert.rejects(tv.submitPin('9999'), { code: 'BAD_PIN' });
  await tv.submitPin('1234');
  await connected;
  assert.deepEqual(keys, ['vizio-token']);

  await tv.button('UP');
  assert.deepEqual(fake.log.at(-1).body, { KEYLIST: [{ CODESET: 3, CODE: 8, ACTION: 'KEYPRESS' }] });
  assert.equal(fake.log.at(-1).auth, 'vizio-token');
  assert.deepEqual(await tv.listInputs(), [{ id: 'HDMI-1', label: 'Console' }, { id: 'CAST', label: 'SmartCast' }]);
  await tv.switchInput('HDMI-1');
  assert.deepEqual(fake.log.at(-1).body, { REQUEST: 'MODIFY', VALUE: 'HDMI-1', HASHVAL: 555 });
  await tv.setVolume(33);
  assert.deepEqual(fake.log.at(-1).body, { REQUEST: 'MODIFY', VALUE: 33, HASHVAL: 555 });
  assert.equal((await tv.getInfo()).model, 'M55Q7');

  const again = createDriver('vizio', { host: '127.0.0.1', credentials: 'vizio-token', config });
  const seen = [];
  again.on('pairing', (type) => seen.push(type));
  await again.connect();
  assert.deepEqual(seen, []);

  const stale = createDriver('vizio', { host: '127.0.0.1', credentials: 'old', config });
  const staleAsked = once(stale, 'pairing');
  const staleConnected = stale.connect();
  assert.equal(await staleAsked, 'PIN');
  await stale.submitPin('1234');
  await staleConnected;
  await fake.close();
});

test('sony: asks for the key, rejects a wrong one, then uses IRCC and the REST API', async () => {
  const fake = await startFakeSony();
  const tv = createDriver('sony', { host: '127.0.0.1', config: { sony: fake.config } });
  const asked = once(tv, 'pairing');
  const connected = tv.connect();
  assert.equal(await asked, 'PSK');
  await assert.rejects(tv.submitPin('wrong'), { code: 'BAD_PIN' });
  await tv.submitPin('secret');
  assert.equal(await connected, 'secret');

  await tv.button('HOME');
  assert.deepEqual(fake.log.at(-1), { ircc: 'AAAAHOME', action: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"', psk: 'secret' });
  await assert.rejects(tv.button('STOP'), { code: 'UNSUPPORTED' });
  assert.deepEqual(await tv.listApps(), [{ id: 'com.sony.dtv.youtube', title: 'YouTube' }]);
  assert.deepEqual(await tv.listInputs(), [{ id: 'extInput:hdmi?port=1', label: 'Xbox' }]);
  await tv.setVolume(40);
  assert.deepEqual(fake.log.at(-1).params, [{ target: 'speaker', volume: '40' }]);
  await tv.powerOff();
  assert.deepEqual(fake.log.at(-1).params, [{ status: false }]);
  assert.equal((await tv.getInfo()).mac, 'aa:bb:cc:00:00:03');
  const states = [];
  tv.watchState((s) => states.push(s));
  await waitFor(() => states.length > 0, 'volume state');
  assert.deepEqual(states[0], { volume: 15, muted: false });
  tv.close();
  await fake.close();
});

test('android tv: pairs with a code, reconnects without one, and sends commands', async () => {
  const fake = await startFakeAndroidTv();
  const config = { androidtv: fake.config };
  const tv = createDriver('androidtv', { host: '127.0.0.1', config });
  const keys = [];
  tv.on('key', (key) => keys.push(key));
  const asked = once(tv, 'pairing');
  const connected = tv.connect();
  assert.equal(await asked, 'CODE');
  assert.deepEqual(fake.log[0], { type: 'pair-request', service: 'atvremote', client: 'Universal TV Remote' });

  await assert.rejects(tv.submitPin('xyz'), { code: 'BAD_PIN' });
  const wrongFirstByte = `${fake.code.startsWith('00') ? '11' : '00'}${fake.code.slice(2)}`;
  await assert.rejects(tv.submitPin(wrongFirstByte), { code: 'BAD_PIN' });
  await tv.submitPin(fake.code.toUpperCase());
  await connected;
  assert.equal(keys.length, 1);

  const states = [];
  tv.watchState((s) => states.push(s));
  await tv.button('HOME');
  await tv.switchInput('244');
  await tv.launchApp('vnd.youtube://');
  await tv.deleteCharacters(1);
  await waitFor(() => fake.log.some((e) => e.type === 'key' && e.code === 67), 'commands');
  await waitFor(() => fake.log.some((e) => e.type === 'pong'), 'ping answer');
  assert.deepEqual(fake.log.filter((e) => e.type === 'key').map((e) => [e.code, e.direction]), [[3, 3], [244, 3], [67, 3]]);
  assert.equal(fake.log.find((e) => e.type === 'launch').link, 'vnd.youtube://');
  assert.equal(fake.log.find((e) => e.type === 'pong').value, 9);
  assert.equal(fake.log.find((e) => e.type === 'configure').features, 622 & (1 | 2 | 4 | 32 | 64 | 512));
  await tv.insertText('hello');
  await waitFor(() => fake.log.some((e) => e.type === 'text'), 'text');
  assert.deepEqual(fake.log.find((e) => e.type === 'text'), { type: 'text', ime: 5, field: 6, value: 'hello', end: 4 });
  assert.deepEqual(await tv.getInfo(), { model: 'Bravia XR', product: 'Sony', mac: null, wifiMac: null });
  await assert.rejects(tv.launchApp('intent://evil'), { code: 'BAD_INPUT' });

  const closed = once(tv, 'closed');
  fake.dropClients();
  assert.deepEqual(await closed, { byUser: false });

  const again = createDriver('androidtv', { host: '127.0.0.1', credentials: keys[0], config });
  const seen = [];
  again.on('pairing', (type) => seen.push(type));
  await again.connect();
  assert.deepEqual(seen, []);
  const closedByUser = once(again, 'closed');
  again.close();
  assert.deepEqual(await closedByUser, { byUser: true });

  // A TV that was reset refuses the old certificate: pair again with the same one.
  fake.forgetClients();
  const stale = createDriver('androidtv', { host: '127.0.0.1', credentials: keys[0], config });
  const staleAsked = once(stale, 'pairing');
  const staleConnected = stale.connect();
  assert.equal(await staleAsked, 'CODE');
  await stale.submitPin(fake.code);
  await staleConnected;
  stale.close();
  await fake.close();
});

test('detectBrand tells each simulated platform apart', async () => {
  const offline = { webos: { endpoints: ['ws://127.0.0.1:9'] }, samsung: { restBase: 'http://127.0.0.1:9' }, roku: { base: 'http://127.0.0.1:9' }, vizio: { bases: ['https://127.0.0.1:9'] }, androidtv: { connectHost: '127.0.0.1', remotePort: 9, pairingPort: 9 }, sony: { base: 'http://127.0.0.1:9' } };
  const cases = [
    ['roku', await startFakeRoku()],
    ['samsung', await startFakeSamsung()],
    ['vizio', await startFakeVizio()],
    ['androidtv', await startFakeAndroidTv()],
    ['sony', await startFakeSony()],
  ];
  for (const [brand, fake] of cases) {
    assert.equal(await detectBrand('127.0.0.1', { ...offline, [brand]: fake.config }), brand);
    await fake.close();
  }
  const lg = await startFakeTv();
  assert.equal(await detectBrand('127.0.0.1', { ...offline, webos: { endpoints: [lg.endpoint] } }), 'webos');
  await lg.close();
  await assert.rejects(detectBrand('127.0.0.1', offline), { code: 'NOT_DETECTED' });
});

test('createDriver refuses an unknown platform', () => {
  assert.throws(() => createDriver('__proto__', { host: 'x' }), { code: 'BAD_INPUT' });
});

test('discovery reads SSDP and mDNS answers', () => {
  assert.deepEqual(parseSsdp('HTTP/1.1 200 OK\r\nST: roku:ecp\r\nUSN: x\r\n\r\n'), { brand: 'roku', name: 'Roku' });
  assert.deepEqual(
    parseSsdp('HTTP/1.1 200 OK\r\nST: urn:lge-com:service:webos-second-screen:1\r\nDLNADeviceName.lge.com: My%20TV\r\n\r\n'),
    { brand: 'webos', name: 'My TV' },
  );
  assert.equal(parseSsdp('HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n\r\n'), null);

  const labels = (name) => Buffer.concat([...name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
  const service = labels('_androidtvremote2._tcp.local');
  const instance = Buffer.concat([Buffer.from([8]), Buffer.from('Salon TV'), Buffer.from([0xc0, 12])]);
  const size = Buffer.alloc(2);
  size.writeUInt16BE(instance.length);
  const answer = Buffer.concat([
    Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]), service,
    Buffer.from([0, 12, 0, 1, 0, 0, 0, 120]), size, instance,
  ]);
  assert.deepEqual(parseMdns(answer), [{ brand: 'androidtv', name: 'Salon TV' }]);
  assert.deepEqual(parseMdns(Buffer.from([1, 2, 3])), []);
  assert.deepEqual(parseMdns(mdnsQuery('_androidtvremote2._tcp.local')), []);
  assert.deepEqual(parseMdns(answer.subarray(0, 30)), []);
});
