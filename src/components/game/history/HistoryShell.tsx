"use client";

// 遊んだ履歴の各タブで共通の読み込み・ログイン案内・「もっと見る」
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

export interface HistoryPage<T> {
  items: T[];
  nextCursor: string | null;
}

export default function HistoryShell<T>({
  load,
  render,
  empty,
}: {
  load: (cursor?: string | null) => Promise<HistoryPage<T>>;
  render: (item: T) => ReactNode;
  empty: string;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    load()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message.includes("認証")) setNeedsLogin(true);
        else setErrorMsg(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await load(nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>;
  if (needsLogin) {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
        <p className="text-sm text-[#3c2a14] mb-3">遊んだ履歴を見るにはログインが必要です</p>
        <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
          ログインする →
        </Link>
      </div>
    );
  }
  if (errorMsg) return <p className="text-sm text-red-600 text-center py-6">{errorMsg}</p>;
  if (!items.length) return <p className="text-sm text-[#a8937a] text-center py-10">{empty}</p>;

  return (
    <div className="flex flex-col gap-3">
      {items.map(render)}
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
  );
}
