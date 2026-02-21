const CACHE_NAME = 'spesepro-cache-v7';

// I file base e le librerie esterne da salvare per l'uso offline
const urlsToCache = [
    './',
    './index.html',
    './manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                          .map(name => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// FASE 3: Intercettazione e Caching Dinamico
self.addEventListener('fetch', event => {
    // Ignora le chiamate API verso Gemini
    if (event.request.url.includes('generativelanguage.googleapis.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // 1. Se c'è in cache, usa quello (velocissimo)
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // 2. Altrimenti scaricalo da internet e salvalo "al volo"
            return fetch(event.request).then(networkResponse => {
                // Accettiamo anche le risposte "opache" (status 0) per aggirare il blocco CORS di Tailwind e Chart.js
                if(!networkResponse || (networkResponse.status !== 200 && networkResponse.status !== 0)) {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    // Salva dinamicamente tutto ciò che viene caricato (immagini, font, CDN)
                    if (event.request.url.startsWith('http')) {
                        cache.put(event.request, responseToCache);
                    }
                });

                return networkResponse;
            }).catch(() => {
                console.log('Sei offline e la risorsa non è in cache:', event.request.url);
            });
        })
    );
});
