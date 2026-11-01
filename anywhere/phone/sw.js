// Keeps the app's own files available so it opens instantly and can be installed. Sessions always need the network.
const CACHE = 'tv-anywhere-1';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'session.js', 'nacl-fast.min.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))),
));
// Network first, so updates reach the phone whenever it is online.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
