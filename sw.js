// Scegliamo un nome per la cache. Quando aggiorni l'app, cambia 'v1' in 'v2' per forzare l'aggiornamento
const CACHE_NAME = 'medicinepro-v1';

// Risorse essenziali da salvare sul dispositivo per l'uso offline
const urlsToCache = [
    './MedicinePro.html', // Assicurati che il nome del tuo file HTML sia esattamente questo
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap',
    'https://i.ibb.co/N6db36Sf/medicine.png' // L'icona dell'app
];

// 1. INSTALLAZIONE: Il browser scarica le risorse e le mette in cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Cache aperta, salvataggio risorse...');
                return cache.addAll(urlsToCache);
            })
    );
    self.skipWaiting(); // Forza l'attivazione immediata del SW
});

// 2. ATTIVAZIONE: Pulizia delle vecchie cache se hai cambiato la versione (es. da v1 a v2)
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Rimozione vecchia cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim(); // Prende il controllo di tutte le pagine aperte
});

// 3. FETCH: Intercetta le richieste di rete (La vera magia offline)
self.addEventListener('fetch', event => {
    // IGNORA le richieste all'API di Google Gemini: devono sempre usare la rete
    if (event.request.url.includes('generativelanguage.googleapis.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Se la risorsa è già in cache, restituiscila (Funziona offline!)
                if (response) {
                    return response;
                }
                
                // Se non è in cache, prova a scaricarla da internet
                return fetch(event.request).then(networkResponse => {
                    // Controlla che la risposta di rete sia valida
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse;
                    }

                    // Salva una copia della nuova risorsa in cache per la prossima volta
                    let responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });

                    return networkResponse;
                });
            }).catch(() => {
                // Se siamo offline e la risorsa non è in cache, restituiamo nulla.
                // Potresti eventualmente mostrare una pagina di "Offline" personalizzata qui.
                console.log('[Service Worker] Risorsa non trovata in cache e rete assente.');
            })
    );
});
