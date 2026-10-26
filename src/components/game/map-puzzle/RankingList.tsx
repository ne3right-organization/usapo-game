"use client";

import { useState } from "react";
import Link from "next/link";
import type { RankingEntry } from "@/lib/game/mapPuzzleData";
import { areaLabelOf, formatRelativeTime } from "@/lib/game/format";

export interface RankingListProps {
  items: RankingEntry[];
  showArea?: boolean;
  /** 行をタップしたときのプロフィールページ。null ならリンクにしない(プロフィールページが無いゲーム用) */
  profileBasePath?: string | null;
  /** 渡すと各行の右端に、そのエリアを遊ぶリンクを縦に並べて出す(行がプロフィールへのリンクでない場合のみ) */
  playLinks?: (item: RankingEntry) => { label: string; href: string }[];
  /** 渡すと行をタップで開閉できるようにし、開いたときにその下へ出す(プロフィールへのリンク・playLinks より優先) */
  renderExpanded?: (item: RankingEntry) => React.ReactNode;
}

function rankBadge(index: number): string {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return String(index + 1);
}

export default function RankingList({
  items,
  showArea = true,
  profileBasePath = "/game/map-puzzle/profile",
  playLinks,
  renderExpanded,
}: RankingListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="text-sm text-[#a8937a] text-center py-10">まだ記録がありません</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const key = `${item.userId}-${i}`;
        const expanded = renderExpanded != null && expandedKey === key;
        const row = (
          <div className="p-3.5 flex items-center gap-3">
            <span className="w-7 text-center text-lg font-bold text-[#a8937a] shrink-0">{rankBadge(i)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#3c2a14] truncate">
                {item.nickname ? `👤 ${item.nickname}` : "未設定"}
              </div>
              {showArea && <div className="text-xs text-[#a8937a] truncate">{item.detail ?? areaLabelOf(item)}</div>}
            </div>
            <div className="text-right shrink-0">
              {item.scoreCaption && <div className="text-[10px] text-[#a8937a] leading-none">{item.scoreCaption}</div>}
              <div className="text-lg font-extrabold text-amber-600">
                {item.bestScore.toLocaleString()}
                <span className="text-xs font-normal text-[#a8937a]">pt</span>
              </div>
              <div className="text-[11px] text-[#a8937a]">{formatRelativeTime(item.lastPlayedAt)}</div>
            </div>
            {renderExpanded && <span className="shrink-0 text-[#c8b8a0] text-sm">{expanded ? "▲" : "▼"}</span>}
            {!renderExpanded && playLinks && !(item.nickname && profileBasePath) && (
              <div className="shrink-0 flex flex-col items-stretch gap-1">
                {playLinks(item).map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-center text-[11px] font-semibold text-teal-700 border border-teal-300 rounded-full px-2.5 py-0.5"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
        const cardClass = "bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)]";

        if (renderExpanded) {
          return (
            <div key={key} className={cardClass}>
              <button
                type="button"
                className="block w-full text-left"
                aria-expanded={expanded}
                onClick={() => setExpandedKey(expanded ? null : key)}
              >
                {row}
              </button>
              {expanded && <div className="border-t border-[#f3ece0] px-3.5 py-3">{renderExpanded(item)}</div>}
            </div>
          );
        }

        return item.nickname && profileBasePath ? (
          <Link key={key} href={`${profileBasePath}/${item.userId}`} className={`block ${cardClass}`}>
            {row}
          </Link>
        ) : (
          <div key={key} className={cardClass}>
            {row}
          </div>
        );
      })}
    </div>
  );
}
