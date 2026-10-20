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
}: RankingListProps) {
  if (items.length === 0) {
    return <p className="text-sm text-[#a8937a] text-center py-10">まだ記録がありません</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const row = (
          <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 flex items-center gap-3">
            <span className="w-7 text-center text-lg font-bold text-[#a8937a] shrink-0">{rankBadge(i)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#3c2a14] truncate">
                {item.nickname ? `👤 ${item.nickname}` : "未登録"}
              </div>
              {showArea && <div className="text-xs text-[#a8937a] truncate">{areaLabelOf(item)}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-extrabold text-amber-600">
                {item.bestScore.toLocaleString()}
                <span className="text-xs font-normal text-[#a8937a]">pt</span>
              </div>
              <div className="text-[11px] text-[#a8937a]">{formatRelativeTime(item.lastPlayedAt)}</div>
            </div>
            {playLinks && !(item.nickname && profileBasePath) && (
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

        return item.nickname && profileBasePath ? (
          <Link key={`${item.userId}-${i}`} href={`${profileBasePath}/${item.userId}`}>
            {row}
          </Link>
        ) : (
          <div key={`${item.userId}-${i}`}>{row}</div>
        );
      })}
    </div>
  );
}
