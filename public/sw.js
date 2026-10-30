// うさぽ ゲームコーナーのサービスワーカー。
// 通信できないときにページ遷移の代わりにオフライン画面を出すだけで、それ以外はキャッシュしない
// (ランキングや記録・ログイン状態が古いまま表示されないようにするため)。
// ほかに、PWA の通知(Web Push)を受けて出す。通知の中身は Lambda が送る JSON(amplify/functions/shared/push.ts の PushMessage)。
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

// 通知を受けたら出す
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  const title = message.title || "うさぽ ゲームコーナー";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: message.tag,
      renotify: Boolean(message.tag),
      data: { url: message.url || "/" },
    }),
  );
});

// 通知を押したら、開いているタブがあればそこでそのページを開き、無ければ新しく開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
