// Assembles the phone site, and the TV apps if given a relay address, into anywhere/dist. Usage: node anywhere/build.js [relay-url]
const fs = require('node:fs');
const path = require('node:path');
const { UNSIGNED_MANIFEST } = require('../src/main/manifest');

const relay = process.argv[2] || process.env.TV_RELAY_URL;
if (relay && !/^wss?:\/\//.test(relay)) {
  console.error('Usage: node anywhere/build.js [wss://relay-address]');
  process.exit(2);
}
const here = __dirname;
const dist = path.join(here, 'dist');
const nacl = path.dirname(require.resolve('tweetnacl/package.json'));
const config = `window.TV_CONFIG = ${JSON.stringify({ relay })};\n`;

function copyInto(target, files) {
  fs.mkdirSync(target, { recursive: true });
  for (const [name, source] of Object.entries(files)) fs.copyFileSync(source, path.join(target, name));
}

const shared = { 'nacl-fast.min.js': path.join(nacl, 'nacl-fast.min.js'), 'session.js': path.join(here, 'shared', 'session.js') };
const agent = {
  ...shared,
  'core.js': path.join(here, 'agent', 'core.js'),
  'ui.js': path.join(here, 'agent', 'ui.js'),
  'index.html': path.join(here, 'agent', 'index.html'),
};

fs.rmSync(dist, { recursive: true, force: true });

const phone = Object.fromEntries(['index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon.svg', 'sw.js'].map((name) => [name, path.join(here, 'phone', name)]));
copyInto(path.join(dist, 'phone'), { ...shared, ...phone });

if (!relay) {
  console.log('Built the phone site');
  process.exit(0);
}

const webos = path.join(dist, 'webos');
copyInto(webos, { ...agent, 'webos-adapter.js': path.join(here, 'agent', 'adapter-webos.js'), 'appinfo.json': path.join(here, 'tv-webos', 'appinfo.json'), 'icon.png': path.join(here, 'tv-webos', 'icon.png') });
fs.writeFileSync(path.join(webos, 'config.js'), config);
fs.writeFileSync(path.join(webos, 'adapter.js'), `${fs.readFileSync(path.join(webos, 'webos-adapter.js'), 'utf8')}
window.createTvAdapter = function (options) {
  options.manifest = ${JSON.stringify(UNSIGNED_MANIFEST)};
  return new window.TvWebosAdapter(options);
};
`);
fs.rmSync(path.join(webos, 'webos-adapter.js'));

console.log(`Built for ${relay}`);
