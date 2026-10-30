"use client";

import { useEffect, useState } from "react";
import { TANE_ITEM_BY_ID, type TaneItem } from "@/lib/game/chizuTane/courses";
import { countPlaced } from "@/lib/game/chizuTane/garden";
import { TANE_LOCAL_ITEM_BY_ID } from "@/lib/game/chizuTane/localItems";
import {
  fetchMySeeds,
  fetchShelf,
  openGarden,
  stockShelf,
  takeFromShelf,
  type TaneShelf,
  type TaneShelfItem,
} from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, SeedIcon } from "./TaneParts";

// おすそ分けの棚: 余ったタネや実を手元から棚に出しておくと、「農園を見せる」にしたフォロワーが遠くから1日1個持っていける
// (確かめるのは Lambda の chizu-tane-shelf)。自分の棚は自分のガーデンの画面、ほかの人の棚はその人のガーデンの画面に出す

function ShelfIcon({ kind, item, size = 32 }: { kind: TaneShelfItem["kind"]; item: TaneItem; size?: number }) {
  return kind === "seed" ? <SeedIcon item={item} size={size} /> : <ItemIcon item={item} size={size} />;
}

const label = (kind: TaneShelfItem["kind"], item: TaneItem) => (kind === "seed" ? `${item.name}のタネ` : item.name);

/** 自分の棚と、棚に出せるもの(タネは持っている数、実はガーデンに飾っていない数) */
async function loadMyShelf(): Promise<{ shelf: TaneShelf; spare: TaneShelfItem[] }> {
  const [shelf, seeds, garden] = await Promise.all([fetchShelf(), fetchMySeeds(), openGarden()]);
  const placed = countPlaced([...garden.objects, ...Object.values(garden.layouts).flatMap((objs) => objs ?? [])]);
  return {
    shelf,
    spare: [
      ...seeds.filter((x) => x.quantity > 0 && !TANE_LOCAL_ITEM_BY_ID.has(x.itemId)).map((x) => ({ kind: "seed" as const, ...x })),
      ...garden.items
        .map((x) => ({ kind: "fruit" as const, itemId: x.itemId, quantity: x.quantity - (placed.get(x.itemId) ?? 0) }))
        .filter((x) => x.quantity > 0),
    ],
  };
}

const keyOf = (x: { kind: TaneShelfItem["kind"]; itemId: string }) => `${x.kind}#${x.itemId}`;

/**
 * 自分の棚: 出しているものを戻す・手元のタネや実を出す。「1個出す」「1個戻す」は下書きで、「保存」で確定する。
 * 保存したら画面を読み直す(上のガーデンの所持数も、棚に出した分だけ減るので)
 */
export function MyShelf() {
  const [shelf, setShelf] = useState<TaneShelf | null>(null);
  const [spare, setSpare] = useState<TaneShelfItem[]>([]);
  // まだ保存していない変更(棚に出す数。戻すときはマイナス)
  const [pending, setPending] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = (v: { shelf: TaneShelf; spare: TaneShelfItem[] }) => {
    setShelf(v.shelf);
    setSpare(v.spare);
  };

  useEffect(() => {
    let cancelled = false;
    loadMyShelf()
      .then((v) => !cancelled && apply(v))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (x: TaneShelfItem, delta: number) =>
    setPending((cur) => {
      const next = new Map(cur);
      const v = (next.get(keyOf(x)) ?? 0) + delta;
      if (v === 0) next.delete(keyOf(x));
      else next.set(keyOf(x), v);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      for (const [key, count] of pending) {
        const [kind, itemId] = key.split("#") as [TaneShelfItem["kind"], string];
        await stockShelf(kind, itemId, count);
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // 途中まで保存できていることがあるので、読み直して下書きを捨てる
      setPending(new Map());
      loadMyShelf().then(apply).catch(() => {});
      setBusy(false);
    }
  };

  // 下書きを足した、棚の数と手元の数
  const merge = (base: TaneShelfItem[], sign: 1 | -1) => {
    const map = new Map(base.map((x) => [keyOf(x), { ...x }]));
    for (const [key, v] of pending) {
      const [kind, itemId] = key.split("#") as [TaneShelfItem["kind"], string];
      const row = map.get(key) ?? { kind, itemId, quantity: 0 };
      map.set(key, { ...row, quantity: row.quantity + sign * v });
    }
    return [...map.values()].filter((x) => x.quantity > 0);
  };
  const stocked = shelf ? merge(shelf.items, 1) : [];
  const spareNow = merge(spare, -1);
  return (
    <section className="mt-6">
      <h2 className="text-xs font-bold text-[#a8937a] mb-1">🧺 おすそ分けの棚</h2>
      <p className="text-[11px] text-[#a8937a] mb-2 leading-relaxed">
        余ったタネや実を棚に出しておくと、あなたが「農園を見せる」にしたフォロワーが、遠くから1日1個ずつ持っていけます。出したものは手元から減ります（戻すこともできます）。ガーデンに飾っている実と、ご当地のタネは出せません。
      </p>
      {error && <ErrorText message={error} />}
      {!shelf && !error && <Loading />}
      {shelf && (
        <>
          <p className="text-[11px] font-semibold text-[#78716c] mb-1">棚に出しているもの</p>
          {stocked.length === 0 ? (
            <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3 mb-3">まだ何も出していません</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 mb-3">
              {stocked.map((x) => {
                const item = TANE_ITEM_BY_ID.get(x.itemId);
                if (!item) return null;
                return (
                  <li key={`${x.kind}#${x.itemId}`} className="bg-white rounded-2xl p-2 text-center shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
                    <div className="h-9 flex items-center justify-center">
                      <ShelfIcon kind={x.kind} item={item} />
                    </div>
                    <p className="text-[11px] font-bold text-[#3c2a14] leading-tight mt-1">{label(x.kind, item)}</p>
                    <p className="text-[11px] text-emerald-700">×{x.quantity}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => change(x, -1)}
                      className="mt-1 text-[11px] text-[#a8937a] underline underline-offset-2 disabled:opacity-50"
                    >
                      1個戻す
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] font-semibold text-[#78716c] mb-1">手元から出す</p>
          {spareNow.length === 0 ? (
            <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3">出せるものがありません</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {spareNow.map((x) => {
                const item = TANE_ITEM_BY_ID.get(x.itemId);
                if (!item) return null;
                return (
                  <li key={`${x.kind}#${x.itemId}`} className="bg-white rounded-2xl p-2 text-center shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
                    <div className="h-9 flex items-center justify-center">
                      <ShelfIcon kind={x.kind} item={item} />
                    </div>
                    <p className="text-[11px] font-bold text-[#3c2a14] leading-tight mt-1">{label(x.kind, item)}</p>
                    <p className="text-[10px] text-[#a8937a]">手元 {x.quantity}個</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => change(x, 1)}
                      className="mt-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 disabled:opacity-50"
                    >
                      1個出す
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={save}
              disabled={pending.size === 0 || busy}
              className="flex-1 rounded-xl py-2 text-sm font-semibold text-white bg-emerald-600 disabled:opacity-50"
            >
              {busy ? "保存中..." : "棚を保存"}
            </button>
            {pending.size > 0 && !busy && (
              <button type="button" onClick={() => setPending(new Map())} className="rounded-xl px-3 py-2 text-sm text-[#78716c] bg-white border border-[#e7dccb]">
                取り消す
              </button>
            )}
          </div>
          {pending.size > 0 && <p className="text-[11px] text-[#a16207] mt-1">保存すると確定して、画面を読み直します</p>}
        </>
      )}
    </section>
  );
}

/** ほかの人の棚: 1日1個もらえる */
export function FriendShelf({ ownerId, nickname }: { ownerId: string; nickname: string }) {
  const [shelf, setShelf] = useState<TaneShelf | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchShelf(ownerId)
      .then((s) => !cancelled && setShelf(s))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const take = async (x: TaneShelfItem, item: TaneItem) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setShelf(await takeFromShelf(ownerId, x.kind, x.itemId));
      setMessage(
        x.kind === "seed" ? `🌱 「${item.name}」のタネをもらいました。おでかけでまけます` : `🧺 「${item.name}」をもらいました。集めたものに入ります`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // 先にもらわれたときなどは、棚を読み直す
      fetchShelf(ownerId).then(setShelf).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4">
      <h2 className="text-xs font-bold text-[#a8937a] mb-1">🧺 {nickname}さんのおすそ分けの棚</h2>
      <p className="text-[11px] text-[#a8937a] mb-2 leading-relaxed">1日1個、好きなものをもらえます（早い者勝ち）</p>
      {error && <ErrorText message={error} />}
      {message && <p className="text-xs text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2 mb-2">{message}</p>}
      {!shelf && !error && <Loading />}
      {shelf && shelf.items.length === 0 && <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3">いまは棚に何もありません</p>}
      {shelf && shelf.items.length > 0 && (
        <>
          {shelf.takenToday && <p className="text-[11px] text-[#a16207] mb-1">今日はもうもらいました。また明日どうぞ</p>}
          <ul className="grid grid-cols-3 gap-2">
            {shelf.items.map((x) => {
              const item = TANE_ITEM_BY_ID.get(x.itemId);
              if (!item) return null;
              return (
                <li key={`${x.kind}#${x.itemId}`} className="bg-white rounded-2xl p-2 text-center shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
                  <div className="h-9 flex items-center justify-center">
                    <ShelfIcon kind={x.kind} item={item} />
                  </div>
                  <p className="text-[11px] font-bold text-[#3c2a14] leading-tight mt-1">{label(x.kind, item)}</p>
                  <p className="text-[11px] text-emerald-700">×{x.quantity}</p>
                  <button
                    type="button"
                    disabled={busy || shelf.takenToday}
                    onClick={() => take(x, item)}
                    className="mt-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 disabled:opacity-50"
                  >
                    もらう
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
