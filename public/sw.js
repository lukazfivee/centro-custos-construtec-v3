// "Kill switch": este app nao usa service worker. Uma versao anterior (o PWA
// separado em cloudflare-sync-worker/public/sw.js) registrou um service
// worker neste mesmo dominio, que continua interceptando requisicoes (login,
// /api/auth/me, etc.) mesmo depois do dominio passar a servir o app desktop.
// Como nao ha como alcancar o navegador de quem ja instalou o SW antigo, a
// unica forma de corrigir para todo mundo e publicar, no mesmo caminho
// /sw.js, uma versao que se desativa sozinha assim que o navegador checar
// atualizacoes (o que acontece automaticamente a cada navegacao).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })()
  );
});
