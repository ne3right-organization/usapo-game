"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchChallengeHistory, type ChallengeRecord } from "@/lib/game/mapPuzzleData";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_BADGE_CLASS,
  areaLabelOf,
  formatRelativeTime,
  formatDuration,
} from "@/lib/game/format";

export default function HistoryPage() {
  const [items, setItems] = useState<ChallengeRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchChallengeHistory()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message.includes("認証")) {
          setNeedsLogin(true);
        } else {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchChallengeHistory(nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/game/map-puzzle" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">📜 プレイ履歴</h1>
        </div>

        {loading && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}

        {!loading && needsLogin && (
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
            <p className="text-sm text-[#3c2a14] mb-3">プレイ履歴を見るにはログインが必要です</p>
            <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
              ログインする →
            </Link>
          </div>
        )}

        {!loading && !needsLogin && errorMsg && (
          <p className="text-sm text-red-600 text-center py-6">{errorMsg}</p>
        )}

        {!loading && !needsLogin && !errorMsg && items.length === 0 && (
          <p className="text-sm text-[#a8937a] text-center py-10">
            まだプレイ履歴がありません。パズルに挑戦してみましょう
          </p>
        )}

        {!loading && !needsLogin && items.length > 0 && (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DIFFICULTY_BADGE_CLASS[item.difficulty]}`}
                    >
                      {DIFFICULTY_LABELS[item.difficulty]}
                    </span>
                    <span className="text-sm font-semibold text-[#3c2a14] truncate">
                      {areaLabelOf(item)}
                    </span>
                    {item.isNewBest && (
                      <span className="text-[10px] font-bold text-amber-600 shrink-0">✨自己ベスト</span>
                    )}
                  </div>
                  <span className="text-xs text-[#a8937a] shrink-0">{formatRelativeTime(item.playedAt)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-amber-600">
                    {item.score.toLocaleString()}
                    <span className="text-xs font-normal text-[#a8937a] ml-1">pt</span>
                  </span>
                  <span className="text-xs text-[#78716c]">
                    {formatDuration(item.elapsedSeconds)}｜ミス{item.missCount}｜{item.totalPieces}ピース
                  </span>
                </div>
                {item.comment && (
                  <p className="text-xs text-[#78716c] mt-2 border-t border-gray-100 pt-2 leading-relaxed">
                    {item.comment}
                  </p>
                )}
              </div>
            ))}

            {nextCursor && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-sm text-teal-700 underline underline-offset-2 disabled:opacity-60 py-3"
              >
                {loadingMore ? "読み込み中..." : "もっと見る"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
