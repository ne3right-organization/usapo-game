"use client";

import { useState } from "react";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { replantDeadline } from "@/lib/game/chizuTane/growth";
import { replantBase, taneDayMs, type TaneBase, type TaneSeedCount } from "@/lib/game/chizuTaneData";
import SeedPicker from "./SeedPicker";
import { remainingLabel } from "./TaneParts";

/**
 * タネ待ちの自分の畑に、同じ種類の畑のタネをまき直す(遠くからでもよい)。ホームの「あなたがまいたタネ」と、おでかけの画面で使う。
 * 期限(1週間)までにまかないと空き地に戻る
 */
export default function ReplantPicker({
  base,
  seeds,
  onReplanted,
}: {
  base: TaneBase;
  seeds: TaneSeedCount[];
  onReplanted: (next: TaneBase) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 残り時間は開いたときの時刻で出す(描画のたびに時刻を読まない)
  const [openedAt] = useState(() => Date.now());
  const typeName = TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "この畑";
  const usable = seeds.filter((s) => TANE_ITEM_BY_ID.get(s.itemId)?.baseTypeId === base.baseTypeId);
  const deadline = replantDeadline(base, taneDayMs());

  const handle = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      await onReplanted(await replantBase(base.areaKey, chosen));
      setOpen(false);
      setChosen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-[#f8f3ea] px-3 py-2 mt-1">
      <p className="text-[11px] text-[#78716c]">
        実が全部収穫されて、ランク{base.rank}になりました。{typeName}のタネをまき直すと、またタネから育ちます
        {deadline && <span className="text-[#a16207]">（{remainingLabel(deadline.getTime() - openedAt)}まかないと空き地に戻ります）</span>}
      </p>
      {usable.length === 0 ? (
        <p className="text-[11px] text-[#a8937a] mt-1">
          {typeName}のタネを持っていません。ほかの人の{typeName}に落ちているタネを拾うと、まき直せます
        </p>
      ) : open ? (
        <div className="mt-2">
          <SeedPicker seeds={usable} chosenItemId={chosen} onChoose={setChosen} disabled={busy} />
          <button
            type="button"
            onClick={handle}
            disabled={busy || !chosen}
            className="w-full rounded-lg py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "まいています..." : "🌱 このタネをまき直す"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-white border border-emerald-200"
        >
          🌱 タネをまき直す
        </button>
      )}
      {error && <p className="text-[10px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}
