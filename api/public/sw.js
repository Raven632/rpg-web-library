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

// Перехват запросов (Умная стратегия: Stale-While-Revalidate)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. СТРОГО СЕТЬ: API, Сохранения и Сокеты мимо кэша
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return; // Возврат управления браузеру (идет напрямую в сеть)
  }

  // 2. Стратегия для ядра и тяжелых ассетов
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Если файл есть в нашем кэше (CORE_ASSETS), отдаем его МГНОВЕННО (0ms)
      if (cachedResponse) {
        // В фоновом режиме стягиваем свежую версию интерфейса с сервера
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {}); // Если интернета нет, просто игнорируем ошибку
        
        return cachedResponse;
      }

      // Если файла нет в кэше (это тяжелые файлы игр), качаем из сети.
      // И мы НЕ сохраняем их в кэш (cache.put), чтобы спасти память телефона!
      return fetch(event.request);
    })
  );
});