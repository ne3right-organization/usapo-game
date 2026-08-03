import Link from "next/link";
import type { Metadata } from "next";
import AuthStatus from "@/components/game/map-puzzle/AuthStatus";
import { ZUKAN_DIFFICULTIES, ZUKAN_DIFFICULTY_META } from "@/lib/game/zukanQuizDifficulty";
import { fetchTriviaRegisteredMunicipalities } from "@/lib/game/zukanQuizData";

export const metadata: Metadata = {
  title: "市区町村図鑑クイズ",
  description: "シルエットと4択で市区町村を当てて図鑑を集めるクイズゲーム",
};

export default async function ZukanQuizPage() {
  const registered = await fetchTriviaRegisteredMunicipalities();
  const groupedByPref = new Map<string, string[]>();
  for (const m of registered) {
    const cities = groupedByPref.get(m.prefName) ?? [];
    cities.push(m.cityName);
    groupedByPref.set(m.prefName, cities);
  }

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

        <div className="flex flex-col gap-3">
          {ZUKAN_DIFFICULTIES.map((difficulty) => {
            const meta = ZUKAN_DIFFICULTY_META[difficulty];
            return (
              <Link
                key={difficulty}
                href={`/game/zukan-quiz/play/${difficulty}`}
                className="block bg-white rounded-2xl border-2 border-orange-100 hover:border-orange-300
                  shadow-[0_2px_12px_rgba(120,90,40,0.08)] hover:shadow-[0_4px_20px_rgba(234,88,12,0.15)]
                  transition-all duration-150 p-5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="text-3xl shrink-0">🧩</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                      <span className="font-bold text-[#3c2a14] text-sm">クイズに挑戦</span>
                    </div>
                    <p className="text-sm text-[#78716c] leading-snug">{meta.description}</p>
                    <p className="text-xs text-[#a8937a] mt-1">1セッション5問・3〜5分</p>
                  </div>
                  <div className="text-[#c8b8a0] text-xl shrink-0">›</div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-10">
          <h2 className="text-sm font-bold text-[#3c2a14] mb-2">かんたん・ふつうで出題される市区町村</h2>
          <div className="bg-white rounded-2xl border border-orange-100 p-4 max-h-64 overflow-y-auto text-sm text-[#78716c] leading-relaxed">
            {groupedByPref.size === 0 ? (
              <p>準備中です。むずかしいなら全国どこでも出題されます。</p>
            ) : (
              Array.from(groupedByPref.entries()).map(([prefName, cities]) => (
                <p key={prefName} className="mb-1">
                  <span className="font-bold text-[#3c2a14]">{prefName}</span>：{cities.join("、")}
                </p>
              ))
            )}
          </div>
          <p className="text-xs text-[#a8937a] mt-3 leading-relaxed">
            リストにない市区町村は、かんたん・ふつうには出題されません。出題用のトリビアを管理者(X:{" "}
            <a
              href="https://x.com/usagikanagawa"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              @usagikanagawa
            </a>
            )が登録していますので、追加してほしい場合は管理者まで連絡してください。
            <br />
            また、むずかしい、をクリアして図鑑に登録することでもヒントの提案を投稿できます。
            <br />
            チャレンジをお待ちしております。
          </p>
        </div>

        <p className="text-center text-[10px] text-[#c8b8a0] mt-12 leading-relaxed">
          データ提供: e-stat（国勢調査）<br />
          地形:{" "}
          <a
            href="https://maps.gsi.go.jp/development/ichiran.html"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            国土地理院
          </a>
        </p>
      </div>
    </main>
  );
}
