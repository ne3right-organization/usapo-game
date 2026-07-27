import Link from "next/link";
import type { Metadata } from "next";
import AuthStatus from "@/components/game/map-puzzle/AuthStatus";

export const metadata: Metadata = {
  title: "市区町村図鑑クイズ",
  description: "シルエットと4択で市区町村を当てて図鑑を集めるクイズゲーム",
};

export default function ZukanQuizPage() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-8 pb-16">
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">📖</div>
          <h1 className="text-2xl font-bold text-[#3c2a14] tracking-wide">市区町村図鑑クイズ</h1>
          <p className="text-sm text-[#78716c] mt-2 leading-relaxed">
            シルエットをヒントに市区町村を当てて<br />図鑑を集めよう
          </p>
          <div className="mt-3">
            <AuthStatus />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mb-8">
          <Link
            href="/game/zukan-quiz/collection"
            className="inline-flex items-center gap-1 text-sm text-[#78716c] underline underline-offset-2"
          >
            📖 図鑑を見る
          </Link>
        </div>

        <Link
          href="/game/zukan-quiz/play"
          className="block bg-white rounded-2xl border-2 border-orange-100 hover:border-orange-300
            shadow-[0_2px_12px_rgba(120,90,40,0.08)] hover:shadow-[0_4px_20px_rgba(234,88,12,0.15)]
            transition-all duration-150 p-5 active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <div className="text-3xl shrink-0">🧩</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                  ふつう
                </span>
                <span className="font-bold text-[#3c2a14] text-sm">クイズに挑戦</span>
              </div>
              <p className="text-sm text-[#78716c] leading-snug">
                4択クイズを5問。正解した市区町村は図鑑に登録されます
              </p>
              <p className="text-xs text-[#a8937a] mt-1">1セッション5問・3〜5分</p>
            </div>
            <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
          </div>
        </Link>

        <p className="text-center text-[10px] text-[#c8b8a0] mt-12 leading-relaxed">
          データ提供: e-stat（国勢調査）・stat.usapo.net
        </p>
      </div>
    </main>
  );
}
