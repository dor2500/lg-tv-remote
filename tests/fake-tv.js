// Simulates the LG TV side of the protocol, built from the behaviour of open-source clients.
// It proves this app's logic, not that a given real TV behaves the same way.
const http = require('node:http');
const https = require('node:https');
const { WebSocketServer } = require('ws');
const selfsigned = require('selfsigned');

const LAUNCH_POINTS = [
  { id: 'netflix', title: 'Netflix', icon: 'http://10.0.0.99/netflix.png' },
  { id: 'youtube.leanback.v4', title: 'YouTube' },
  { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
  { id: 'evil', title: '<img src=x onerror=alert(1)>' },
];

async function startFakeTv({ pairing = 'PROMPT', approveAfterMs = 50, denyCapture = false, rejectPairing = false, blacklistSigned = false, cleanApps = false, port = 0 } = {}) {
  const pems = selfsigned.generate([{ name: 'commonName', value: 'lgsmarttv' }], { days: 2, keySize: 2048 });
  const log = [];
  const knownKeys = new Set();
  const sockets = new Set();
  const state = { volume: 20, muted: false, appId: 'netflix', frame: 0, cursor: { x: 480, y: 270 } };

  const imageServer = http.createServer((req, res) => {
    state.frame += 1;
    const { x, y } = state.cursor;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">
      <rect width="960" height="540" fill="#123"/>
      <text x="480" y="240" fill="#fff" font-size="44" text-anchor="middle" font-family="sans-serif">Fake TV: ${state.appId}</text>
      <text x="480" y="300" fill="#9cf" font-size="26" text-anchor="middle" font-family="sans-serif">frame ${state.frame}</text>
      <circle cx="${x}" cy="${y}" r="10" fill="#f55"/></svg>`);
  });
  await new Promise((r) => imageServer.listen(0, '127.0.0.1', r));
  const imagePort = imageServer.address().port;

  const tls = https.createServer({ key: pems.private, cert: pems.cert });
  const wss = new WebSocketServer({ noServer: true });
  tls.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on('close', () => sockets.delete(ws));
      if (req.url.includes('netinput.pointer.sock')) handlePointer(ws);
      else handleMain(ws);
    });
  });
  await new Promise((r) => tls.listen(port, '127.0.0.1', r));
  const tvPort = tls.address().port;

  function handlePointer(ws) {
    ws.on('message', (data) => {
      const fields = Object.fromEntries(
        data.toString().trim().split('\n').map((line) => line.split(':')),
      );
      log.push({ channel: 'pointer', ...fields });
      if (fields.type === 'move') {
        state.cursor.x = Math.max(0, Math.min(960, state.cursor.x + Number(fields.dx)));
        state.cursor.y = Math.max(0, Math.min(540, state.cursor.y + Number(fields.dy)));
      }
    });
  }

  function handleMain(ws) {
    const reply = (id, payload, type = 'response') => ws.send(JSON.stringify({ type, id, payload }));
    const fail = (id, error) => ws.send(JSON.stringify({ type: 'error', id, error, payload: {} }));
    let pendingRegisterId = null;

    const approve = (id) => {
      const key = `key-${knownKeys.size + 1}`;
      knownKeys.add(key);
      reply(id, { 'client-key': key }, 'registered');
    };

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register') {
        log.push({ channel: 'main', type: 'register', hadKey: Boolean(msg.payload['client-key']), pairingType: msg.payload.pairingType, signed: Boolean(msg.payload.manifest.signatures) });
        if (blacklistSigned && msg.payload.manifest.signatures) {
          fail(msg.id, '403 Pairing rejected: blacklisted certificate detected');
          return;
        }
        if (knownKeys.has(msg.payload['client-key'])) {
          reply(msg.id, { 'client-key': msg.payload['client-key'] }, 'registered');
          return;
        }
        if (msg.payload['client-key']) {
          fail(msg.id, '401 invalid client key');
          return;
        }
        const type = msg.payload.pairingType === 'PIN' ? 'PIN' : pairing;
        reply(msg.id, { pairingType: type, returnValue: true });
        pendingRegisterId = msg.id;
        if (type === 'PROMPT') {
          setTimeout(() => {
            if (rejectPairing) fail(msg.id, '403 User denied access');
            else approve(msg.id);
          }, approveAfterMs);
        }
        return;
      }

      log.push({ channel: 'main', type: msg.type, uri: msg.uri, payload: msg.payload });
      const uri = (msg.uri || '').replace('ssap://', '');
      switch (uri) {
        case 'pairing/setPin':
          if (msg.payload.pin !== '1234') {
            fail(msg.id, 'wrong pin');
          } else {
            reply(msg.id, { returnValue: true });
            approve(pendingRegisterId);
          }
          break;
        case 'com.webos.service.networkinput/getPointerInputSocket':
          // Real TVs report their LAN address; the client must keep using the host it connected to.
          reply(msg.id, { returnValue: true, socketPath: `wss://10.0.0.99:${tvPort}/resources/abc/netinput.pointer.sock` });
          break;
        case 'tv/executeOneShot':
          if (denyCapture) fail(msg.id, '401 insufficient permissions');
          else reply(msg.id, { returnValue: true, imageUri: `http://10.0.0.99:${imagePort}/resources/capture.jpg` });
          break;
        case 'com.webos.applicationManager/listLaunchPoints':
          reply(msg.id, { returnValue: true, launchPoints: cleanApps ? LAUNCH_POINTS.filter((p) => p.id !== 'evil') : LAUNCH_POINTS });
          break;
        case 'tv/getExternalInputList':
          reply(msg.id, { returnValue: true, devices: [{ id: 'HDMI_1', label: 'HDMI 1' }, { id: 'HDMI_2', label: 'PlayStation' }] });
          break;
        case 'system/getSystemInfo':
          reply(msg.id, { returnValue: true, modelName: 'OLED55C3' });
          break;
        case 'com.webos.service.update/getCurrentSWInformation':
          reply(msg.id, { returnValue: true, product_name: 'webOSTV 23', major_ver: '03', minor_ver: '21' });
          break;
        case 'com.webos.service.connectionmanager/getinfo':
          reply(msg.id, { returnValue: true, wiredInfo: { macAddress: 'aa:bb:cc:dd:ee:ff' } });
          break;
        case 'audio/getVolume':
          reply(msg.id, { returnValue: true, volumeStatus: { volume: state.volume, muteStatus: state.muted } });
          break;
        case 'audio/setVolume':
          state.volume = msg.payload.volume;
          reply(msg.id, { returnValue: true });
          break;
        case 'com.webos.applicationManager/getForegroundAppInfo':
          reply(msg.id, { returnValue: true, appId: state.appId });
          break;
        case 'com.webos.applicationManager/launch':
          state.appId = msg.payload.id;
          reply(msg.id, { returnValue: true });
          break;
        case 'tv/switchInput':
          if (msg.payload.inputId === 'BROKEN') reply(msg.id, { returnValue: false, errorText: 'no such input' });
          else reply(msg.id, { returnValue: true });
          break;
        case 'silent/never':
          break;
        default:
          reply(msg.id, { returnValue: true });
      }
    });
  }

  return {
    port: tvPort,
    endpoint: `wss://127.0.0.1:${tvPort}`,
    log,
    state,
    knownKeys,
    dropClients: () => { for (const s of sockets) s.terminate(); },
    close: async () => {
      for (const s of sockets) s.terminate();
      await new Promise((r) => tls.close(r));
      await new Promise((r) => imageServer.close(r));
    },
  };
}

module.exports = { startFakeTv };
