const CACHE_NAME = 'inventory-pwa-v3';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 安裝階段：快取必要檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// 啟動階段：刪掉舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    )
  );
});

// 取用快取（離線可用）
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API 呼叫（/exec）一律直連，不快取
  if (url.pathname.includes('/exec')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
