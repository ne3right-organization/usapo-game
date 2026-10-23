// うさぽ ゲームコーナーのサービスワーカー。
// 通信できないときにページ遷移の代わりにオフライン画面を出すだけで、それ以外はキャッシュしない
// (ランキングや記録・ログイン状態が古いまま表示されないようにするため)。
// オフライン画面の内容を変えたら CACHE_NAME の版を上げること
const CACHE_NAME = "usapo-game-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
