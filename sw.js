// Версионированный кэш
const CACHE_NAME = 'mind-palace-v1';

// Список всех статических ресурсов для предварительного кэширования
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './crypto-js.min.js',
  './manifest.json',
  './icon.svg'
];

// Установка Service Worker и кэширование статики
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Активация и удаление старых версий кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Стратегия: Cache First, fallback to Network
self.addEventListener('fetch', (event) => {
  // Обрабатываем только GET запросы
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Кэшируем только успешные ответы
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type !== 'basic'
        ) {
          return networkResponse;
        }

        const responseToClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToClone);
        });

        return networkResponse;
      }).catch(() => {
        // Если сеть недоступна и ресурса нет в кэше, для навигации отдаем index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
