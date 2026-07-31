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
import { fetchGameProfile, type GameProfilePublic } from "@/lib/game/mapPuzzleData";
import ZukanCardGrid from "@/components/game/zukan-quiz/ZukanCardGrid";

interface Props {
  targetUserId: string;
}

type ViewState =
  | { status: "loading" }
  | { status: "needs-login" }
  | { status: "private" }
  | {
      status: "ready";
      profile: GameProfilePublic | null;
      collections: ZukanCollectionEntry[];
      geometries: Map<string, GeoJsonGeometry>;
    };

// 他ユーザーの公開図鑑(nickname登録済みユーザーのみ閲覧可、地図パズルのGameProfileViewと
// 同じ「非公開」の扱い)。カードを開くとコメント閲覧のみ可能(投稿は本人の図鑑からのみ)
export default function ZukanPublicCollectionView({ targetUserId }: Props) {
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

      const profile = await fetchGameProfile(targetUserId);
      if (targetUserId !== user.id && !profile?.nickname) {
        if (!cancelled) setState({ status: "private" });
        return;
      }

      const collections = await fetchZukanCollections(targetUserId);
      const geometries = await fetchGeometriesForCollections(collections);
      if (!cancelled) setState({ status: "ready", profile, collections, geometries });
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
        <p className="text-sm text-[#3c2a14] mb-3">図鑑を見るにはログインが必要です</p>
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
          このユーザーはニックネームを登録していないため、図鑑を閲覧できません。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <span className="text-base font-bold text-[#3c2a14]">
          {state.profile?.nickname ? `👤 ${state.profile.nickname}` : "未登録"} の図鑑
        </span>
        <p className="text-xs text-[#a8937a] mt-1">獲得済みカード {state.collections.length}枚</p>
      </div>

      {state.collections.length === 0 ? (
        <p className="text-sm text-[#a8937a] text-center py-6">まだカードがありません</p>
      ) : (
        <ZukanCardGrid
          collections={state.collections}
          geometries={state.geometries}
          hrefFor={(c) => `/game/zukan-quiz/profile/${targetUserId}/${c.prefCode}/${c.cityCode}`}
        />
      )}
    </div>
  );
}
