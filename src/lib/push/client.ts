"use client";

import { currentUser } from "@/lib/auth";
import { data, unwrap } from "@/lib/amplify/data";
import { VAPID_PUBLIC_KEY } from "./vapid";

// PWA の通知(Web Push)の購読。ブラウザで購読して、届け先(endpoint と鍵)を GamePushSubscription に保存する。
// 通知はサービスワーカー(public/sw.js)が受けて出す。サービスワーカーは本番ビルドでしか登録しないので、手元(npm run dev)では使えない

export type PushAvailability =
  /** このブラウザは通知に対応していない */
  | "unsupported"
  /** iPhone・iPad は、ホーム画面に追加したアプリからでないと通知を受け取れない */
  | "needs-install"
  /** 開発中(サービスワーカーを登録していない) */
  | "dev"
  | "ok";

export function pushAvailability(): PushAvailability {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const supported = "serviceWorker" in navigator && "Notification" in window && "PushManager" in window;
  if (!supported) return ios && !standalone ? "needs-install" : "unsupported";
  if (process.env.NODE_ENV !== "production") return "dev";
  return "ok";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
  if (!reg) throw new Error("通知の準備ができていません。ページを読み込み直してください");
  return reg;
}

/**
 * いまこのブラウザで通知を受け取る設定になっているか。ブラウザの購読があり、届け先の行(GamePushSubscription)も残っていること
 * (行は、送れなかったとき(404・410)に Lambda が消すことがある。ブラウザ側だけ見ていると「オン」に見えたまま届かなくなる)
 */
export async function isPushEnabled(): Promise<boolean> {
  if (pushAvailability() !== "ok" || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  const user = await currentUser();
  if (!user) return false;
  return Boolean(unwrap(await data.models.GamePushSubscription.get({ userId: user.id, endpoint: sub.endpoint })));
}

let synced = false;

/**
 * 通知を許可していてブラウザの購読もあるのに、届け先の行が無い(または鍵が変わった)ときに書き直す。ログインしているときにアプリを開くたびに1回呼ぶ。
 * 許可を求めたり新しく購読したりはしない(ユーザーの操作が要るので)。購読そのものが無くなっていたら、設定画面でオンにし直してもらう
 */
export async function syncPushSubscription(): Promise<void> {
  if (synced || pushAvailability() !== "ok" || Notification.permission !== "granted") return;
  synced = true;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await saveSubscription(sub);
}

/** 届け先の行を作る(同じ鍵の行があれば何もしない。鍵が変わっていれば作り直す。行は書き換えられないので消して作る) */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("通知を受け取るにはログインしてください");
  const json = sub.toJSON();
  const row = { userId: user.id, endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
  if (!row.p256dh || !row.auth) throw new Error("通知の準備に失敗しました");
  const existing = unwrap(await data.models.GamePushSubscription.get({ userId: user.id, endpoint: sub.endpoint }));
  if (existing && existing.p256dh === row.p256dh && existing.auth === row.auth) return;
  if (existing) unwrap(await data.models.GamePushSubscription.delete({ userId: user.id, endpoint: sub.endpoint }));
  unwrap(await data.models.GamePushSubscription.create(row));
}

function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** 通知を受け取るようにする(ブラウザの許可を求め、届け先を保存する)。ログインが必要 */
export async function enablePush(): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("通知を受け取るにはログインしてください");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("通知が許可されませんでした。ブラウザの設定で、このサイトの通知を許可してください");
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) }));
  // 同じブラウザで受け取り直したときは、すでに行がある
  await saveSubscription(sub);
}

/** 通知を止める(このブラウザの購読をやめ、届け先を消す) */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const user = await currentUser();
  if (user) await data.models.GamePushSubscription.delete({ userId: user.id, endpoint: sub.endpoint });
  await sub.unsubscribe();
}
