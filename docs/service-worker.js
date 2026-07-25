// Простой service worker: кеширует "оболочку" приложения,
// чтобы оно открывалось и было устанавливаемо как приложение.
// Данные (заказы) всегда идут через сеть напрямую в Supabase —
// офлайн-редактирование не поддерживается, только просмотр
// последней загруженной оболочки.
//
// Стратегия — "сеть в приоритете": при наличии интернета всегда
// берём свежую версию файла и обновляем кеш; кеш используется только
// как запасной вариант, если сети нет (офлайн). Так изменения,
// закоммиченные на GitHub, подхватываются сразу при следующем
// открытии приложения, без ручной очистки кеша.
const CACHE_NAME = 'funtrail-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Никогда не кешируем запросы к Supabase — только статику того же источника
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
