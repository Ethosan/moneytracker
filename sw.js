// Keeps the app opening offline. Pages and scripts: try the network, fall back to the cached copy.
const CACHE = 'ledger-v59';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-512-maskable.png', './icons/apple-touch-icon.png',
  './fonts/Geist-Regular.woff2', './fonts/Geist-Medium.woff2', './fonts/Geist-SemiBold.woff2', './fonts/Geist-Bold.woff2'];
// On a weak signal the network can hang for a long time without failing. After this long,
// open from the cached copy instead; the network reply still refreshes the cache when it lands.
const SLOW_MS = 3000;
self.addEventListener('install', e => {
  // Cache files one by one: a single missing file must not stop the worker installing,
  // because without an active worker Chrome refuses to treat the site as installable.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co')) return; // never cache your data API
  const net = fetch(e.request).then(r => {
    if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)).catch(() => {}); }
    return r;
  });
  const cached = () => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
  e.respondWith(new Promise(resolve => {
    let done = false;
    const answer = r => { if (!done && r) { done = true; resolve(r); } };
    const slow = setTimeout(() => cached().then(answer), SLOW_MS);
    net.then(r => { clearTimeout(slow); answer(r); }).catch(() => {
      clearTimeout(slow);
      cached().then(m => m || caches.match('./index.html')).then(m => { answer(m || Response.error()); });
    });
  }));
  e.waitUntil(net.catch(() => {}));
});
