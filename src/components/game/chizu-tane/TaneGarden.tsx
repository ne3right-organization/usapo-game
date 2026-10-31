"use client";

import { useEffect, useMemo, useState } from "react";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { GARDEN_DESIGNS, countPlaced, houseTierFor, type GardenDesignId, type GardenObject } from "@/lib/game/chizuTane/garden";
import { gardenObjectsOf, openGarden, saveGarden, type GardenState } from "@/lib/game/chizuTaneData";
import GardenSvg from "./GardenSvg";
import { FollowingGardens, MyFollowers } from "./FriendGardenView";
import { MyShelf } from "./ShelfParts";
import SwipePages from "./SwipePages";
import { ErrorText, ItemIcon, Loading, NeedStart, TaneHeading, TaneScreen, setTaneLeaveGuard } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// ガーデン(おまけ): 集めたものを、斜め見下ろしのマス目に置く・動かす・しまう。保存はボタンで行う。
// ガーデンは、開拓した地区の数で別のデザインのものが増える(上のタブで切り替える)。家と柵はレベルで立派になる。
// 所持数は、すべてのガーデンに置いている分を合わせて数える。
// 下に、おすそ分けの棚(ShelfParts)と、フォローしている人のガーデンへのリンク(見るだけ)と、自分のフォロワー・フォローしてもらうリンクを並べる(FriendGardenView)

export default function TaneGardenView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <TaneHeading title="🏡 ガーデン">全国で生産したものを自分のガーデンに飾ろう！</TaneHeading>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && (
        <>
          <Garden />
          <MyShelf />
          <FollowingGardens />
          <MyFollowers />
        </>
      )}
    </TaneScreen>
  );
}

function newObjectId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function Garden() {
  const [garden, setGarden] = useState<GardenState | null>(null);
  const [designId, setDesignId] = useState<GardenDesignId>("home");
  const [objects, setObjects] = useState<GardenObject[]>([]);
  const [dirty, setDirty] = useState(false);
  const [paletteItemId, setPaletteItemId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    openGarden()
      .then((g) => {
        if (cancelled) return;
        setGarden(g);
        setObjects(g.objects);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存していない変更があるときは、画面を離れる前に確かめる(ブラウザを閉じる・再読み込みと、下のタブでの移動)
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    setTaneLeaveGuard(() => "保存していない変更があります。保存せずに移りますか？");
    return () => {
      window.removeEventListener("beforeunload", handler);
      setTaneLeaveGuard(null);
    };
  }, [dirty]);

  // 所持数から引く数は、いま編集しているガーデン(objects)と、ほかのガーデンに置いている分を合わせたもの
  const placedCounts = useMemo(() => {
    if (!garden) return countPlaced(objects);
    const others = GARDEN_DESIGNS.filter((d) => d.id !== designId).flatMap((d) => gardenObjectsOf(garden, d.id));
    return countPlaced([...objects, ...others]);
  }, [objects, garden, designId]);
  const objectAt = useMemo(() => new Map(objects.map((o) => [`${o.x},${o.y}`, o])), [objects]);

  if (error && !garden) return <ErrorText message={error} />;
  if (!garden) return <Loading />;

  const remaining = (itemId: string) => (garden.items.find((i) => i.itemId === itemId)?.quantity ?? 0) - (placedCounts.get(itemId) ?? 0);

  const change = (next: GardenObject[]) => {
    setObjects(next);
    setDirty(true);
    setSavedMessage("");
  };

  const handleTile = (x: number, y: number) => {
    const here = objectAt.get(`${x},${y}`);
    if (here) {
      setSelectedObjectId(here.objectId === selectedObjectId ? null : here.objectId);
      setPaletteItemId(null);
      return;
    }
    if (selectedObjectId) {
      change(objects.map((o) => (o.objectId === selectedObjectId ? { ...o, x, y } : o)));
      setSelectedObjectId(null);
      return;
    }
    if (paletteItemId && remaining(paletteItemId) > 0) {
      // 置いたものを選んだままにして、すぐ矢印で位置を直せるようにする(続けて置くときは、もう一度下の一覧から選ぶ)
      const objectId = newObjectId();
      change([...objects, { objectId, itemId: paletteItemId, x, y }]);
      setPaletteItemId(null);
      setSelectedObjectId(objectId);
    }
  };

  // 選んでいるものを、となりのマスへ1つ動かす(斜め見下ろしなので、矢印は画面の斜めの向き)。外か、ふさがっていれば動かせない
  const selected = objects.find((o) => o.objectId === selectedObjectId);
  const moveTarget = (dx: number, dy: number) => {
    if (!selected) return null;
    const x = selected.x + dx;
    const y = selected.y + dy;
    if (x < 0 || y < 0 || x >= garden.width || y >= garden.height || objectAt.has(`${x},${y}`)) return null;
    return { x, y };
  };
  const handleMove = (dx: number, dy: number) => {
    const to = moveTarget(dx, dy);
    if (!to || !selected) return;
    change(objects.map((o) => (o.objectId === selected.objectId ? { ...o, ...to } : o)));
  };

  const handleStore = () => {
    if (!selectedObjectId) return;
    change(objects.filter((o) => o.objectId !== selectedObjectId));
    setSelectedObjectId(null);
  };

  const switchDesign = (id: GardenDesignId) => {
    if (id === designId || !garden) return;
    if (dirty && !window.confirm("保存していない変更があります。保存せずにほかのガーデンに移りますか？")) return;
    setDesignId(id);
    setObjects(gardenObjectsOf(garden, id));
    setDirty(false);
    setPaletteItemId(null);
    setSelectedObjectId(null);
    setSavedMessage("");
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveGarden(objects, designId);
      setGarden(saved);
      setObjects(gardenObjectsOf(saved, designId));
      setDirty(false);
      setSavedMessage("保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const placing = paletteItemId !== null || selectedObjectId !== null;

  const tier = houseTierFor(garden.level);

  return (
    <div>
      {/* ガーデンのタブ(開拓した地区の数で増える) */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GARDEN_DESIGNS.map((d) => {
          const locked = garden.plantedCount < d.unlockPlanted;
          const active = d.id === designId;
          const tabClass = active
            ? "bg-emerald-600 text-white border-emerald-600"
            : locked
              ? "bg-[#f5f0e8] text-[#c8b8a0] border-transparent"
              : "bg-white text-[#78716c] border-[#e7dccb]";
          return (
            <button
              key={d.id}
              type="button"
              disabled={locked}
              onClick={() => switchDesign(d.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border ${tabClass}`}
            >
              {locked ? "🔒" : d.emoji} {d.name}
              {locked && <span className="ml-1 font-normal">あと{d.unlockPlanted - garden.plantedCount}地区</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-[#a8937a] mb-2">
        家と柵: {tier.name}（Lv.{garden.level}）。新しい地区にタネをまくとガーデンが増え（いま{garden.plantedCount}地区）、レベルが上がると家と柵が立派になります
      </p>
      <div className="bg-[#eaf6ea] rounded-2xl p-2 mb-3">
        <GardenSvg
          width={garden.width}
          height={garden.height}
          design={designId}
          houseTier={tier.id}
          objects={objects}
          onTileClick={handleTile}
          selectedObjectId={selectedObjectId}
          placing={placing}
        />
      </div>

      <div className="flex items-center gap-2 mb-3 min-h-[40px]">
        {selectedObjectId ? (
          <>
            <p className="flex-1 text-xs text-[#78716c]">矢印か、空いているマスをタップすると動かせます</p>
            {/* 画面の斜めの向き: ↖ は x-1、↗ は y-1、↙ は y+1、↘ は x+1(GardenSvg の at) */}
            <div className="grid grid-cols-2 gap-1 shrink-0" aria-label="となりのマスへ動かす">
              {(
                [
                  ["↖", -1, 0],
                  ["↗", 0, -1],
                  ["↙", 0, 1],
                  ["↘", 1, 0],
                ] as const
              ).map(([arrow, dx, dy]) => (
                <button
                  key={arrow}
                  type="button"
                  onClick={() => handleMove(dx, dy)}
                  disabled={!moveTarget(dx, dy)}
                  className="w-8 h-8 rounded-lg bg-white border border-[#e7dccb] text-sm text-[#3c2a14] disabled:opacity-30"
                >
                  {arrow}
                </button>
              ))}
            </div>
            <button type="button" onClick={handleStore} className="rounded-xl px-3 py-2 text-sm font-semibold bg-white border border-[#e7dccb] text-[#78716c]">
              しまう
            </button>
          </>
        ) : paletteItemId ? (
          <p className="flex-1 text-xs text-[#78716c]">空いているマスをタップすると置けます</p>
        ) : (
          <p className="flex-1 text-xs text-[#78716c]">下の一覧から選んで置くか、置いたものをタップして動かせます</p>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
      {savedMessage && <p className="text-xs text-emerald-700 mb-2">{savedMessage}</p>}
      {error && <ErrorText message={error} />}

      <h2 className="text-xs font-bold text-[#a8937a] mb-2">持っているもの</h2>
      {garden.items.length === 0 ? (
        <p className="text-sm text-[#78716c]">まだ何も持っていません。</p>
      ) : (
        <SwipePages
          items={garden.items.filter(({ itemId }) => TANE_ITEM_BY_ID.has(itemId))}
          perPage={9}
          layout="grid"
          keyOf={({ itemId }) => itemId}
          render={({ itemId, quantity }) => {
            const item = TANE_ITEM_BY_ID.get(itemId)!;
            const left = remaining(itemId);
            const active = paletteItemId === itemId;
            return (
              <button
                type="button"
                disabled={left <= 0}
                onClick={() => {
                  setPaletteItemId(active ? null : itemId);
                  setSelectedObjectId(null);
                }}
                className={`w-full bg-white rounded-xl p-2 text-center border-2 disabled:opacity-40 ${active ? "border-emerald-500" : "border-transparent"}`}
              >
                <div className="h-9 flex items-center justify-center">
                  <ItemIcon item={item} size={34} />
                </div>
                <p className="text-[10px] text-[#3c2a14] mt-1 truncate">{item.name}</p>
                <p className="text-[10px] text-[#a8937a]">
                  {left}/{quantity}
                </p>
              </button>
            );
          }}
        />
      )}
    </div>
  );
}
