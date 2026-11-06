"use client";

import { useState } from "react";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { gachaDayKey } from "@/lib/game/chizuTane/gacha";
import { drawGacha, taneDayMs, type TaneGachaResult } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, SeedIcon } from "./TaneParts";

/**
 * ホームの毎日のガチャ(src/lib/game/chizuTane/gacha.ts)。1日1回引けて、タネか実が1つ出る。まれになぞのタネ(大当たり)。
 * なぞのタネのことは画面・お知らせ・あそびかたでは伏せておき(秘密)、出た人にだけ、出たときに説明する。
 * lastGachaOn は、読み込んだときのプレイヤーの「最後に引いた区切り」
 */
export default function DailyGacha({ lastGachaOn, onDrawn }: { lastGachaOn: string | null; onDrawn: (res: TaneGachaResult) => void }) {
  const [drawnOn, setDrawnOn] = useState(lastGachaOn);
  const [result, setResult] = useState<TaneGachaResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = drawnOn === gachaDayKey(new Date(), taneDayMs());

  const handleDraw = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await drawGacha();
      setResult(res);
      setDrawnOn(res.dayKey);
      onDrawn(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const item = result ? TANE_ITEM_BY_ID.get(result.itemId) : undefined;
  return (
    <div className="bg-white rounded-2xl px-4 py-3 mb-8 shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>
          🎁
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#3c2a14]">今日のガチャ</p>
          <p className="text-2xs text-[#a8937a] leading-snug">1日1回、タネか実がもらえます</p>
        </div>
        <button
          type="button"
          onClick={handleDraw}
          disabled={busy || done}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? "引いています..." : done ? "また明日" : "引く"}
        </button>
      </div>
      {error && <ErrorText message={error} />}
      {result && item && (
        <div className={`mt-3 rounded-xl px-3 py-2.5 flex items-center gap-3 ${result.mystery ? "bg-amber-50 border-2 border-amber-300" : "bg-emerald-50"}`}>
          {result.kind === "seed" ? <SeedIcon item={item} size={44} /> : <ItemIcon item={item} size={44} />}
          <p className={`text-xs leading-relaxed ${result.mystery ? "text-amber-900" : "text-emerald-800"}`}>
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
