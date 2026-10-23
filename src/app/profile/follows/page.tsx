"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchFollowList, type FollowUser } from "@/lib/game/followData";
import { formatRelativeTime } from "@/lib/game/format";

type Tab = "followers" | "following";
type Props = { searchParams: Promise<{ tab?: string }> };

// 自分のフォロワー・自分がフォローしている人の一覧。他の人のフォロー関係は見られない(RLS)
export default function FollowsPage({ searchParams }: Props) {
  const { tab: initialTab } = use(searchParams);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab === "following" ? "following" : "followers");
  const [items, setItems] = useState<FollowUser[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    // タブを切り替えるたびに前の一覧を消してから読み直す
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(null);
    setErrorMsg("");
    (async () => {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (!user) {
        if (!cancelled) setNeedsLogin(true);
        return;
      }
      try {
        const list = await fetchFollowList(tab);
        if (!cancelled) setItems(list);
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const selectTab = (t: Tab) => {
    setTab(t);
    router.replace(`?tab=${t}`, { scroll: false });
  };

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-5">
          <Link href="/profile" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">フォロー</h1>
        </div>

        {needsLogin ? (
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
            <p className="text-sm text-[#3c2a14] mb-3">フォローを見るにはログインが必要です</p>
            <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
              ログインする →
            </Link>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              {(["followers", "following"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => selectTab(t)}
                  className={`flex-1 text-sm font-semibold rounded-xl py-2 transition-colors ${
                    tab === t ? "bg-teal-700 text-white" : "bg-white text-[#78716c] border border-gray-200"
                  }`}
                >
                  {t === "followers" ? "フォロワー" : "フォロー中"}
                </button>
              ))}
            </div>

            {errorMsg && <p className="text-sm text-red-600 text-center py-6">{errorMsg}</p>}
            {!errorMsg && !items && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}
            {!errorMsg && items && items.length === 0 && (
              <p className="text-sm text-[#a8937a] text-center py-10">
                {tab === "followers" ? "まだフォロワーはいません" : "まだ誰もフォローしていません"}
              </p>
            )}
            {!errorMsg && items && items.length > 0 && (
              <div className="flex flex-col gap-2">
                {items.map((u) => {
                  const row = (
                    <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[#3c2a14] truncate">
                        {u.nickname ? `👤 ${u.nickname}` : "ニックネーム未登録"}
                      </span>
                      <span className="shrink-0 text-[11px] text-[#a8937a]">{formatRelativeTime(u.followedAt)}</span>
                    </div>
                  );
                  // ニックネームを消した人はプロフィールが非公開なのでリンクにしない
                  return u.nickname ? (
                    <Link key={u.userId} href={`/profile/${u.userId}`}>
                      {row}
                    </Link>
                  ) : (
                    <div key={u.userId}>{row}</div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
