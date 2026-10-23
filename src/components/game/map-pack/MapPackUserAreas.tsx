"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Difficulty } from "@/lib/game/mapPuzzleData";
import { fetchMapPackUserAreas, mapPackPlayHref, type MapPackUserArea } from "@/lib/game/mapPackData";
import { areaLabelOf } from "@/lib/game/format";

// 地図ポットンのランキングでカードを開いたときに出す、その人のエリアごとの自己ベスト一覧。
// 合計点の内訳なので、完成させていないエリアも出す(完成したエリアには印を付ける)
export default function MapPackUserAreas({ userId, difficulty }: { userId: string; difficulty: Difficulty }) {
  const [areas, setAreas] = useState<MapPackUserArea[] | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchMapPackUserAreas(userId, difficulty)
      .then((a) => {
        if (!cancelled) setAreas(a);
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, difficulty]);

  if (errorMsg) return <p className="text-xs text-red-600">{errorMsg}</p>;
  if (!areas) return <p className="text-xs text-[#a8937a]">読み込み中...</p>;

  const clearedCount = areas.filter((a) => a.cleared).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-[#a8937a]">
        <span>
          {areas.length}エリア中 {clearedCount}エリア完成
        </span>
        <Link
          href={`/profile/${userId}?game=map-pack&level=${difficulty}`}
          className="font-semibold text-teal-700 underline underline-offset-2"
        >
          🏅 コンプリート状況 →
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-[#f3ece0]">
        {areas.map((a, i) => (
          <li key={`${a.prefCode}-${a.cityCode ?? ""}`} className="py-1.5 flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-center">{i === 0 ? "🏅" : ""}</span>
            <span className="flex-1 min-w-0 truncate text-[#3c2a14]">
              {difficulty === "beginner" ? "全国" : areaLabelOf(a)}
              {a.cleared && <span className="ml-1.5 text-[10px] font-bold text-teal-700">✓完成</span>}
            </span>
            <span className={`shrink-0 text-xs font-semibold ${i === 0 ? "text-amber-600" : "text-[#78716c]"}`}>
              {a.bestScore.toLocaleString()}点
            </span>
            <Link
              href={mapPackPlayHref(a)}
              className="shrink-0 text-[11px] font-semibold text-teal-700 border border-teal-300 rounded-full px-2 py-0.5"
            >
              ▶ 遊ぶ
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
