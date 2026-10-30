"use client";

import { useEffect, useState } from "react";
import { fetchBestList, fetchGameProfile, type BestRecord, type GameProfilePublic } from "@/lib/game/mapPuzzleData";
import { DIFFICULTY_BADGE_CLASS, DIFFICULTY_LABELS, areaLabelOf, formatRelativeTime } from "@/lib/game/format";

// プロフィールで地図パズルを選んだときに出す、合計スコア・遊んだエリア数とベストスコアの一覧。
// もとは地図パズルのマイプロフィール(/game/map-puzzle/profile)にあったもの
export default function MapPuzzleScores({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<GameProfilePublic | null>(null);
  const [bestList, setBestList] = useState<BestRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchGameProfile(userId), fetchBestList(userId)])
      .then(([p, list]) => {
        if (cancelled) return;
        setProfile(p);
        setBestList(list);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (error) return <p className="text-sm text-red-600 text-center py-4">{error}</p>;
  if (!bestList) return <p className="text-sm text-[#a8937a] text-center py-4">読み込み中...</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] px-3 py-2.5">
          <div className="text-[11px] text-[#a8937a]">合計スコア</div>
          <div className="text-xl font-extrabold text-teal-700">{(profile?.totalScore ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] px-3 py-2.5">
          <div className="text-[11px] text-[#a8937a]">遊んだエリア</div>
          <div className="text-xl font-extrabold text-teal-700">{(profile?.areasPlayedCount ?? 0).toLocaleString()}</div>
        </div>
      </div>

      <div>
        <p className="text-xs text-[#a8937a] mb-2 tracking-widest">ベストスコア一覧</p>
        {bestList.length === 0 ? (
          <p className="text-sm text-[#a8937a] text-center py-6">まだ記録がありません</p>
        ) : (
          <div className="flex flex-col gap-2">
            {bestList.map((b, i) => (
              <div
                key={`${b.difficulty}-${b.prefCode}-${b.cityCode ?? ""}-${i}`}
                className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DIFFICULTY_BADGE_CLASS[b.difficulty]}`}>
                      {DIFFICULTY_LABELS[b.difficulty]}
                    </span>
                    <span className="text-sm font-semibold text-[#3c2a14] truncate">{areaLabelOf(b)}</span>
                  </div>
                  <p className="text-xs text-[#a8937a]">挑戦回数 {b.playCount}回</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-extrabold text-amber-600">
                    {b.bestScore.toLocaleString()}
                    <span className="text-xs font-normal text-[#a8937a]">pt</span>
                  </div>
                  <div className="text-[11px] text-[#a8937a]">{formatRelativeTime(b.lastPlayedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
