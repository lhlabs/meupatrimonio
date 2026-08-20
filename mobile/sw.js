const CACHE = 'mp-mobile-v10';
const SHELL = ['./','./index.html','./mobile.css','./mobile.base.css','./mobile.js','./manifest.webmanifest','./icon.svg','./apple-touch-icon.png','../firebase-config.js','../supabase-config.js','../supabase-client.js','../compat/firebase-app.js','../compat/firebase-auth.js','../compat/firebase-firestore.js','../compat/firebase-app-check.js','../finance-logic.js','../registration.js','../security-hardening.js','../privacy-controls.js'];
async function precache(){const cache=await caches.open(CACHE);await Promise.all(SHELL.map(async path=>{const response=await fetch(path,{cache:'reload'});if(!response.ok)throw new Error(`Falha ao atualizar ${path}`);await cache.put(path,response);}));}
self.addEventListener('install', event => event.waitUntil(precache().then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request,copy)).catch(() => {}); }
    return response;
  }).catch(() => caches.match(event.request,{ignoreSearch:true}).then(response => response || caches.match('./index.html'))));
});
