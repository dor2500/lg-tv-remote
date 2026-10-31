// Simulates the Samsung, Roku, Vizio, Sony and Android TV protocols, written from open-source clients and vendor docs.
// They prove this app's logic, not that a real TV of that brand behaves the same way.
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { WebSocketServer } = require('ws');
const selfsigned = require('selfsigned');
const { pairingSecret, decode, frame, onFrames } = require('../src/main/drivers/androidtv');

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', r));
const closeServer = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
const pems = () => selfsigned.generate([{ name: 'commonName', value: 'faketv' }], { days: 2, keySize: 2048 });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

async function startFakeSamsung({ approve = true } = {}) {
  const log = [];
  const rest = http.createServer((req, res) => {
    res.end(JSON.stringify({ device: { modelName: 'QE55Q80', type: 'Samsung SmartTV', wifiMac: 'aa:bb:cc:00:00:01' } }));
  });
  const wss = new WebSocketServer({ server: rest });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    log.push({ type: 'connect', token: url.searchParams.get('token'), name: url.searchParams.get('name') });
    if (!approve) {
      ws.send(JSON.stringify({ event: 'ms.channel.unauthorized' }));
      return;
    }
    ws.send(JSON.stringify({ event: 'ms.channel.connect', data: { token: url.searchParams.get('token') || 'samsung-token' } }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      log.push(msg);
      if (msg.params && msg.params.event === 'ed.installedApp.get') {
        ws.send(JSON.stringify({ event: 'ed.installedApp.get', data: { data: [
          { appId: '11101200001', name: 'Netflix', app_type: 2 }, { appId: 'org.tizen.browser', name: 'Internet', app_type: 4 },
        ] } }));
      }
    });
  });
  await listen(rest);
  const { port } = rest.address();
  return {
    log,
    config: { endpoints: [`ws://127.0.0.1:${port}`], restBase: `http://127.0.0.1:${port}` },
    dropClients: () => { for (const c of wss.clients) c.terminate(); },
    close: async () => { for (const c of wss.clients) c.terminate(); await closeServer(rest); },
  };
}

async function startFakeRoku({ isTv = true, locked = false } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    if (locked && req.url.startsWith('/keypress')) { res.statusCode = 403; res.end(); return; }
    if (req.url === '/query/device-info') {
      res.end(`<device-info><vendor-name>TCL</vendor-name><model-name>55R635</model-name><is-tv>${isTv}</is-tv><wifi-mac>aa:bb:cc:00:00:02</wifi-mac></device-info>`);
    } else if (req.url === '/query/apps') {
      res.end('<apps><app id="12" type="appl">Netflix</app><app id="837" type="appl">Tom &amp; Jerry &lt;b&gt;</app></apps>');
    } else if (req.url === '/query/active-app') {
      res.end('<active-app><app id="12">Netflix</app></active-app>');
    } else {
      res.end();
    }
  });
  await listen(server);
  return { log, config: { base: `http://127.0.0.1:${server.address().port}`, pollMs: 50 }, close: () => closeServer(server) };
}

async function startFakeVizio() {
  const log = [];
  const { private: key, cert } = pems();
  const ok = (extra = {}) => JSON.stringify({ STATUS: { RESULT: 'SUCCESS' }, ...extra });
  const server = https.createServer({ key, cert }, async (req, res) => {
    const text = await readBody(req);
    const body = text ? JSON.parse(text) : null;
    log.push({ method: req.method, url: req.url, body, auth: req.headers.auth });
    if (req.url === '/pairing/start') {
      res.end(JSON.stringify({ status: { result: 'SUCCESS' }, item: { pairing_req_token: 77, challenge_type: 1 } }));
    } else if (req.url === '/pairing/pair') {
      if (body.RESPONSE_VALUE === '1234' && body.PAIRING_REQ_TOKEN === 77) res.end(ok({ ITEM: { AUTH_TOKEN: 'vizio-token' } }));
      else res.end(JSON.stringify({ STATUS: { RESULT: 'PAIRING_DENIED' } }));
    } else if (req.headers.auth !== 'vizio-token' && req.url !== '/state/device/deviceinfo') {
      res.end(JSON.stringify({ STATUS: { RESULT: 'REQUIRES_PAIRING' } }));
    } else if (req.url === '/state/device/deviceinfo') {
      res.end(ok({ ITEMS: [{ VALUE: { MODEL_NAME: 'M55Q7' } }] }));
    } else if (req.url.endsWith('/name_input')) {
      res.end(ok({ ITEMS: [{ NAME: 'HDMI-1', VALUE: { NAME: 'Console' } }, { NAME: 'CAST', VALUE: { NAME: 'SmartCast' } }] }));
    } else if (req.method === 'GET' && (req.url.endsWith('/current_input') || req.url.endsWith('/volume'))) {
      res.end(ok({ ITEMS: [{ HASHVAL: 555, VALUE: 12 }] }));
    } else {
      res.end(ok());
    }
  });
  await listen(server);
  return { log, config: { bases: [`https://127.0.0.1:${server.address().port}`], pollMs: 50 }, close: () => closeServer(server) };
}

async function startFakeSony({ psk = 'secret' } = {}) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const text = await readBody(req);
    if (req.url === '/sony/ircc') {
      log.push({ ircc: /<IRCCCode>(.*)<\/IRCCCode>/.exec(text)[1], action: req.headers.soapaction, psk: req.headers['x-auth-psk'] });
      res.statusCode = req.headers['x-auth-psk'] === psk ? 200 : 403;
      res.end();
      return;
    }
    const msg = JSON.parse(text);
    log.push({ url: req.url, method: msg.method, params: msg.params });
    const reply = (result) => res.end(JSON.stringify({ id: msg.id, result }));
    if (msg.method === 'getVersions') return reply([['1.0']]);
    if (msg.method === 'getPowerStatus') return reply([{ status: 'active' }]);
    if (req.headers['x-auth-psk'] !== psk) { res.statusCode = 403; return res.end(JSON.stringify({ id: msg.id, error: [403, 'Forbidden'] })); }
    switch (msg.method) {
      case 'getSystemInformation': return reply([{ model: 'KD-55X90', macAddr: 'aa:bb:cc:00:00:03' }]);
      case 'getRemoteControllerInfo': return reply([{}, [{ name: 'Home', value: 'AAAAHOME' }, { name: 'Up', value: 'AAAAUP' }]]);
      case 'getApplicationList': return reply([[{ title: 'YouTube', uri: 'com.sony.dtv.youtube' }]]);
      case 'getCurrentExternalInputsStatus': return reply([[{ uri: 'extInput:hdmi?port=1', title: 'HDMI 1', label: 'Xbox' }]]);
      case 'getVolumeInformation': return reply([[{ target: 'speaker', volume: 15, mute: false }]]);
      default: return reply([]);
    }
  });
  await listen(server);
  return { log, config: { base: `http://127.0.0.1:${server.address().port}`, pollMs: 50 }, close: () => closeServer(server) };
}

async function startFakeAndroidTv({ code = null } = {}) {
  const log = [];
  const { private: key, cert } = pems();
  const trusted = new Set();
  const sockets = new Set();
  const options = { key, cert, requestCert: true, rejectUnauthorized: false };
  const track = (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); };
  const fingerprint = (socket) => socket.getPeerCertificate().fingerprint256;
  const clientPem = (socket) => new crypto.X509Certificate(socket.getPeerCertificate().raw).toString();

  // A valid code is the 4 hex digits of nonce plus the secret's first byte, which depends on the client's certificate.
  function codeFor(pem) {
    for (let i = 0; i < 65536; i += 1) {
      const nonce = i.toString(16).padStart(4, '0');
      const secret = pairingSecret(pem, cert, `00${nonce}`);
      if (nonce === 'c0de' || code === nonce) return secret[0].toString(16).padStart(2, '0') + nonce;
    }
    return null;
  }

  const fake = { log, trusted, code: null, config: null };
  const pairing = tls.createServer(options, (socket) => {
    track(socket);
    onFrames(socket, (msg) => {
      const send = (fields, status = 200) => socket.write(frame([[1, 2], [2, status], ...fields]));
      if (msg.has(10)) {
        const request = decode(msg.get(10));
        log.push({ type: 'pair-request', service: request.get(1).toString(), client: request.get(2).toString() });
        fake.code = codeFor(clientPem(socket));
        send([[11, [[1, 'Fake TV']]]]);
      } else if (msg.has(20)) {
        send([[20, [[1, [[1, 3], [2, 6]]], [3, 1]]]]);
      } else if (msg.has(30)) {
        send([[31, []]]);
      } else if (msg.has(40)) {
        const secret = decode(msg.get(40)).get(1);
        if (secret.equals(pairingSecret(clientPem(socket), cert, fake.code))) {
          trusted.add(fingerprint(socket));
          send([[41, [[1, secret]]]]);
        } else {
          send([], 402);
        }
      }
    });
  });
  const remote = tls.createServer(options, (socket) => {
    track(socket);
    if (!trusted.has(fingerprint(socket))) {
      socket.destroy();
      return;
    }
    log.push({ type: 'remote-open' });
    onFrames(socket, (msg) => {
      if (msg.has(1)) {
        log.push({ type: 'configure', features: decode(msg.get(1)).get(1) });
        socket.write(frame([[2, [[1, 622]]]]));
      } else if (msg.has(2)) {
        socket.write(frame([[40, [[1, 1]]]]));
        socket.write(frame([[50, [[6, 50], [7, 10]]]]));
        socket.write(frame([[8, [[1, 9]]]]));
        socket.write(frame([[21, [[1, 5], [2, 6]]]]));
      } else if (msg.has(9)) {
        log.push({ type: 'pong', value: decode(msg.get(9)).get(1) });
      } else if (msg.has(10)) {
        const press = decode(msg.get(10));
        log.push({ type: 'key', code: press.get(1), direction: press.get(2) });
      } else if (msg.has(90)) {
        log.push({ type: 'launch', link: decode(msg.get(90)).get(1).toString() });
      } else if (msg.has(21)) {
        const edit = decode(msg.get(21));
        const info = decode(decode(edit.get(3)).get(2));
        log.push({ type: 'text', ime: edit.get(1), field: edit.get(2), value: info.get(3).toString(), end: info.get(2) || 0 });
      }
    });
    socket.write(frame([[1, [[1, 622], [2, [[1, 'Bravia XR'], [2, 'Sony']]]]]]));
  });
  await listen(pairing);
  await listen(remote);
  fake.config = { connectHost: '127.0.0.1', pairingPort: pairing.address().port, remotePort: remote.address().port };
  fake.dropClients = () => { for (const s of sockets) s.destroy(); };
  fake.forgetClients = () => trusted.clear();
  fake.close = async () => {
    for (const s of sockets) s.destroy();
    await new Promise((r) => pairing.close(r));
    await new Promise((r) => remote.close(r));
  };
  return fake;
}

module.exports = { startFakeSamsung, startFakeRoku, startFakeVizio, startFakeSony, startFakeAndroidTv };
