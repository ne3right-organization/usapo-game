"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FRUITS_PER_EXCHANGE_SEED,
  TANE_BASE_TYPE_BY_ID,
  TANE_ITEM_BY_ID,
  exchangeSeedFor,
  taneMaxLevel,
  type TaneItem,
} from "@/lib/game/chizuTane/courses";
import { countPlaced } from "@/lib/game/chizuTane/garden";
import { exchangeFruits, openGarden } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, SeedIcon, TaneHeading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// 市場(2026-11-05。集めたものの画面の上からリンクする)。いまは、同じ実3個を1つ上のレベルの同じ番号のタネ1個と交換できる
// (みかんの木 → チューリップ。courses.ts の exchangeSeedFor)。いまの環境の上限レベル(本番は Lv.3)の種類の実と、ご当地の実は交換できない。
// ガーデンに飾っている分は使えない
export default function MarketView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <TaneHeading title="🏪 市場">実を集めて、タネと交換できます</TaneHeading>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <Market />}
    </TaneScreen>
  );
}

/** 交換できる実(手元の数と、ガーデンに飾っていて使えない数) */
interface Row {
  fruit: TaneItem;
  seed: TaneItem;
  quantity: number;
  placed: number;
}

function Market() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    openGarden()
      .then((g) => {
        if (cancelled) return;
        const placed = countPlaced([g.objects, ...Object.values(g.layouts)].flatMap((objs) => objs ?? []));
        const list: Row[] = [];
        for (const { itemId, quantity } of g.items) {
          const fruit = TANE_ITEM_BY_ID.get(itemId);
          const seed = exchangeSeedFor(itemId);
          if (fruit && seed && quantity > 0) list.push({ fruit, seed, quantity, placed: placed.get(itemId) ?? 0 });
        }
        // コース・レベル・番号の順に並べる(コースの表の順)
        const order = [...TANE_ITEM_BY_ID.keys()];
        setRows(list.sort((a, b) => order.indexOf(a.fruit.itemId) - order.indexOf(b.fruit.itemId)));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const exchange = async (row: Row) => {
    setBusy(row.fruit.itemId);
    setError("");
    setMessage("");
    try {
      const res = await exchangeFruits(row.fruit.itemId);
      setRows((cur) => cur?.map((r) => (r.fruit.itemId === row.fruit.itemId ? { ...r, quantity: res.fruitsLeft } : r)) ?? null);
      setMessage(`「${row.fruit.name}」${FRUITS_PER_EXCHANGE_SEED}個を、「${row.seed.name}」のタネ1個と交換しました（タネは${res.seedsHeld}個になりました）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const maxLevel = taneMaxLevel();

  return (
    <div>
      <section className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-4 text-xs text-[#78716c] leading-relaxed">
        <h2 className="text-sm font-bold text-[#3c2a14] mb-1">🌱 実をタネと交換する</h2>
        <p>
          同じ実{FRUITS_PER_EXCHANGE_SEED}個で、同じコースの1つ上のレベルのタネ1個と交換できます（例: みかんの木 → チューリップ）。ほかのコースの実なら、そのコースのタネになります。
        </p>
        <p className="mt-1 text-[#a8937a]">
          Lv.{maxLevel}（いまのレベルの上限）の種類の実と、ご当地の実は交換できません。ガーデンに飾っている分は使えません。
        </p>
      </section>

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-800 mb-3 leading-relaxed">{message}</div>
      )}
      {error && <ErrorText message={error} />}
      {!rows && !error && <Loading />}
      {rows?.length === 0 && (
        <p className="text-sm text-[#a8937a] text-center py-8">
          交換できる実がまだありません。畑で実を収穫すると、ここで交換できます
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const spare = Math.max(0, row.quantity - row.placed);
            const can = spare >= FRUITS_PER_EXCHANGE_SEED;
            const fromType = TANE_BASE_TYPE_BY_ID.get(row.fruit.baseTypeId);
            const toType = TANE_BASE_TYPE_BY_ID.get(row.seed.baseTypeId);
            return (
              <li key={row.fruit.itemId} className="bg-white rounded-xl shadow-[0_2px_8px_rgba(120,90,40,0.06)] p-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-center w-16 shrink-0">
                    <ItemIcon item={row.fruit} size={36} />
                    <span className="text-3xs text-[#a8937a] mt-0.5">Lv.{fromType?.unlockLevel}</span>
                  </div>
                  <div className="flex-1 min-w-0 text-center">
                    <p className="text-xs text-[#3c2a14] truncate">
                      {row.fruit.name} ×{FRUITS_PER_EXCHANGE_SEED}
                    </p>
                    <p className="text-lg text-emerald-600 leading-none my-0.5">→</p>
                    <p className="text-xs text-[#3c2a14] truncate">{row.seed.name}のタネ ×1</p>
                  </div>
                  <div className="flex flex-col items-center w-16 shrink-0">
                    <SeedIcon item={row.seed} size={36} />
                    <span className="text-3xs text-[#a8937a] mt-0.5">Lv.{toType?.unlockLevel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <p className="flex-1 text-2xs text-[#a8937a]">
                    持っている数 {row.quantity}個{row.placed > 0 && `（うちガーデンに${row.placed}個）`}
                  </p>
                  <button
                    type="button"
                    onClick={() => exchange(row)}
                    disabled={!can || busy !== null}
                    className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 disabled:bg-[#d6cfc4] active:scale-[0.98] transition-transform"
                  >
                    {busy === row.fruit.itemId ? "交換しています..." : can ? "交換する" : `あと${FRUITS_PER_EXCHANGE_SEED - spare}個`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/game/chizu-tane/collection" className="block text-center text-xs text-emerald-700 underline underline-offset-2 mt-6">
        ← 集めたものに戻る
      </Link>
    </div>
  );
}
