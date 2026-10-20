"use client";

// 各ゲームのトップに出す「最近クリアされたエリア」。誰がクリアしたかは出さない(ユーザーを特定しない集計RPC経由)。
// 行を押すと、そのエリアのプレイ画面に直接飛ぶ

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchRecentClears, type RecentClear } from "@/lib/game/recentClears";
import { mapPackPlayHref, mapPuzzlePlayHref, type PlayArea } from "@/lib/game/playLinks";
import { areaLabelOf, formatRelativeTime } from "@/lib/game/format";

const GAMES = {
  "map-puzzle": {
    href: mapPuzzlePlayHref,
    levels: { beginner: "都道府県パズル", intermediate: "市区町村パズル", advanced: "町丁パズル" },
  },
  "map-pack": {
    href: mapPackPlayHref,
    levels: { beginner: "都道府県ポットン", intermediate: "自治体ポットン", advanced: "ご近所ポットン" },
  },
} as const;

const areaText = (a: PlayArea) => (a.difficulty === "beginner" ? "日本" : areaLabelOf(a));

export default function RecentClears({ game }: { game: keyof typeof GAMES }) {
  const [items, setItems] = useState<RecentClear[] | null>(null);
  const { href, levels } = GAMES[game];

  useEffect(() => {
    let cancelled = false;
    fetchRecentClears(game, 8)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]); // 読めなければ一覧を出さないだけ
      });
    return () => {
      cancelled = true;
    };
  }, [game]);

  if (!items || items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">最近クリアされたエリア</h2>
      <div className="bg-white rounded-2xl border border-amber-100 p-2 flex flex-col">
        {items.map((item) => (
          <Link
            key={`${item.difficulty}:${item.prefCode}:${item.cityCode ?? ""}`}
            href={href(item)}
            className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-amber-50"
          >
            <span className="text-[10px] text-[#a8937a] shrink-0 w-24 truncate">{levels[item.difficulty]}</span>
            <span className="text-[#3c2a14] truncate flex-1">{areaText(item)}</span>
            <span className="text-[11px] text-[#a8937a] shrink-0">{formatRelativeTime(item.lastClearedAt)}</span>
            <span className="text-teal-700 text-xs shrink-0">▶</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
