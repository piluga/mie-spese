const CACHE_NAME = 'spesepro-cache-v2';

// Risorse fondamentali da salvare subito in memoria
const urlsToCache = [
    './',
    'index.html', // Specifichiamo il nome esatto del tuo file HTML
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@500;600;700&display=swap'
];

// FASE 1: Installazione e caching iniziale
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// FASE 2: Attivazione e pulizia vecchie cache
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

// FASE 3: Intercettazione chiamate di rete (Offline Mode)
self.addEventListener('fetch', event => {
    // Ignora le chiamate API verso Gemini (devono sempre richiedere internet)
    if (event.request.url.includes('generativelanguage.googleapis.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // Se c'è in cache, usa quello (velocissimo)
            if (cachedResponse) {
                return cachedResponse;
            }

            // Altrimenti scaricalo da internet e salvalo in cache per la prossima volta
            return fetch(event.request).then(networkResponse => {
                // Salva solo le risposte valide e sicure (http/https)
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
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