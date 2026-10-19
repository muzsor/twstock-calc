// Service Worker 單元測試 — 在 Node 裡模擬 SW 環境 (caches / fetch / 事件) 執行 sw.js
//
// 執行: node tests/sw.test.js
// 不需安裝任何套件;約 8 秒 (含兩個逾時情境)。
//
// 涵蓋:預快取清單、舊快取清除、頁面 network-first (含逾時與離線備援)、
//       靜態資源 cache-first、選用檔案抓不到不影響安裝、跨域與非 GET 不攔截
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SW_PATH = process.argv[2] || path.join(__dirname, '..', 'sw.js');
const ORIGIN = 'https://example.test';
const BASE = ORIGIN + '/twstock/';
const VERSION = '9.9.9';
const CACHE = 'twstock-calc-' + VERSION;

class FakeResponse {
  constructor(body, { status = 200, type = 'basic' } = {}) {
    this.body = body; this.status = status; this.type = type; this.ok = status >= 200 && status < 300;
  }
  clone() { return new FakeResponse(this.body, { status: this.status, type: this.type }); }
  static error() { return new FakeResponse(null, { status: 0, type: 'error' }); }
}

function makeEnv({ missing = [] } = {}) {
  const stores = new Map();   // cacheName -> Map(url -> response)
  const abs = u => new URL(typeof u === 'string' ? u : u.url, BASE).href;
  const strip = u => { const x = new URL(u); x.search = ''; return x.href; };
  const env = {
    mode: 'online', delayMs: 0, fetchLog: [], stores,
    fetch: async req => {
      const url = typeof req === 'string' ? abs(req) : req.url;
      env.fetchLog.push(url);
      if (env.delayMs) await new Promise(r => setTimeout(r, env.delayMs));
      if (env.mode === 'offline') throw new TypeError('Failed to fetch');
      if (missing.some(m => url.endsWith(m))) return new FakeResponse('not found', { status: 404 });
      return new FakeResponse('net:' + url);
    },
  };
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const add = async u => {
      const r = await env.fetch({ url: abs(u), mode: 'no-cors' });
      if (!r.ok) throw new TypeError('add failed ' + u);
      m.set(abs(u), r);
    };
    return {
      put: async (req, resp) => { m.set(abs(req), resp); },
      match: async (req, opts = {}) => {
        const key = abs(req);
        if (m.has(key)) return m.get(key);
        if (opts.ignoreSearch) for (const [k, v] of m) if (strip(k) === strip(key)) return v;
        return undefined;
      },
      keys: async () => [...m.keys()].map(url => ({ url })),
      add,
      addAll: async urls => { for (const u of urls) await add(u); },
    };
  }
  env.caches = {
    open: async name => store(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async (req, opts) => {
      for (const name of stores.keys()) {
        const r = await store(name).match(req, opts);
        if (r) return r;
      }
      return undefined;
    },
  };
  const handlers = {};
  const self = {
    location: { href: BASE + 'sw.js?v=' + VERSION, origin: ORIGIN },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const ctx = vm.createContext({
    self, caches: env.caches, fetch: r => env.fetch(r), Response: FakeResponse, URL, setTimeout, Promise, console,
  });
  vm.runInContext(fs.readFileSync(SW_PATH, 'utf8'), ctx);
  env.handlers = handlers;
  return env;
}

// 派發事件;回傳 waitUntil / respondWith 的 promise,未攔截則回傳 null
async function dispatch(env, type, req) {
  let p = null;
  const ev = {
    request: req,
    waitUntil: x => { p = x; },
    respondWith: x => { p = Promise.resolve(x).then(r => ({ r })); },
  };
  env.handlers[type](ev);
  return p;
}
const nav = p => ({ url: new URL(p, BASE).href, method: 'GET', mode: 'navigate' });
const get = p => ({ url: new URL(p, BASE).href, method: 'GET', mode: 'no-cors' });
const cacheKeys = env => [...(env.stores.get(CACHE) || new Map()).keys()];

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('install 預快取帶 ?v= 的 CSS/JS 與 PNG 圖示,不含 tests.html', async () => {
  const env = makeEnv();
  await dispatch(env, 'install');
  const keys = cacheKeys(env);
  assert(keys.includes(BASE + 'styles.css?v=' + VERSION), 'styles.css?v=');
  assert(keys.includes(BASE + 'app.js?v=' + VERSION), 'app.js?v=');
  assert(keys.includes(BASE + 'icons/apple-touch-icon.png'));
  assert(keys.includes(BASE + 'icons/apple-touch-icon-dark.png'));
  assert(!keys.some(k => k.includes('tests.html')));
});

test('選用檔案 (圖示) 抓不到:仍安裝成功,核心檔案都在', async () => {
  const env = makeEnv({ missing: ['icons/icon-512.png', 'icons/apple-touch-icon-dark.png'] });
  await dispatch(env, 'install');
  const keys = cacheKeys(env);
  assert(keys.includes(BASE + 'index.html'));
  assert(keys.includes(BASE + 'app.js?v=' + VERSION));
  assert(!keys.includes(BASE + 'icons/icon-512.png'));
  assert(keys.includes(BASE + 'icons/icon-192.png'), '其他圖示照常快取');
});

test('核心檔案抓不到:安裝失敗 (繼續用舊版)', async () => {
  const env = makeEnv({ missing: ['app.js?v=' + VERSION] });
  await assert.rejects(dispatch(env, 'install'));
});

test('activate 清掉舊版快取', async () => {
  const env = makeEnv();
  await (await env.caches.open('twstock-calc-1.0.0')).put('x', new FakeResponse('old'));
  await dispatch(env, 'install');
  await dispatch(env, 'activate');
  assert.deepStrictEqual(await env.caches.keys(), [CACHE]);
});

test('線上導覽:network-first 拿到最新頁面並更新快取', async () => {
  const env = makeEnv();
  await dispatch(env, 'install');
  await (await env.caches.open(CACHE)).put(BASE, new FakeResponse('OLD PAGE'));
  const { r } = await dispatch(env, 'fetch', nav('./'));
  assert.strictEqual(r.body, 'net:' + BASE);
  await new Promise(res => setTimeout(res, 10));
  assert.strictEqual((await (await env.caches.open(CACHE)).match(BASE)).body, 'net:' + BASE);
});

test('離線導覽:退回快取頁面 (網址帶 query 也找得到)', async () => {
  const env = makeEnv();
  await dispatch(env, 'install');
  env.mode = 'offline';
  const { r } = await dispatch(env, 'fetch', nav('./?utm=x'));
  assert.strictEqual(r.body, 'net:' + BASE);
});

test('離線且完全沒快取:回 Response.error 而不是拋例外', async () => {
  const env = makeEnv();
  env.mode = 'offline';
  const { r } = await dispatch(env, 'fetch', nav('./'));
  assert.strictEqual(r.type, 'error');
});

test('網路很慢 (> 3 秒) 但有快取:約 3 秒先回快取', async () => {
  const env = makeEnv();
  await dispatch(env, 'install');
  env.delayMs = 6000;
  const t0 = Date.now();
  const { r } = await dispatch(env, 'fetch', nav('./'));
  const dt = Date.now() - t0;
  assert.strictEqual(r.body, 'net:' + BASE);
  assert(dt >= 2900 && dt < 4500, 'elapsed ' + dt);
});

test('網路很慢且沒快取:繼續等網路,不回錯誤', async () => {
  const env = makeEnv();
  env.delayMs = 3500;
  const { r } = await dispatch(env, 'fetch', nav('./'));
  assert.strictEqual(r.body, 'net:' + BASE);
});

test('靜態資源 cache-first:命中快取不發網路請求', async () => {
  const env = makeEnv();
  await dispatch(env, 'install');
  env.fetchLog.length = 0;
  await dispatch(env, 'fetch', get('./styles.css?v=' + VERSION));
  assert.strictEqual(env.fetchLog.length, 0);
});

test('靜態資源未命中:抓網路並寫入快取', async () => {
  const env = makeEnv();
  await dispatch(env, 'install');
  await dispatch(env, 'fetch', get('./docs/screenshot-dark.png'));
  await new Promise(res => setTimeout(res, 10));
  assert(await (await env.caches.open(CACHE)).match(BASE + 'docs/screenshot-dark.png'));
});

test('跨域與非 GET 請求不攔截', async () => {
  const env = makeEnv();
  assert.strictEqual(await dispatch(env, 'fetch', { url: 'https://cdn.other/x.js', method: 'GET', mode: 'no-cors' }), null);
  assert.strictEqual(await dispatch(env, 'fetch', { url: BASE + 'x', method: 'POST', mode: 'cors' }), null);
});

(async () => {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('✓', t.name); }
    catch (e) { fail++; console.log('✗', t.name, '—', e.message); }
  }
  console.log(`${tests.length - fail}/${tests.length} 通過`);
  process.exit(fail ? 1 : 0);
})();
