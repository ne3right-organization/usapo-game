"use client";

import { useEffect, useState } from "react";
import { TANE_BASE_TYPE_BY_ID, TANE_COURSES, TANE_ITEM_BY_ID, prototypeItems, type TaneItem } from "@/lib/game/chizuTane/courses";
import { fetchMyItems, type TaneOwnedItem } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// 集めたもの: 持っているものの一覧。まだ持っていないものは影絵で出して、どこかのタネでもらえることが分かるようにする
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
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchMyItems()
      .then((items) => !cancelled && setOwned(new Map(items.map((i) => [i.itemId, i]))))
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

  return (
    <div>
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
                  <div key={item.itemId} className="bg-white rounded-2xl p-3 text-center shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
                    <div className="h-12 flex items-center justify-center">
                      <ItemIcon item={item} size={44} silhouette={!mine} />
                    </div>
                    {mine ? (
                      <>
                        <p className="text-xs font-bold text-[#3c2a14] mt-1">{item.name}</p>
                        <p className="text-[11px] text-emerald-700">×{mine.quantity}</p>
                        <p className="text-[10px] text-[#a8937a] mt-0.5 leading-tight">{mine.firstAreaName ?? "はじめから持っていた"}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-bold text-[#c8b8a0] mt-1">？？？</p>
                        <p className="text-[10px] text-[#a8937a] mt-0.5 leading-tight">どこかの{type?.name ?? "タネ"}でもらえる</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
