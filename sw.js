// 台股交易計算機 — Service Worker
//
// 策略:同源 GET 才攔截
//   - 頁面導覽 (navigate):network-first,逾時或離線才退回快取
//       → 線上一律拿到最新 index.html,才會載入新版 app.js 並註冊新版 SW
//       (舊版 cache-first 會讓舊 index.html → 舊 app.js → 註冊同一個舊 SW,永遠卡在舊版)
//   - 其他靜態資源:cache-first (URL 帶 ?v= 版本號,換版即換 URL)
//   - 維持「零外部請求」承諾:跨域 URL 直接跳過,不做任何攔截或代理
//
// 版本失效:
//   - 註冊時帶 ?v=X.Y.Z query (app.js 的 navigator.serviceWorker.register)
//   - 改 APP_VERSION 即視為新 SW,自動清舊 cache + 立即接管
//
// 開發注意:
//   - SW 不能跑在 file:// 協議 — 必須 http server 或 https
//   - 若改了快取清單但沒改版本,瀏覽器不會重新觸發 install
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `twstock-calc-${VERSION}`;
// 必須與 index.html 實際請求的 URL 完全一致 (含 ?v=),否則首次安裝後離線開啟會 cache miss
// 核心檔案:任一抓不到就整個安裝失敗 (沒有它們離線也開不起來,不如繼續用舊版)
const CORE_ASSETS = [
  './',
  './index.html',
  `./styles.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
];
// 選用檔案:個別快取,抓不到 (例如部署時漏傳圖示) 也不影響新版安裝
const OPTIONAL_ASSETS = [
  './manifest.json',
  './icons/icon-light.svg',
  './icons/apple-touch-icon.png',
  './icons/apple-touch-icon-dark.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
// 行動網路不穩時,導覽請求最多等這麼久就先用快取顯示
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE_ASSETS).then(() =>
        Promise.all(OPTIONAL_ASSETS.map(u => c.add(u).catch(() => {})))
      ))
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

// 只快取成功的同源回應;配額滿 / 私密模式等失敗無聲略過,不影響回應
function putInCache(req, resp) {
  if (resp.ok && resp.type === 'basic') {
    const clone = resp.clone();
    caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
  }
  return resp;
}

// 導覽請求的離線備援:同路徑 (忽略 query) → index.html → ./
function cachedPage(req) {
  return caches.match(req, { ignoreSearch: true })
    .then(r => r || caches.match('./index.html'))
    .then(r => r || caches.match('./'));
}

function networkFirst(req) {
  const network = fetch(req).then(resp => putInCache(req, resp));
  network.catch(() => {});  // 已改用快取回應時,避免網路失敗變成 unhandled rejection
  // 逾時:有快取就先用快取;沒快取就繼續等網路
  const timeout = new Promise(res => setTimeout(res, NAV_TIMEOUT_MS)).then(() => cachedPage(req));
  return Promise.race([network, timeout])
    .then(r => r || network)
    .catch(() => cachedPage(req).then(r => r || Response.error()));
}

function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) return cached;
    return fetch(req).then(resp => putInCache(req, resp));
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 維持零外部請求承諾:跨域不攔截、不代理
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(e.request.mode === 'navigate' ? networkFirst(e.request) : cacheFirst(e.request));
});
