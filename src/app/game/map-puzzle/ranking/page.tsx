"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";
import { fetchModeRanking, type RankingEntry } from "@/lib/game/mapPuzzleData";
import { DIFFICULTY_LABELS } from "@/lib/game/format";
import RankingList from "@/components/game/map-puzzle/RankingList";

const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

export default function RankingPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [items, setItems] = useState<RankingEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    // タブ切り替え(difficulty変更)のたびに前回の表示をリセットしてから取得し直す
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setErrorMsg("");
    fetchModeRanking(difficulty)
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
  }, [difficulty]);

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchModeRanking(difficulty, nextCursor);
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
          <h1 className="text-lg font-bold text-[#3c2a14]">🏆 ランキング</h1>
        </div>

        <div className="flex gap-2 mb-5">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              className={`flex-1 text-sm font-semibold rounded-xl py-2 transition-colors ${
                difficulty === d
                  ? "bg-teal-700 text-white"
                  : "bg-white text-[#78716c] border border-gray-200"
              }`}
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}

        {!loading && needsLogin && (
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
            <p className="text-sm text-[#3c2a14] mb-3">ランキングを見るにはログインが必要です</p>
            <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
              ログインする →
            </Link>
          </div>
        )}

        {!loading && !needsLogin && errorMsg && (
          <p className="text-sm text-red-600 text-center py-6">{errorMsg}</p>
        )}

        {!loading && !needsLogin && !errorMsg && (
          <>
            <RankingList items={items} showArea />
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
          </>
        )}
      </div>
    </main>
  );
}
