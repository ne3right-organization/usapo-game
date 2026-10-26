"use client";

// 全ゲーム共通の「遊んだ履歴」。もとは地図パズル専用(/game/map-puzzle/history)だったものをサイトのトップから
// 開けるように移し、地図ポットン・図鑑クイズも見られるようにした。?game= で最初に開くタブを指定できる

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import HistoryShell from "@/components/game/history/HistoryShell";
import { fetchChallengeHistory, type ChallengeRecord } from "@/lib/game/mapPuzzleData";
import { fetchMapPackHistory, type MapPackHistoryRecord } from "@/lib/game/mapPackData";
import { fetchZukanCollections, type ZukanCollectionEntry } from "@/lib/game/zukanQuizClient";
import { ZUKAN_DIFFICULTY_META } from "@/lib/game/zukanQuizDifficulty";
import { mapPackPlayHref, mapPuzzlePlayHref } from "@/lib/game/playLinks";
import {
  DIFFICULTY_BADGE_CLASS,
  DIFFICULTY_LABELS,
  areaLabelOf,
  formatDuration,
  formatRelativeTime,
} from "@/lib/game/format";
import { currentUser } from "@/lib/auth";

const TABS = [
  { id: "map-puzzle", label: "🗺️ 地図パズル" },
  { id: "map-pack", label: "📦 地図ポットン" },
  { id: "zukan-quiz", label: "📖 図鑑クイズ" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const MAP_PACK_LEVELS = { beginner: "都道府県ポットン", intermediate: "自治体ポットン", advanced: "ご近所ポットン" } as const;

const card = "bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4";
const areaText = (a: { difficulty: string; prefName: string; cityName?: string }) =>
  a.difficulty === "beginner" ? "全国" : areaLabelOf(a);

function MapPuzzleItem({ item }: { item: ChallengeRecord }) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DIFFICULTY_BADGE_CLASS[item.difficulty]}`}>
            {DIFFICULTY_LABELS[item.difficulty]}
          </span>
          <span className="text-sm font-semibold text-[#3c2a14] truncate">{areaText(item)}</span>
          {item.isNewBest && <span className="text-[10px] font-bold text-amber-600 shrink-0">✨自己ベスト</span>}
        </div>
        <span className="text-xs text-[#a8937a] shrink-0">{formatRelativeTime(item.playedAt)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-extrabold text-amber-600">
          {item.score.toLocaleString()}
          <span className="text-xs font-normal text-[#a8937a] ml-1">pt</span>
        </span>
        <span className="text-xs text-[#78716c]">
          {formatDuration(item.elapsedSeconds)}｜ミス{item.missCount}｜{item.totalPieces}ピース
        </span>
      </div>
      {item.comment && (
        <p className="text-xs text-[#78716c] mt-2 border-t border-gray-100 pt-2 leading-relaxed">{item.comment}</p>
      )}
      <Link href={mapPuzzlePlayHref(item)} className="inline-block mt-2 text-xs text-teal-700 underline underline-offset-2">
        ▶ もう一度遊ぶ
      </Link>
    </div>
  );
}

function MapPackItem({ item }: { item: MapPackHistoryRecord }) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DIFFICULTY_BADGE_CLASS[item.difficulty]}`}>
            {MAP_PACK_LEVELS[item.difficulty]}
          </span>
          <span className="text-sm font-semibold text-[#3c2a14] truncate">{areaText(item)}</span>
          {item.isNewBest && <span className="text-[10px] font-bold text-amber-600 shrink-0">✨自己ベスト</span>}
        </div>
        <span className="text-xs text-[#a8937a] shrink-0">{formatRelativeTime(item.playedAt)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-extrabold text-amber-600">
          {item.score.toLocaleString()}
          <span className="text-xs font-normal text-[#a8937a] ml-1">点</span>
        </span>
        <span className="text-xs text-[#78716c]">
          {item.cleared ? "🎉完成" : "🏳️あきらめ"}｜{formatDuration(item.elapsedSeconds)}｜積み直し{item.restackCount}回｜
          {item.totalPieces}ピース
        </span>
      </div>
      <Link href={mapPackPlayHref(item)} className="inline-block mt-2 text-xs text-teal-700 underline underline-offset-2">
        ▶ もう一度遊ぶ
      </Link>
    </div>
  );
}

function ZukanItem({ item }: { item: ZukanCollectionEntry }) {
  return (
    <Link href={`/game/zukan-quiz/collection/${item.prefCode}/${item.cityCode}`} className={`${card} block`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#3c2a14] truncate">
            {item.prefName} {item.cityName}
          </div>
          <div className="text-xs text-[#78716c]">
            図鑑に登録｜最高 {ZUKAN_DIFFICULTY_META[item.bestDifficulty].label}｜正解 {item.correctCount}回
          </div>
        </div>
        <span className="text-xs text-[#a8937a] shrink-0 ml-3">{formatRelativeTime(item.lastAcquiredAt)}</span>
      </div>
    </Link>
  );
}

// 図鑑クイズは1問ごとの履歴を残していないので、図鑑に登録した市区町村を新しい順に並べる。
// 件数はそれほど多くないので一括で読む。未ログインなら他のタブと同じくログインを案内する
async function loadZukan(cursor?: string | null) {
  if (cursor) return { items: [] as ZukanCollectionEntry[], nextCursor: null };
  const user = await currentUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return { items: await fetchZukanCollections(), nextCursor: null };
}

function HistoryContent() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("game");
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? (initial as TabId) : "map-puzzle");
  const loadPuzzle = useCallback((c?: string | null) => fetchChallengeHistory(c), []);
  const loadPack = useCallback((c?: string | null) => fetchMapPackHistory(c), []);

  return (
    <>
      <div className="flex gap-2 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 text-xs font-semibold rounded-xl py-2 transition-colors ${
              tab === t.id ? "bg-teal-700 text-white" : "bg-white text-[#78716c] border border-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "map-puzzle" && (
        <HistoryShell
          key="map-puzzle"
          load={loadPuzzle}
          render={(item: ChallengeRecord) => <MapPuzzleItem key={item.id} item={item} />}
          empty="まだ地図パズルの履歴がありません"
        />
      )}
      {tab === "map-pack" && (
        <HistoryShell
          key="map-pack"
          load={loadPack}
          render={(item: MapPackHistoryRecord) => <MapPackItem key={item.id} item={item} />}
          empty="まだ地図ポットンの履歴がありません"
        />
      )}
      {tab === "zukan-quiz" && (
        <HistoryShell
          key="zukan-quiz"
          load={loadZukan}
          render={(item: ZukanCollectionEntry) => <ZukanItem key={`${item.prefCode}-${item.cityCode}`} item={item} />}
          empty="まだ図鑑に登録した市区町村がありません"
        />
      )}
    </>
  );
}

export default function HistoryPage() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">📜 遊んだ履歴</h1>
        </div>
        <Suspense fallback={<p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}>
          <HistoryContent />
        </Suspense>
      </div>
    </main>
  );
}
