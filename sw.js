// 台股交易計算機 — Service Worker
//
// 策略:cache-first,同源 GET 才攔截
//   - 首次造訪預先快取主要檔案,之後完全離線可用
//   - 維持「零外部請求」承諾:跨域 URL 直接跳過,不做任何攔截或代理
//
// 版本失效:
//   - 註冊時帶 ?v=X.Y.Z query (index.html 的 navigator.serviceWorker.register)
//   - 改 APP_VERSION 即視為新 SW,自動清舊 cache + 立即接管
//
// 開發注意:
//   - SW 不能跑在 file:// 協議 — 必須 http server 或 https
//   - 若改了快取清單但沒改版本,瀏覽器不會重新觸發 install
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `twstock-calc-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './tests.html',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 維持零外部請求承諾:跨域不攔截、不代理
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // 只快取成功的同源回應
        if (resp.ok && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);  // 網路失敗就回 cache (若有);否則讓瀏覽器顯示原生離線
    })
  );
});
