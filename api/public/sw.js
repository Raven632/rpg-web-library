// sw.js — Service Worker (Enterprise Caching Engine)
const CACHE_NAME = 'rpg-shell-v1';

// Кэшируем только ядро библиотеки. Сами игры кэшировать здесь нельзя, 
// иначе браузер быстро забьет память телефона (Quota Exceeded).
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/rpg-fixes.js',
  '/manifest.json'
];

// Установка: скачиваем ядро в оффлайн-память
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Активация: удаляем старые кэши, если мы обновили версию
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))
    ))
  );
  self.clients.claim();
});

// Перехват запросов (Сетевая стратегия)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // ⚡ КРИТИЧЕСКИ ВАЖНО: Никогда не кэшируем API сохранений!
  // Они всегда должны идти напрямую на сервер.
  if (url.includes('/api/saves/')) return;

  // Для всего остального используем стратегию "Network First, fallback to Cache"
  event.respondWith(
    fetch(event.request).catch(() => {
      // Если интернета нет (fetch упал), пытаемся достать файл из кэша
      return caches.match(event.request);
    })
  );
});