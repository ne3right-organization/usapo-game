"use client";

import { currentUser } from "@/lib/auth";
import { data, unwrap, type Schema } from "@/lib/amplify/data";

// 届いた通知の一覧(GameNotification)。通知を送る Lambda が残し、最新の1日分だけ取っておく(古いものは DynamoDB の TTL で消える)。
// どこまで見たかは端末ごとに覚えておき(localStorage)、ヘッダーのベルに「新しい通知がある」印を出す

export type NoticeRecord = Schema["GameNotification"]["type"];

const KEEP_MS = 24 * 3_600_000;
const SEEN_KEY = "usapo-notices-seen-at";

/** 最新の1日分の通知(新しい順)。TTL で消えるまで少しかかるので、1日より古いものはここでも外す。未ログインなら空 */
export async function fetchMyNotices(): Promise<NoticeRecord[]> {
  const user = await currentUser();
  if (!user) return [];
  const since = new Date(Date.now() - KEEP_MS).toISOString();
  const items: NoticeRecord[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameNotification.list({ userId: user.id, sortDirection: "DESC", nextToken });
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items.filter((n) => n.notifiedAt >= since).sort((a, b) => b.notifiedAt.localeCompare(a.notifiedAt));
}

/** この端末で最後に通知の一覧を見た日時 */
export function noticesSeenAt(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function markNoticesSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    // 覚えておけなくても一覧は見られる
  }
}

/** まだ見ていない通知があるか */
export async function hasUnseenNotices(): Promise<boolean> {
  const seen = noticesSeenAt();
  const notices = await fetchMyNotices();
  return notices.some((n) => n.notifiedAt > seen);
}
