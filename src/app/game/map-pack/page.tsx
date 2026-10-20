import Link from "next/link";
import type { Metadata } from "next";
import AuthStatus from "@/components/game/map-puzzle/AuthStatus";

export const metadata: Metadata = {
  title: "地図ポットン",
  description: "地域のピースを箱に落として、隣り合う地域同士をくっつけて地図を完成させるパズルゲーム",
};

const DIFFICULTIES = [
  {
    id: "beginner",
    emoji: "🌸",
    label: "初級",
    labelClass: "bg-amber-100 text-amber-700 border border-amber-200",
    title: "都道府県ポットン",
    description: "47都道府県をくっつけて日本地図を完成させよう",
    sub: "47ピース・全国固定",
    borderClass: "border-amber-100 hover:border-amber-300",
    shadowHover: "hover:shadow-[0_4px_20px_rgba(245,158,11,0.15)]",
  },
  {
    id: "intermediate",
    emoji: "🌿",
    label: "中級",
    labelClass: "bg-violet-100 text-violet-700 border border-violet-200",
    title: "自治体ポットン",
    description: "都道府県を選んで、市区町村をくっつけよう",
    sub: "エリアを選んでスタート",
    borderClass: "border-violet-100 hover:border-violet-300",
    shadowHover: "hover:shadow-[0_4px_20px_rgba(124,58,237,0.12)]",
  },
  {
    id: "advanced",
    emoji: "🍃",
    label: "上級",
    labelClass: "bg-teal-100 text-teal-700 border border-teal-200",
    title: "ご近所ポットン",
    description: "市区町村を選んで、町丁をくっつけよう",
    sub: "エリアを選んでスタート",
    borderClass: "border-teal-100 hover:border-teal-300",
    shadowHover: "hover:shadow-[0_4px_20px_rgba(15,118,110,0.12)]",
  },
] as const;

export default function MapPackPage() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-8 pb-16">
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">📦</div>
          <h1 className="text-2xl font-bold text-[#3c2a14] tracking-wide">
            地図ポットン
            <span className="ml-2 text-[10px] font-bold text-purple-600 align-middle">プロトタイプ</span>
          </h1>
          <p className="text-sm text-[#78716c] mt-2 leading-relaxed">
            ピースを箱に落として、隣り合う地域同士を<br />くっつけて地図を完成させよう
          </p>
          <div className="mt-3">
            <AuthStatus />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mb-6">
          <Link
            href="/game/map-pack/ranking"
            className="inline-flex items-center gap-1 text-sm text-[#78716c] underline underline-offset-2"
          >
            🏆 ランキング
          </Link>
        </div>

        <p className="text-xs text-[#a8937a] mb-4 text-center tracking-widest">むずかしさを選んでね</p>

        <div className="flex flex-col gap-3">
          {DIFFICULTIES.map((d) => (
            <Link
              key={d.id}
              href={`/game/map-pack/${d.id}`}
              className={`block bg-white rounded-2xl border-2 ${d.borderClass} ${d.shadowHover}
                shadow-[0_2px_12px_rgba(120,90,40,0.08)]
                transition-all duration-150 p-5 active:scale-[0.98]`}
            >
              <div className="flex items-center gap-4">
                <div className="text-3xl shrink-0">{d.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.labelClass}`}>{d.label}</span>
                    <span className="font-bold text-[#3c2a14] text-sm">{d.title}</span>
                  </div>
                  <p className="text-sm text-[#78716c] leading-snug">{d.description}</p>
                  <p className="text-xs text-[#a8937a] mt-1">{d.sub}</p>
                </div>
                <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-center text-[10px] text-[#c8b8a0] mt-12 leading-relaxed">
          データ提供: e-stat（国勢調査小地域ポリゴン）
          <br />
          着想元:{" "}
          <a href="https://sns.dopagamelab.com/pref-pack/" target="_blank" rel="noopener noreferrer" className="underline">
            新・都道府県ゲーム
          </a>
        </p>
        <p className="text-center mt-4">
          <Link href="/" className="text-sm text-[#78716c] underline underline-offset-2">
            ← ゲームコーナーへ戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
