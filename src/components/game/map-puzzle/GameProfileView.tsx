"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  fetchGameProfile,
  fetchBestList,
  type GameProfilePublic,
  type BestRecord,
} from "@/lib/game/mapPuzzleData";
import { DIFFICULTY_LABELS, DIFFICULTY_BADGE_CLASS, areaLabelOf, formatRelativeTime } from "@/lib/game/format";

export interface GameProfileViewProps {
  targetUserId?: string;
}

type ViewState =
  | { status: "loading" }
  | { status: "needs-login" }
  | { status: "private" }
  | { status: "ready"; isSelf: boolean; profile: GameProfilePublic | null; bestList: BestRecord[] };

export default function GameProfileView({ targetUserId }: GameProfileViewProps) {
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

      const isSelf = !targetUserId || targetUserId === user.id;

      try {
        const profile = await fetchGameProfile(targetUserId);

        if (!isSelf && !profile?.nickname) {
          if (!cancelled) setState({ status: "private" });
          return;
        }

        const bestList = await fetchBestList(targetUserId);
        if (!cancelled) setState({ status: "ready", isSelf, profile, bestList });
      } catch {
        if (!cancelled) setState({ status: "needs-login" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  if (state.status === "loading") {
    return <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>;
  }

  if (state.status === "needs-login") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
        <p className="text-sm text-[#3c2a14] mb-3">プロフィールを見るにはログインが必要です</p>
        <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
          ログインする →
        </Link>
      </div>
    );
  }

  if (state.status === "private") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
        <p className="text-sm text-[#78716c] leading-relaxed">
          このユーザーはニックネームを登録していないため、プロフィールを閲覧できません。
        </p>
      </div>
    );
  }

  const { isSelf, profile, bestList } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-lg font-bold text-[#3c2a14]">
            {profile?.nickname ? `👤 ${profile.nickname}` : "未登録"}
          </span>
          {isSelf && (
            <Link
              href="/game/map-puzzle/nickname"
              className="text-xs text-[#78716c] underline underline-offset-2"
            >
              編集
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#f8f4ea] rounded-xl px-3 py-2.5">
            <div className="text-[11px] text-[#a8937a]">合計スコア</div>
            <div className="text-xl font-extrabold text-teal-700">
              {(profile?.totalScore ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-[#f8f4ea] rounded-xl px-3 py-2.5">
            <div className="text-[11px] text-[#a8937a]">プレイ済みエリア</div>
            <div className="text-xl font-extrabold text-teal-700">
              {(profile?.areasPlayedCount ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs text-[#a8937a] mb-3 tracking-widest">ベストスコア一覧</p>
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
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DIFFICULTY_BADGE_CLASS[b.difficulty]}`}
                    >
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
