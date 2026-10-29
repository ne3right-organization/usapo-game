import Link from "next/link";
import type { Metadata } from "next";

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
          <div className="mt-3 flex items-center justify-center gap-4">
            <Link href="/history" className="inline-flex items-center gap-1 text-sm text-[#78716c] underline underline-offset-2">
              📜 遊んだ履歴
            </Link>
            <Link href="/profile" className="inline-flex items-center gap-1 text-sm text-[#78716c] underline underline-offset-2">
              👤 プロフィール
            </Link>
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
            href="/game/map-pack"
            className="block bg-white rounded-2xl border-2 border-purple-100 hover:border-purple-300
              shadow-[0_2px_12px_rgba(120,90,40,0.08)] hover:shadow-[0_4px_20px_rgba(126,34,206,0.12)]
              transition-all duration-150 p-5 active:scale-[0.98]"
          >
            <div className="flex items-center gap-4">
              <div className="text-3xl shrink-0">📦</div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-[#3c2a14] text-sm block mb-1">
                  地図ポットン
                  <span className="ml-2 text-[10px] font-bold text-purple-600 align-middle">プロトタイプ</span>
                </span>
                <p className="text-sm text-[#78716c] leading-snug">
                  都道府県・市区町村・町丁のピースを箱に落として、隣り合う地域同士をくっつけて地図を完成させるパズル
                </p>
              </div>
              <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
            </div>
          </Link>

          <Link
            href="/game/chizu-tane"
            className="block bg-white rounded-2xl border-2 border-emerald-100 hover:border-emerald-300
              shadow-[0_2px_12px_rgba(120,90,40,0.08)] hover:shadow-[0_4px_20px_rgba(5,150,105,0.12)]
              transition-all duration-150 p-5 active:scale-[0.98]"
          >
            <div className="flex items-center gap-4">
              <div className="text-3xl shrink-0">🌱</div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-[#3c2a14] text-sm block mb-1">
                  うさぽ農園
                  <span className="ml-2 text-[10px] font-bold text-emerald-600 align-middle">プロトタイプ</span>
                </span>
                <p className="text-sm text-[#78716c] leading-snug">
                  街の地区にタネをまき、ほかの人のタネを現地で訪ねて分けてもらい、育てて収穫する位置情報ゲーム（ログインが必要）
                </p>
              </div>
              <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
            </div>
          </Link>
        </div>

        {/* ログインについて */}
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5">
          <h2 className="text-sm font-bold text-[#3c2a14] mb-2">ログインについて</h2>
          <p className="text-sm text-[#78716c] leading-relaxed">
            地図パズルと地図ポットンは、ログインしなくても遊べます。ログインすると、遊んだ記録が残り、ニックネームを付けてランキングに参加できます。うさぽ農園はログインが必要です。ログインは右上の「ログイン」からできます。
          </p>
        </div>

        {/* ホーム画面に追加(PWA) */}
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 mt-4">
          <h2 className="text-sm font-bold text-[#3c2a14] mb-2">📱 ホーム画面に追加できます</h2>
          <p className="text-sm text-[#78716c] leading-relaxed mb-3">
            このサイトはアプリのようにホーム画面に追加して、ブラウザの枠なしで遊べます。
          </p>
          <ul className="text-sm text-[#78716c] leading-relaxed list-disc pl-5 space-y-1">
            <li>iPhone・iPad（Safari）: 共有ボタン → 「ホーム画面に追加」</li>
            <li>Android（Chrome）: 右上のメニュー → 「ホーム画面に追加」または「アプリをインストール」</li>
            <li>パソコン（Chrome・Edge）: アドレスバー右端のインストールボタン</li>
          </ul>
        </div>

      </div>
    </main>
  );
}
