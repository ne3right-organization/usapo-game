"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TANE_BASE_TYPE_BY_ID, TANE_COURSES, TANE_ITEM_BY_ID, fruitName, prototypeItems, type TaneItem } from "@/lib/game/chizuTane/courses";
import {
  fetchMyHarvests,
  fetchMyItems,
  fetchOwnerViews,
  type TaneHarvest,
  type TaneOwnedItem,
  type TaneOwnerView,
} from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// 集めたもの: 収穫した実(もの)の一覧。まだ持っていないものは影絵で出して、そのタネを育てれば手に入ることが分かるようにする。
// 実をタップすると産地ごと(「戸塚区矢部町のりんご ×3」)に分けて、実がなった日・収穫した日・生産者(そのタネをまいた人。フレンドのときだけ)を出す
export default function CollectionView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <h1 className="text-xl font-bold text-[#3c2a14] mb-4">🧺 集めたもの</h1>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <Collection />}
    </TaneScreen>
  );
}

function Collection() {
  const [owned, setOwned] = useState<Map<string, TaneOwnedItem> | null>(null);
  const [harvests, setHarvests] = useState<TaneHarvest[]>([]);
  const [openItem, setOpenItem] = useState<TaneItem | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMyItems(), fetchMyHarvests()])
      .then(([items, hs]) => {
        if (cancelled) return;
        setOwned(new Map(items.map((i) => [i.itemId, i])));
        setHarvests(hs);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorText message={error} />;
  if (!owned) return <Loading />;

  // 試作で手に入るものに、それ以外で持っているもの(あとから範囲を広げたときの分)を足す
  const shown = new Map<string, TaneItem>(prototypeItems().map((i) => [i.itemId, i]));
  for (const id of owned.keys()) {
    const item = TANE_ITEM_BY_ID.get(id);
    if (item) shown.set(id, item);
  }
  const ownedCount = [...shown.keys()].filter((id) => owned.has(id)).length;
  const placeCount = (itemId: string) => new Set(harvests.filter((h) => h.itemId === itemId).map((h) => h.areaKey)).size;

  return (
    <div>
      <p className="text-xs text-[#a8937a] mb-2">自分でまいて育てたタネを収穫すると、ここに集まります</p>
      <p className="text-sm text-[#78716c] mb-4">
        {shown.size}種類のうち <span className="font-bold text-[#3c2a14]">{ownedCount}</span> 種類を集めました
      </p>
      {TANE_COURSES.map((course) => {
        const items = [...shown.values()].filter((i) => TANE_BASE_TYPE_BY_ID.get(i.baseTypeId)?.course === course.id);
        if (items.length === 0) return null;
        return (
          <section key={course.id} className="mb-5">
            <h2 className="text-xs font-bold text-[#a8937a] mb-2">
              {course.emoji} {course.label}
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => {
                const mine = owned.get(item.itemId);
                const type = TANE_BASE_TYPE_BY_ID.get(item.baseTypeId);
                return (
                  <button
                    key={item.itemId}
                    type="button"
                    disabled={!mine}
                    onClick={() => setOpenItem(item)}
                    className="bg-white rounded-2xl p-3 text-center shadow-[0_2px_8px_rgba(120,90,40,0.06)] enabled:active:scale-95 transition"
                  >
                    <div className="h-12 flex items-center justify-center">
                      <ItemIcon item={item} size={44} silhouette={!mine} />
                    </div>
                    {mine ? (
                      <>
                        <p className="text-xs font-bold text-[#3c2a14] mt-1">{item.name}</p>
                        <p className="text-[11px] text-emerald-700">×{mine.quantity}</p>
                        <p className="text-[10px] text-[#a8937a] mt-0.5 leading-tight">
                          {placeCount(item.itemId) > 0 ? `${placeCount(item.itemId)}か所で収穫` : "はじめから持っていた"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-bold text-[#c8b8a0] mt-1">？？？</p>
                        <p className="text-[10px] text-[#a8937a] mt-0.5 leading-tight">{type?.name ?? "タネ"}のタネを育てて収穫</p>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {openItem && (
        <HarvestSheet item={openItem} harvests={harvests.filter((h) => h.itemId === openItem.itemId)} onClose={() => setOpenItem(null)} />
      )}
    </div>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 1つの実の産地ごとの記録。同じ短い名前の産地が2つあれば(よその県の同じ名前の区・町)、都道府県から全部出す */
function HarvestSheet({ item, harvests, onClose }: { item: TaneItem; harvests: TaneHarvest[]; onClose: () => void }) {
  const [owners, setOwners] = useState<Map<string, TaneOwnerView> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOwnerViews(harvests.map((h) => h.ownerId))
      .then((views) => !cancelled && setOwners(views))
      .catch(() => !cancelled && setOwners(new Map()));
    return () => {
      cancelled = true;
    };
  }, [harvests]);

  // 産地(地区)ごとにまとめる。harvests は新しい順なので、最近収穫した産地が上に来る
  const places = new Map<string, TaneHarvest[]>();
  for (const h of harvests) places.set(h.areaKey, [...(places.get(h.areaKey) ?? []), h]);
  const shortNames = [...places.values()].map((hs) => fruitName(hs[0], item.name));
  const duplicated = (name: string) => shortNames.filter((n) => n === name).length > 1;

  return (
    <div className="fixed inset-0 z-[1200] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-[#fffaf0] w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <ItemIcon item={item} size={40} />
          <div className="flex-1">
            <p className="font-bold text-[#3c2a14]">{item.name}</p>
            <p className="text-xs text-[#a8937a]">
              {places.size}か所で {harvests.length}個 収穫
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-[#a8937a] px-2 py-1">
            閉じる
          </button>
        </div>
        {places.size === 0 && <p className="text-sm text-[#78716c]">収穫の記録はありません</p>}
        <ul className="space-y-3">
          {[...places.entries()].map(([areaKey, hs]) => {
            const short = fruitName(hs[0], item.name);
            const owner = owners?.get(hs[0].ownerId);
            return (
              <li key={areaKey} className="bg-white rounded-2xl p-3 shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
                <p className="font-bold text-[#3c2a14] text-sm">
                  {duplicated(short) ? fruitName(hs[0], item.name, true) : short}
                  <span className="text-emerald-700 font-normal ml-1">×{hs.length}</span>
                </p>
                <p className="text-[11px] text-[#a8937a]">{fruitName(hs[0], item.name, true)}</p>
                <p className="text-xs text-[#78716c] mt-1">
                  生産者:{" "}
                  {!owner ? (
                    "…"
                  ) : owner.kind === "me" ? (
                    "あなた"
                  ) : owner.kind === "friend" ? (
                    <Link href={`/profile/${owner.userId}`} className="text-emerald-700 underline">
                      {owner.nickname}
                    </Link>
                  ) : (
                    <span className="text-[#c8b8a0]">ひみつ（フレンドなら表示されます）</span>
                  )}
                </p>
                <table className="w-full mt-2 text-[11px] text-[#78716c]">
                  <thead>
                    <tr className="text-[#a8937a]">
                      <th className="text-left font-normal">実がなった日</th>
                      <th className="text-left font-normal">収穫した日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hs.map((h) => (
                      <tr key={h.harvestedAt}>
                        <td>{formatDateTime(h.ripenedAt)}</td>
                        <td>{formatDateTime(h.harvestedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
