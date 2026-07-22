"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";
import { fetchAreaRanking, type RankingEntry } from "@/lib/game/mapPuzzleData";
import RankingList from "@/components/game/map-puzzle/RankingList";

function AreaRankingContent() {
  const searchParams = useSearchParams();
  const difficulty = searchParams.get("difficulty") as Difficulty | null;
  const prefCode = searchParams.get("prefCode");
  const prefName = searchParams.get("prefName");
  const cityCode = searchParams.get("cityCode") ?? undefined;
  const cityName = searchParams.get("cityName");

  const [items, setItems] = useState<RankingEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const valid = !!difficulty && !!prefCode && !!prefName;

  useEffect(() => {
    if (!valid || !difficulty || !prefCode) return;
    let cancelled = false;
    fetchAreaRanking({ difficulty, prefCode, cityCode })
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
  }, [valid, difficulty, prefCode, cityCode]);

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor || !difficulty || !prefCode) return;
    setLoadingMore(true);
    try {
      const page = await fetchAreaRanking({ difficulty, prefCode, cityCode }, nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  if (!valid) {
    return <p className="text-sm text-red-600 text-center py-6">エリアの指定が不正です</p>;
  }

  return (
    <>
      <h1 className="text-lg font-bold text-[#3c2a14] mb-6">
        {cityName ?? prefName} のランキング
      </h1>

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
          <RankingList items={items} showArea={false} />
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
    </>
  );
}

export default function AreaRankingPage() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-2">
          <Link href="/game/map-puzzle" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
        </div>
        <Suspense fallback={<p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}>
          <AreaRankingContent />
        </Suspense>
      </div>
    </main>
  );
}
