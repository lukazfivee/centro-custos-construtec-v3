// Guarda o site do celular para abrir sem internet. A API nunca e guardada aqui:
// os dados offline ficam no IndexedDB (queue.js), com a fila de lancamentos.
const CACHE = 'cc-celular-v15';
const SHELL = ['./', 'index.html', 'm.css', 'anim.css', 'barra.css', 'tema.js', 'icons.js', 'core.js', 'queue.js', 'app.js',
  'screen-home.js', 'screen-obra.js', 'screen-lancar.js', 'screen-misc.js', 'screen-lancamentos.js', 'screen-lanc.js', 'screen-lanc-docs.js', 'screen-obra-acoes.js', 'screen-servico.js', 'screen-servico-fila.js', 'screen-servico-exec.js', 'screen-servico-gasto.js', 'screen-servico-fim.js', 'screen-servico-form.js', 'servico.css', 'screen-descartadas.js', 'suite.js', 'screen-avisos.js', 'screen-pedidos.js', 'screen-perfil.js', 'screen-atualizacao.js',
  'ia-config.js', 'ia-tools.js', 'ia-chat.js', 'screen-entrar.js', 'simbolo.png',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'fonts/plex-400.woff2', 'fonts/plex-500.woff2', 'fonts/plex-600.woff2', 'fonts/plex-700.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cc-celular-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Rede primeiro (para receber atualizacoes); sem internet, usa a copia guardada.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/m/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
