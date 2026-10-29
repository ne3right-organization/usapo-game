"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchFollowList, type FollowUser } from "@/lib/game/followData";
import { fetchTaneShareViewerIds, setTaneShare } from "@/lib/game/chizuTaneData";
import { formatRelativeTime } from "@/lib/game/format";
import { currentUser } from "@/lib/auth";

type Tab = "followers" | "following";
type Props = { searchParams: Promise<{ tab?: string }> };

// 自分のフォロワー・自分がフォローしている人の一覧。他の人のフォロー関係は見られない(RLS)。
// フォロワーには、うさぽ農園を見せるかどうかを一人ずつ選べる(はじめは見せない。畑の場所で生活圏が分かってしまうため)
export default function FollowsPage({ searchParams }: Props) {
  const { tab: initialTab } = use(searchParams);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab === "following" ? "following" : "followers");
  const [items, setItems] = useState<FollowUser[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // うさぽ農園を見せているフォロワー
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());
  const [sharingBusy, setSharingBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // タブを切り替えるたびに前の一覧を消してから読み直す
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(null);
    setErrorMsg("");
    (async () => {
      const user = await currentUser();
      if (!user) {
        if (!cancelled) setNeedsLogin(true);
        return;
      }
      try {
        const [list, shared] = await Promise.all([fetchFollowList(tab), tab === "followers" ? fetchTaneShareViewerIds() : Promise.resolve(new Set<string>())]);
        if (cancelled) return;
        setItems(list);
        setSharedIds(shared);
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const toggleShare = async (viewerId: string) => {
    if (sharingBusy) return;
    const next = !sharedIds.has(viewerId);
    setSharingBusy(viewerId);
    setErrorMsg("");
    try {
      await setTaneShare(viewerId, next);
      setSharedIds((cur) => {
        const s = new Set(cur);
        if (next) s.add(viewerId);
        else s.delete(viewerId);
        return s;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSharingBusy(null);
    }
  };

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
            {!errorMsg && items && items.length > 0 && tab === "followers" && (
              <p className="text-xs text-[#a8937a] leading-relaxed mb-3">
                🌱 うさぽ農園は、「見せる」にしたフォロワーにだけ、あなたがタネをまいた畑（実の生産者）が分かるようになります。はじめは誰にも見せていません。
              </p>
            )}
            {items && items.length > 0 && (
              <div className="flex flex-col gap-2">
                {items.map((u) => {
                  const shared = sharedIds.has(u.userId);
                  const name = (
                    <span className="text-sm font-semibold text-[#3c2a14] truncate">{u.nickname ? `👤 ${u.nickname}` : "ニックネーム未設定"}</span>
                  );
                  return (
                    <div
                      key={u.userId}
                      className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 flex items-center justify-between gap-3"
                    >
                      {/* ニックネームを消した人はプロフィールが非公開なのでリンクにしない */}
                      {u.nickname ? (
                        <Link href={`/profile/${u.userId}`} className="min-w-0 truncate">
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-[#a8937a]">{formatRelativeTime(u.followedAt)}</span>
                        {tab === "followers" && (
                          <button
                            type="button"
                            onClick={() => toggleShare(u.userId)}
                            disabled={sharingBusy !== null}
                            aria-pressed={shared}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border disabled:opacity-60 ${
                              shared ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-[#78716c] border-gray-300"
                            }`}
                          >
                            {sharingBusy === u.userId ? "…" : shared ? "🌱 農園を見せている" : "🌱 農園を見せない"}
                          </button>
                        )}
                      </span>
                    </div>
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
