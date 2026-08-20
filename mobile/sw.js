const CACHE = 'mp-mobile-v6';
const SHELL = ['./','./index.html','./mobile.css','./mobile.base.css','./mobile.js','./manifest.webmanifest','./icon.svg','./apple-touch-icon.png','../firebase-config.js','../supabase-config.js','../supabase-client.js','../compat/firebase-app.js','../compat/firebase-auth.js','../compat/firebase-firestore.js','../compat/firebase-app-check.js','../finance-logic.js','../registration.js','../security-hardening.js','../privacy-controls.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request,copy)); return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match('./index.html'))));
});
