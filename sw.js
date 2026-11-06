/* Service worker: cache de todos os arquivos (cache-first). A versao vem de js/version.js. */
importScripts('js/version.js');
var VERSAO = self.LV.APP_VERSION;
var CACHE = 'levantamento-' + VERSAO;
var ARQUIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'config.json', 'spec.json', 'unidades_app.json',
  'css/app.css', 'lib/jspdf.umd.min.js',
  'js/version.js', 'js/model.js', 'js/db.js', 'js/photo.js', 'js/sync.js', 'js/pdf.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ARQUIVOS.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return c.put(u, r); });
    }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('levantamento-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // backend e demais: direto na rede
  if (url.pathname.slice(-11) === 'config.json') { // configuracao: rede primeiro, cache como reserva
    e.respondWith(fetch(req).then(function (r) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put('config.json', cp); }); return r; })
      .catch(function () { return caches.match('config.json'); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(req).catch(function () { return req.mode === 'navigate' ? caches.match('index.html') : Response.error(); });
  }));
});
