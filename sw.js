const CACHE_NAME = 'spesepro-cache-v6';

// I file base e le librerie esterne da salvare per l'uso offline
const urlsToCache = [
    './',
    './index.html',
    './manifest.json'
];

// FASE 1: Installazione (Salvataggio in Cache)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Cache aperta e file salvati');
                return cache.addAll(urlsToCache);
            })
    );
});

// FASE 2: Intercettazione delle richieste (Network First, poi Cache)
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request).catch(() => {
            // Se la richiesta di rete fallisce (es. sei offline), cerca nella cache
            return caches.match(event.request);
        })
    );
});

// FASE 3: Attivazione e pulizia delle vecchie cache
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('Service Worker: Vecchia cache eliminata', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});


