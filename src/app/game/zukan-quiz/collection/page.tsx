"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  fetchZukanCollections,
  fetchGeometriesForCollections,
  type ZukanCollectionEntry,
  type GeoJsonGeometry,
} from "@/lib/game/zukanQuizClient";
import ZukanCardGrid from "@/components/game/zukan-quiz/ZukanCardGrid";

type ViewState =
  | { status: "loading" }
  | { status: "needs-login" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      collections: ZukanCollectionEntry[];
      geometries: Map<string, GeoJsonGeometry>;
    };

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
        const collections = await fetchZukanCollections();
        const geometries = await fetchGeometriesForCollections(collections);

        if (!cancelled) setState({ status: "ready", collections, geometries });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalCollected = state.status === "ready" ? state.collections.length : 0;

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
              <div className="text-[11px] text-[#a8937a] mb-1">獲得済みカード</div>
              <div className="text-3xl font-extrabold text-orange-600">{totalCollected}</div>
            </div>

            <div>
              {state.collections.length === 0 ? (
                <p className="text-sm text-[#a8937a] text-center py-6">
                  まだカードがありません。クイズに挑戦してみましょう
                </p>
              ) : (
                <ZukanCardGrid
                  collections={state.collections}
                  geometries={state.geometries}
                  hrefFor={(c) => `/game/zukan-quiz/collection/${c.prefCode}/${c.cityCode}`}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
