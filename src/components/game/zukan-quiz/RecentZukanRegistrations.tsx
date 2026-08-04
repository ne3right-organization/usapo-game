"use client";

import { useEffect, useState } from "react";
import { fetchRecentZukanRegistrations, type RecentZukanRegistration } from "@/lib/game/zukanQuizClient";
import { formatRelativeTime } from "@/lib/game/format";

// トップページ上部に「最近図鑑に登録された自治体」を表示する。誰が獲得したかは示さない
// (獲得者を一切特定しない集計RPC経由)。むずかしいはトリビア登録の有無を問わず出題される
// ため、ここに出た自治体をきっかけにトリビア登録・ヒント提案を促す狙い
export default function RecentZukanRegistrations() {
  const [items, setItems] = useState<RecentZukanRegistration[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentZukanRegistrations(8)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">最近図鑑に登録された市区町村</h2>
      <div className="bg-white rounded-2xl border border-orange-100 p-4 flex flex-col gap-1.5">
        {items.map((item) => (
          <div key={`${item.prefCode}-${item.cityCode}`} className="flex items-center justify-between text-sm">
            <span className="text-[#3c2a14]">
              {item.prefName} {item.cityName}
            </span>
            <span className="text-[11px] text-[#a8937a] shrink-0 ml-3">{formatRelativeTime(item.lastAcquiredAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
