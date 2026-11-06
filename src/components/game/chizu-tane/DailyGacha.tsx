"use client";

import { useState } from "react";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { gachaDayKey, isGachaHoliday } from "@/lib/game/chizuTane/gacha";
import { DAILY_GACHA_ANCHOR } from "@/lib/game/chizuTane/tips";
import { drawGacha, taneDayMs, type TaneGachaResult } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, SeedIcon } from "./TaneParts";

/** 演出の長さ(ミリ秒)。実機で見ながらここで調整する */
const GACHA_TIMING = {
  /** 機械がガタガタ揺れる長さ(サーバーの結果が遅ければ、届くまで揺れ続ける) */
  shakeMs: 1200,
  /** カプセルが出てきてから開くまで */
  dropMs: 700,
  /** カプセルが開いてから、結果の文を出すまで */
  openMs: 500,
};

type Phase = "idle" | "shaking" | "capsule" | "open" | "done";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ホームの毎日のガチャ(src/lib/game/chizuTane/gacha.ts)。平日は1日1回、土日祝は朝・昼・夜に1回ずつ引けて、タネか実が1つ出る。まれになぞのタネ(大当たり)。
 * なぞのタネのことは画面・お知らせ・あそびかたでは伏せておき(秘密)、出た人にだけ、出たときに説明する。
 * 引くと、機械が揺れる → カプセルが出る(大当たりは金色) → 開いて中身が出る、の順に見せる。
 * lastGachaOn は、読み込んだときのプレイヤーの「最後に引いた区切り」
 */
export default function DailyGacha({ lastGachaOn, onDrawn }: { lastGachaOn: string | null; onDrawn: (res: TaneGachaResult) => void }) {
  const [drawnOn, setDrawnOn] = useState(lastGachaOn);
  const [result, setResult] = useState<TaneGachaResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const now = new Date();
  const done = drawnOn === gachaDayKey(now, taneDayMs());
  // 土日祝は朝・昼・夜に1回ずつ引けて、当たりが出やすい
  const holiday = isGachaHoliday(now);
  const busy = phase === "shaking" || phase === "capsule" || phase === "open";

  const handleDraw = async () => {
    setError("");
    setResult(null);
    setPhase("shaking");
    try {
      const [res] = await Promise.all([drawGacha(), wait(GACHA_TIMING.shakeMs)]);
      setResult(res);
      setDrawnOn(res.dayKey);
      setPhase("capsule");
      await wait(GACHA_TIMING.dropMs);
      setPhase("open");
      await wait(GACHA_TIMING.openMs);
      setPhase("done");
      onDrawn(res);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const item = result ? TANE_ITEM_BY_ID.get(result.itemId) : undefined;
  const gold = !!result?.mystery;
  const showStage = phase !== "idle" && phase !== "done";
  return (
    <div id={DAILY_GACHA_ANCHOR} className="bg-white rounded-2xl px-4 py-3 mb-8 shadow-[0_2px_8px_rgba(120,90,40,0.06)] scroll-mt-4">
      <style>{GACHA_CSS}</style>
      <div className="flex items-center gap-3">
        <span className={`text-3xl inline-block ${phase === "shaking" ? "tane-gacha-shake" : ""}`} aria-hidden>
          🎁
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#3c2a14]">
            今日のガチャ{holiday && <span className="ml-1.5 text-2xs font-bold text-white bg-rose-500 rounded-full px-1.5 py-0.5 align-middle">土日祝</span>}
          </p>
          <p className="text-2xs text-[#a8937a] leading-snug">
            {holiday ? "今日は朝・昼・夜に1回ずつ引けて、当たりが出やすい日です" : "1日1回、タネか実がもらえます（土日祝は1日3回）"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDraw}
          disabled={busy || done}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? "ガチャガチャ..." : done ? (holiday ? "次の時間帯に" : "また明日") : "引く"}
        </button>
      </div>
      {error && <ErrorText message={error} />}

      {/* 演出: 揺れているあいだは待ち、カプセルが落ちてきて、開いて中身が出る */}
      {showStage && (
        <div className="mt-3 h-28 rounded-xl bg-amber-50 flex items-center justify-center relative overflow-hidden" aria-live="polite">
          {phase === "shaking" && <span className="text-xs text-amber-700 tane-gacha-blink">ガチャガチャ……</span>}
          {(phase === "capsule" || phase === "open") && (
            <div className={`relative ${phase === "capsule" ? "tane-gacha-drop" : ""}`} style={{ width: 64, height: 64 }}>
              {/* カプセル。上半分が色つき(大当たりは金色)、下半分が白。開くと上半分が外れる */}
              <div
                className={`absolute inset-x-0 top-0 h-1/2 rounded-t-full border-2 ${gold ? "bg-yellow-300 border-yellow-500" : "bg-rose-300 border-rose-400"} ${
                  phase === "open" ? "tane-gacha-lid" : ""
                }`}
              />
              <div className={`absolute inset-x-0 bottom-0 h-1/2 rounded-b-full border-2 bg-white ${gold ? "border-yellow-500" : "border-rose-400"}`} />
              {phase === "open" && item && (
                <div className="absolute inset-0 flex items-center justify-center tane-gacha-pop">
                  {result?.kind === "seed" ? <SeedIcon item={item} size={44} /> : <ItemIcon item={item} size={48} />}
                </div>
              )}
            </div>
          )}
          {gold &&
            phase === "open" &&
            ["left-6 top-4", "right-8 top-6", "left-12 bottom-5", "right-5 bottom-8", "left-1/2 top-2"].map((pos, i) => (
              <span key={pos} className={`absolute ${pos} text-lg tane-gacha-sparkle`} style={{ animationDelay: `${i * 90}ms` }} aria-hidden>
                ✨
              </span>
            ))}
        </div>
      )}

      {phase === "done" && result && item && (
        <div className={`mt-3 rounded-xl px-3 py-2.5 flex items-center gap-3 tane-gacha-pop ${gold ? "bg-amber-50 border-2 border-amber-300" : "bg-emerald-50"}`}>
          {result.kind === "seed" ? <SeedIcon item={item} size={44} /> : <ItemIcon item={item} size={44} />}
          <p className={`text-xs leading-relaxed ${gold ? "text-amber-900" : "text-emerald-800"}`}>
            {result.mystery ? (
              <>
                <span className="block text-sm font-bold">🎉 大当たり！ なぞのタネが出ました</span>
                おでかけで空き地にまくと「👑 レアな畑」になります。何が実るかは、育ててのお楽しみ。実は、現地に来た人に1人1個ずつ（あなたも現地で）
              </>
            ) : result.kind === "seed" ? (
              <>「{item.name}」のタネが出ました。おでかけで、まだタネの無い地区にまけます</>
            ) : (
              <>「{item.name}」が出ました。集めたものに入りました</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// 演出の動き。長さは上の GACHA_TIMING(ここの秒数は動き1回ぶん)
const GACHA_CSS = `
@keyframes tane-gacha-shake {
  0%, 100% { transform: translateX(0) rotate(0); }
  20% { transform: translateX(-3px) rotate(-8deg); }
  40% { transform: translateX(3px) rotate(8deg); }
  60% { transform: translateX(-2px) rotate(-5deg); }
  80% { transform: translateX(2px) rotate(5deg); }
}
.tane-gacha-shake { animation: tane-gacha-shake 0.35s ease-in-out infinite; }
@keyframes tane-gacha-blink { 50% { opacity: 0.4; } }
.tane-gacha-blink { animation: tane-gacha-blink 0.6s ease-in-out infinite; }
@keyframes tane-gacha-drop {
  0% { transform: translateY(-90px); }
  60% { transform: translateY(6px); }
  80% { transform: translateY(-4px); }
  100% { transform: translateY(0); }
}
.tane-gacha-drop { animation: tane-gacha-drop 0.6s ease-out both; }
@keyframes tane-gacha-lid {
  to { transform: translateY(-26px) rotate(-25deg); opacity: 0; }
}
.tane-gacha-lid { animation: tane-gacha-lid 0.4s ease-in forwards; }
@keyframes tane-gacha-pop {
  0% { transform: scale(0.3); opacity: 0; }
  70% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); }
}
.tane-gacha-pop { animation: tane-gacha-pop 0.4s ease-out both; }
@keyframes tane-gacha-sparkle {
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.8); opacity: 0; }
}
.tane-gacha-sparkle { animation: tane-gacha-sparkle 0.9s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .tane-gacha-shake, .tane-gacha-blink, .tane-gacha-drop, .tane-gacha-lid, .tane-gacha-pop, .tane-gacha-sparkle { animation: none; }
}
`;
