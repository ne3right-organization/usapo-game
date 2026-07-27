"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  fetchZukanCollections,
  fetchPrefectureMunicipalityCounts,
  type ZukanCollectionEntry,
  type PrefectureMunicipalityCount,
} from "@/lib/game/zukanQuizClient";
import { formatRelativeTime } from "@/lib/game/format";

type ViewState =
  | { status: "loading" }
  | { status: "needs-login" }
  | { status: "error"; message: string }
  | { status: "ready"; collections: ZukanCollectionEntry[]; prefectures: PrefectureMunicipalityCount[] };

export default function ZukanCollectionPage() {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setState({ status: "needs-login" });
        return;
      }
      try {
        const [collections, prefectures] = await Promise.all([
          fetchZukanCollections(),
          fetchPrefectureMunicipalityCounts(),
        ]);
        if (!cancelled) setState({ status: "ready", collections, prefectures });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prefStats = useMemo(() => {
    if (state.status !== "ready") return [];
    const collectedByPref = new Map<string, number>();
    for (const c of state.collections) {
      collectedByPref.set(c.prefCode, (collectedByPref.get(c.prefCode) ?? 0) + 1);
    }
    return state.prefectures
      .map((p) => ({ ...p, collected: collectedByPref.get(p.prefCode) ?? 0 }))
      .sort((a, b) => a.prefCode.localeCompare(b.prefCode));
  }, [state]);

  const totalCollected = state.status === "ready" ? state.collections.length : 0;
  const totalMunicipalities = state.status === "ready" ? state.prefectures.reduce((sum, p) => sum + p.total, 0) : 0;

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/game/zukan-quiz" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">📖 図鑑</h1>
        </div>

        {state.status === "loading" && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}

        {state.status === "needs-login" && (
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
            <p className="text-sm text-[#3c2a14] mb-3">図鑑を見るにはログインが必要です</p>
            <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
              ログインする →
            </Link>
          </div>
        )}

        {state.status === "error" && <p className="text-sm text-red-600 text-center py-6">{state.message}</p>}

        {state.status === "ready" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 text-center">
              <div className="text-[11px] text-[#a8937a] mb-1">全国コンプリート状況</div>
              <div className="text-3xl font-extrabold text-orange-600">
                {totalCollected}
                <span className="text-base font-normal text-[#a8937a]"> / {totalMunicipalities}</span>
              </div>
            </div>

            <div>
              <p className="text-xs text-[#a8937a] mb-3 tracking-widest">都道府県別コンプリート率</p>
              <div className="flex flex-col gap-2">
                {prefStats.map((p) => {
                  const pct = p.total > 0 ? Math.round((p.collected / p.total) * 100) : 0;
                  return (
                    <div key={p.prefCode} className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.06)] px-3.5 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-[#3c2a14]">{p.prefName}</span>
                        <span className="text-xs text-[#a8937a]">
                          {p.collected} / {p.total}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs text-[#a8937a] mb-3 tracking-widest">獲得済みカード</p>
              {state.collections.length === 0 ? (
                <p className="text-sm text-[#a8937a] text-center py-6">
                  まだカードがありません。クイズに挑戦してみましょう
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {state.collections.map((c) => (
                    <div
                      key={`${c.prefCode}-${c.cityCode}`}
                      className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#3c2a14] truncate">
                          {c.prefName} {c.cityName}
                        </div>
                        <p className="text-xs text-[#a8937a] mt-0.5">
                          {c.population != null ? `人口 ${c.population.toLocaleString()}人` : "人口データなし"}
                          ・正解{c.correctCount}回
                        </p>
                      </div>
                      <div className="text-[11px] text-[#a8937a] shrink-0">
                        {formatRelativeTime(c.lastAcquiredAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
