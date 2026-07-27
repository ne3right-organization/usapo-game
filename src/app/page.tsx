import Link from "next/link";
import type { Metadata } from "next";
import AuthStatus from "@/components/game/map-puzzle/AuthStatus";

export const metadata: Metadata = {
  title: "usapo-game",
  description: "うさぽの境界データを使った地図ゲーム集",
};

export default function Home() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-8 pb-16">

        {/* タイトルエリア */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🐰</div>
          <h1 className="text-2xl font-bold text-[#3c2a14] tracking-wide">usapo-game</h1>
          <p className="text-sm text-[#78716c] mt-2 leading-relaxed">
            うさぽの境界データ（geojson）を使った<br />地図ゲームコーナーです
          </p>
          <div className="mt-3">
            <AuthStatus />
          </div>
        </div>

        {/* ゲーム一覧 */}
        <p className="text-xs text-[#a8937a] mb-4 text-center tracking-widest">
          あそべるゲーム
        </p>

        <div className="flex flex-col gap-3 mb-12">
          <Link
            href="/game/map-puzzle"
            className="block bg-white rounded-2xl border-2 border-teal-100 hover:border-teal-300
              shadow-[0_2px_12px_rgba(120,90,40,0.08)] hover:shadow-[0_4px_20px_rgba(15,118,110,0.12)]
              transition-all duration-150 p-5 active:scale-[0.98]"
          >
            <div className="flex items-center gap-4">
              <div className="text-3xl shrink-0">🗺️</div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-[#3c2a14] text-sm block mb-1">地図パズル</span>
                <p className="text-sm text-[#78716c] leading-snug">
                  都道府県・市区町村・町丁のポリゴンを、地図上の正しい場所にドラッグして配置するパズルゲーム
                </p>
              </div>
              <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
            </div>
          </Link>

          <Link
            href="/game/zukan-quiz"
            className="block bg-white rounded-2xl border-2 border-orange-100 hover:border-orange-300
              shadow-[0_2px_12px_rgba(120,90,40,0.08)] hover:shadow-[0_4px_20px_rgba(234,88,12,0.15)]
              transition-all duration-150 p-5 active:scale-[0.98]"
          >
            <div className="flex items-center gap-4">
              <div className="text-3xl shrink-0">📖</div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-[#3c2a14] text-sm block mb-1">市区町村図鑑クイズ</span>
                <p className="text-sm text-[#78716c] leading-snug">
                  シルエットと4択クイズで市区町村を当てて図鑑を集めるコレクションゲーム
                </p>
              </div>
              <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
            </div>
          </Link>
        </div>

        {/* ログインについて */}
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5">
          <h2 className="text-sm font-bold text-[#3c2a14] mb-2">ログインについて</h2>
          <p className="text-sm text-[#78716c] leading-relaxed mb-3">
            ログインしなくてもゲームは遊べます。ログインすると、プレイ履歴の記録・ニックネームの登録・ランキングへの参加ができるようになります。
          </p>
          <Link
            href="/login"
            className="inline-block text-sm text-teal-700 underline underline-offset-2 font-semibold"
          >
            ログインする →
          </Link>
        </div>

      </div>
    </main>
  );
}
