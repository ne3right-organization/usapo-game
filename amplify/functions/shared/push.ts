import webpush from "web-push";
import type { DataClient } from "./dataClient";
import { unwrap } from "./dataClient";
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "../../../src/lib/push/vapid";

// PWA の通知(Web Push)を送る。送り先はブラウザごとの購読(GamePushSubscription)。
// 秘密鍵は Amplify のシークレット VAPID_PRIVATE_KEY(関数の resource.ts で渡す)。通知は「おまけ」なので、
// 送れなくても本来の処理(チェックイン・記録など)は失敗させない。期限切れの購読(404・410)は消す

export interface PushMessage {
  title: string;
  body: string;
  /** 通知を押したときに開くページ */
  url: string;
  /** 同じ tag の通知は、新しいものが古いものを置き換える(同じことが続いたときに通知がたまらないように) */
  tag?: string;
}

/** 通知を送るのに待つ長さの上限。これを過ぎたら待たずに本来の処理を返す */
const SEND_TIMEOUT_MS = 3000;

let configured: boolean | null = null;

function configure(): boolean {
  if (configured !== null) return configured;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = Boolean(privateKey);
  if (privateKey) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  else console.warn("VAPID_PRIVATE_KEY が無いので通知を送りません");
  return configured;
}

async function sendToUser(c: DataClient, userId: string, message: PushMessage): Promise<void> {
  const subs = unwrap(await c.models.GamePushSubscription.list({ userId }));
  const payload = JSON.stringify(message);
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 購読が取り消された・期限が切れた
        if (status === 404 || status === 410) await c.models.GamePushSubscription.delete({ userId, endpoint: s.endpoint });
        else console.warn("通知を送れませんでした", status, err);
      }
    })
  );
}

/** 何人かに同じ通知を送る(送れなくてもエラーにしない。時間がかかりすぎたら待たずに戻る) */
export async function notifyUsers(c: DataClient, userIds: string[], message: PushMessage): Promise<void> {
  if (userIds.length === 0 || !configure()) return;
  const sending = Promise.allSettled([...new Set(userIds)].map((id) => sendToUser(c, id, message)));
  await Promise.race([sending, new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS))]);
}

/** その人をフォローしている人(フォロワー)の ID を全部 */
export async function followerIdsOf(c: DataClient, userId: string): Promise<string[]> {
  const ids: string[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameFollow.listFollowersByUser({ followeeId: userId }, { nextToken });
    ids.push(...unwrap(page).map((f) => f.followerId));
    nextToken = page.nextToken;
  } while (nextToken);
  return ids;
}
