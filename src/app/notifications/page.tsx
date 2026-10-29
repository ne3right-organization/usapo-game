"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { fetchMyNotices, markNoticesSeen, noticesSeenAt, type NoticeRecord } from "@/lib/notificationsData";
import { formatRelativeTime } from "@/lib/game/format";

// 届いた通知の一覧(最新の1日分)。端末で通知を受け取っていなくても、ここで見られる
export default function NotificationsPage() {
  const [state, setState] = useState<
    { status: "loading" } | { status: "signed-out" } | { status: "error"; message: string } | { status: "ready"; notices: NoticeRecord[]; seenAt: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await currentUser())) {
        if (!cancelled) setState({ status: "signed-out" });
        return;
      }
      try {
        const notices = await fetchMyNotices();
        if (cancelled) return;
        // 新しく届いたものに印を付けるため、見た日時は読み終えてから更新する
        setState({ status: "ready", notices, seenAt: noticesSeenAt() });
        markNoticesSeen();
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="shrink-0 text-lg font-bold text-[#3c2a14]">🔔 通知</h1>
          <p className="text-xs text-[#a8937a] leading-snug">最新の1日分を表示しています。それより古い通知は消えます</p>
        </div>

        {state.status === "loading" && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}
        {state.status === "signed-out" && <p className="text-sm text-[#78716c] text-center py-10">通知を見るには、右上の「ログイン」からログインしてください</p>}
        {state.status === "error" && <p className="text-sm text-red-600 text-center py-10">{state.message}</p>}
        {state.status === "ready" && state.notices.length === 0 && (
          <p className="text-sm text-[#a8937a] text-center py-10">この1日に届いた通知はありません</p>
        )}
        {state.status === "ready" && state.notices.length > 0 && (
          <ul className="flex flex-col gap-2">
            {state.notices.map((n) => {
              const unseen = n.notifiedAt > state.seenAt;
              return (
                <li key={n.noticeId}>
                  <Link
                    href={n.url}
                    className={`block bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 border-l-4 ${
                      unseen ? "border-teal-600" : "border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#3c2a14] truncate">{n.title}</span>
                      <span className="shrink-0 text-[11px] text-[#a8937a]">{formatRelativeTime(n.notifiedAt)}</span>
                    </div>
                    <p className="text-xs text-[#78716c] mt-1 leading-relaxed">{n.body}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-[#a8937a] text-center mt-6">
          端末に通知を届けるかどうかは <Link href="/nickname" className="underline underline-offset-2">⚙️ 設定</Link> で選べます
        </p>
      </div>
    </main>
  );
}
