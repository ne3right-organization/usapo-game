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
import { TANE_LOCAL_ITEM_BY_ID, TANE_LOCAL_PREFS, TANE_LOCAL_RANK_LABELS, type TaneLocalItem } from "@/lib/game/chizuTane/localItems";
import { exchangeFruits, fetchLocalMarket, openGarden, tradeLocalFruit, type TaneLocalMarketItem } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, SeedIcon, TaneHeading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// 市場(2026-11-05。集めたものの画面の上からリンクする)。
// - 同じ実3個を1つ上のレベルの同じ番号のタネ1個と交換できる(みかんの木 → チューリップ。courses.ts の exchangeSeedFor)。
//   いまの環境の上限レベル(本番は Lv.3)の種類の実と、ご当地の実は交換できない
//   ガーデンに飾っている分は使えない。並べるのは、いま交換できる(飾っていない分が3個以上ある)実だけ
// - ご当地の実の取り替え(LocalSwap): 市場にある自分が育てたご当地の実1個と、同じ何個目のほかの人の実1個を取り替える(生産者とものの組みにつき1人1個)
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
  // いま交換できる実だけ並べる(交換して足りなくなったものは消える)
  const spareOf = (row: Row) => Math.max(0, row.quantity - row.placed);
  const shown = rows?.filter((row) => spareOf(row) >= FRUITS_PER_EXCHANGE_SEED) ?? null;

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
      {shown?.length === 0 && (
        <p className="text-sm text-[#a8937a] text-center py-8">
          いま交換できる実はありません。同じ実を{FRUITS_PER_EXCHANGE_SEED}個集めると、ここで交換できます
        </p>
      )}
      {shown && shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((row) => {
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
                    disabled={busy !== null}
                    className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 disabled:bg-[#d6cfc4] active:scale-[0.98] transition-transform"
                  >
                    {busy === row.fruit.itemId ? "交換しています..." : "交換する"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <LocalSwap />

      <Link href="/game/chizu-tane/collection" className="block text-center text-xs text-emerald-700 underline underline-offset-2 mt-6">
        ← 集めたものに戻る
      </Link>
    </div>
  );
}

const prefNameOf = (item: TaneLocalItem) => TANE_LOCAL_PREFS.find((p) => p.prefCode === item.local)?.prefName ?? "";

/**
 * ご当地の実の取り替え。市場には、実って1か月たって撤去したご当地の畑の残りの実が、生産者の実として並ぶ。
 * 何個目(現地・お土産・記念品)を選び、市場にある自分の実から出すものを1つ選んで、ほかの人の実からもらうものを選ぶ(相手には自分の実が届く)。
 * 並んでいる実の生産者と産地(地区)は出さない(生活圏の手がかりになるため)
 */
function LocalSwap() {
  const [market, setMarket] = useState<TaneLocalMarketItem[] | null>(null);
  const [rank, setRank] = useState(1);
  const [giveId, setGiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchLocalMarket()
      .then((m) => !cancelled && setMarket(m))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = (market ?? [])
    .filter((m) => m.localRank === rank)
    .flatMap((m) => {
      const item = TANE_LOCAL_ITEM_BY_ID.get(m.itemId);
      return item ? [{ ...m, item }] : [];
    })
    .sort((a, b) => a.item.local.localeCompare(b.item.local));
  const gives = rows.filter((r) => r.mine > 0);
  const give = gives.find((r) => r.itemId === giveId) ?? null;
  const takes = rows.filter((r) => r.others > 0);

  const trade = async (take: TaneLocalItem) => {
    if (!give) return;
    setBusy(take.itemId);
    setError("");
    setMessage("");
    try {
      const res = await tradeLocalFruit(give.itemId, take.itemId);
      setMarket(await fetchLocalMarket());
      setMessage(
        `市場のあなたの「${give.item.name}」1個と、「${take.name}」（${prefNameOf(take)}）を取り替えました（市場のあなたの実は のこり${res.mineLeft}個）`
      );
      if (res.mineLeft === 0) setGiveId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-1">🔄 ご当地の実の取り替え</h2>
      <p className="text-xs text-[#78716c] leading-relaxed mb-3">
        実ってから1か月たったご当地の畑は、残りの実が市場に並びます。市場にあるあなたの実1個と、ほかの人が育てた同じ「{TANE_LOCAL_RANK_LABELS.join("・")}」の実1個を取り替えられます（相手にはあなたの実が届きます）。
        同じ人が育てた同じ実は、1人1個までです。市場のあなたの実が全部渡ると、次のご当地のタネが届きます。
      </p>

      <div className="flex gap-1 mb-3" role="tablist">
        {TANE_LOCAL_RANK_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={rank === i + 1}
            onClick={() => {
              setRank(i + 1);
              setGiveId(null);
            }}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${rank === i + 1 ? "bg-amber-600 text-white" : "bg-white text-[#78716c]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-800 mb-3 leading-relaxed">{message}</div>
      )}
      {error && <ErrorText message={error} />}
      {!market && !error && <Loading />}

      {market && (
        <>
          <h3 className="text-xs font-bold text-[#3c2a14] mb-1.5">1. 市場にあるあなたの実から選ぶ</h3>
          {gives.length === 0 ? (
            <p className="text-xs text-[#a8937a] bg-white rounded-xl p-3 mb-4">
              市場に、あなたが育てた「{TANE_LOCAL_RANK_LABELS[rank - 1]}」のご当地の実はありません（ご当地の畑が実って1か月たつと、残りの実が並びます）
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              {gives.map((r) => {
                const selected = r.itemId === giveId;
                return (
                  <button
                    key={r.itemId}
                    type="button"
                    onClick={() => setGiveId(selected ? null : r.itemId)}
                    aria-pressed={selected}
                    className={`inline-flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1 text-xs border-2 ${
                      selected ? "border-amber-500 bg-amber-50 text-[#3c2a14]" : "border-transparent bg-white text-[#3c2a14]"
                    }`}
                  >
                    <ItemIcon item={r.item} size={24} />
                    {r.item.name}
                    <span className="text-[#a8937a]">×{r.mine}</span>
                  </button>
                );
              })}
            </div>
          )}

          <h3 className="text-xs font-bold text-[#3c2a14] mb-1.5">2. もらう実を選ぶ</h3>
          {takes.length === 0 ? (
            <p className="text-xs text-[#a8937a] bg-white rounded-xl p-3">
              いま市場に、ほかの人が育てた「{TANE_LOCAL_RANK_LABELS[rank - 1]}」のご当地の実はありません
            </p>
          ) : (
            <ul className="space-y-2">
              {takes.map(({ item, others, available }) => {
                const can = !!give && available > 0;
                return (
                  <li key={item.itemId} className="bg-white rounded-xl shadow-[0_2px_8px_rgba(120,90,40,0.06)] p-3 flex items-center gap-2">
                    <ItemIcon item={item} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#3c2a14] truncate">
                        {item.name}
                        <span className="ml-1 text-[#a8937a]">{prefNameOf(item)}</span>
                      </p>
                      <p className="text-2xs text-[#a8937a]">
                        {others}個並んでいます{available < others && `（もらえるのは${available}個）`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => trade(item)}
                      disabled={!can || busy !== null}
                      className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 disabled:bg-[#d6cfc4] active:scale-[0.98] transition-transform"
                    >
                      {busy === item.itemId ? "取り替えています..." : available === 0 ? "もう持っています" : give ? "取り替える" : "1. を選んでね"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
