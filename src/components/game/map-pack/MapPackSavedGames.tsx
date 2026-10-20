"use client";

// 地図ポットンのトップに出す「中断中のゲーム」一覧。中断したエリアを覚えていなくても、ここから続きに戻れる
// (試遊で「中断したが、どの自治体だったか覚えていない」と指摘されたため)

import { useEffect, useState } from "react";
import Link from "next/link";
import { areaLabelOf, formatRelativeTime } from "@/lib/game/format";
import { fetchMapPackSavedGames, mapPackPlayHref, type MapPackSavedGame } from "@/lib/game/mapPackData";

const LEVEL_TITLES = {
  beginner: "都道府県ポットン",
  intermediate: "自治体ポットン",
  advanced: "ご近所ポットン",
} as const;

export default function MapPackSavedGames() {
  const [games, setGames] = useState<MapPackSavedGame[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchMapPackSavedGames()
      .then((list) => {
        if (!cancelled) setGames(list);
      })
      .catch(() => {
        // 読めなければ一覧を出さないだけ(ゲーム自体は遊べる)
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!games.length) return null;

  return (
    <section className="mb-8">
      <p className="text-xs text-[#a8937a] mb-2 text-center tracking-widest">中断中のゲーム</p>
      <div className="flex flex-col gap-2">
        {games.map((g) => (
          <Link
            key={`${g.area.difficulty}:${g.area.prefCode}:${g.area.cityCode ?? ""}`}
            href={mapPackPlayHref(g.area)}
            className="bg-white rounded-xl border border-sky-100 hover:border-sky-300 shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 flex items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[#a8937a]">{LEVEL_TITLES[g.area.difficulty]}</div>
              <div className="text-sm font-semibold text-[#3c2a14] truncate">
                {g.area.difficulty === "beginner" ? "日本" : areaLabelOf(g.area)}
              </div>
              <div className="text-[11px] text-[#a8937a]">
                {formatRelativeTime(new Date(g.savedAt).toISOString())}に中断・{g.dropped}個落とした
                {g.source === "session" && "（このタブのみ）"}
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold text-sky-700 border border-sky-300 rounded-full px-2.5 py-1">
              ▶ 続きから
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
