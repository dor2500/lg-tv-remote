// Saved TVs. The client key lets anyone holding it control the TV, so it is encrypted with Windows DPAPI.
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

function filePath() {
  return path.join(app.getPath('userData'), 'tvs.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    return { lastHost: null, tvs: {} };
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2));
}

function encryptKey(key) {
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(key).toString('base64') };
  return { plain: key };
}

function decryptKey(stored) {
  if (!stored) return null;
  if (stored.plain) return stored.plain;
  try {
    return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
  } catch {
    return null;
  }
}

function getKey(host) {
  const tv = readAll().tvs[host];
  return tv ? decryptKey(tv.key) : null;
}

function getBrand(host) {
  const tv = readAll().tvs[host];
  if (!tv) return null;
  // TVs saved before other brands were supported have no brand field, and were all LG.
  return tv.brand || (tv.key ? 'webos' : null);
}

function saveTv(host, fields) {
  const data = readAll();
  const tv = data.tvs[host] || {};
  if (fields.key) tv.key = encryptKey(fields.key);
  for (const name of ['brand', 'label', 'mac', 'wifiMac']) {
    if (fields[name]) tv[name] = fields[name];
  }
  data.tvs[host] = tv;
  data.lastHost = host;
  writeAll(data);
}

function forgetTv(host) {
  const data = readAll();
  delete data.tvs[host];
  if (data.lastHost === host) data.lastHost = null;
  writeAll(data);
}

function listTvs() {
  const data = readAll();
  return {
    lastHost: data.lastHost,
    tvs: Object.entries(data.tvs).map(([host, tv]) => ({
      host, brand: tv.brand || 'webos', label: tv.label || host, hasMac: Boolean(tv.mac || tv.wifiMac),
    })),
  };
}

function getMacs(host) {
  const tv = readAll().tvs[host] || {};
  return [tv.mac, tv.wifiMac].filter(Boolean);
}

module.exports = { getKey, getBrand, saveTv, forgetTv, listTvs, getMacs };
