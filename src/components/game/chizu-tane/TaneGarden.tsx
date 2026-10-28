"use client";

import { useEffect, useMemo, useState } from "react";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { countPlaced, type GardenObject } from "@/lib/game/chizuTane/garden";
import { openGarden, saveGarden, type GardenState } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, TaneBackLink, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// タネニワ(おまけ): 集めたものを、斜め見下ろしのマス目に置く・動かす・しまう。保存はボタンで行う

const TILE_W = 64;
const TILE_H = 32;
const TOP = 44; // 奥の列に置いた背の高いものがはみ出さないよう、上に空ける

export default function TaneGardenView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <TaneBackLink />
      <h1 className="text-xl font-bold text-[#3c2a14] mb-1">🏡 タネニワ</h1>
      <p className="text-xs text-[#a8937a] mb-4">集めたものを、持っている数まで飾れます</p>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <Garden />}
    </TaneScreen>
  );
}

function newObjectId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function Garden() {
  const [garden, setGarden] = useState<GardenState | null>(null);
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

  // 保存していない変更があるときは、画面を離れる前に確かめる
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const placedCounts = useMemo(() => countPlaced(objects), [objects]);
  const objectAt = useMemo(() => new Map(objects.map((o) => [`${o.x},${o.y}`, o])), [objects]);

  if (error && !garden) return <ErrorText message={error} />;
  if (!garden) return <Loading />;

  const { width, height } = garden;
  const viewW = (width + height) * (TILE_W / 2);
  const viewH = TOP + (width + height) * (TILE_H / 2);
  const center = (x: number, y: number) => ({
    cx: height * (TILE_W / 2) + (x - y) * (TILE_W / 2),
    cy: TOP + TILE_H / 2 + (x + y) * (TILE_H / 2),
  });

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
      change([...objects, { objectId: newObjectId(), itemId: paletteItemId, x, y }]);
      if (remaining(paletteItemId) - 1 <= 0) setPaletteItemId(null);
    }
  };

  const handleStore = () => {
    if (!selectedObjectId) return;
    change(objects.filter((o) => o.objectId !== selectedObjectId));
    setSelectedObjectId(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveGarden(objects);
      setGarden(saved);
      setObjects(saved.objects);
      setDirty(false);
      setSavedMessage("保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.push({ x, y });
  const sortedObjects = [...objects].sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
  const placing = paletteItemId !== null || selectedObjectId !== null;

  return (
    <div>
      <div className="bg-[#eaf6ea] rounded-2xl p-2 mb-3">
        <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-auto select-none" role="img" aria-label="タネニワ">
          {tiles.map(({ x, y }) => {
            const { cx, cy } = center(x, y);
            const occupied = objectAt.has(`${x},${y}`);
            const isSelected = objectAt.get(`${x},${y}`)?.objectId === selectedObjectId && selectedObjectId !== null;
            const fill = isSelected ? "#fde68a" : placing && !occupied ? "#bbf7d0" : (x + y) % 2 === 0 ? "#a3d9a5" : "#97cf99";
            return (
              <polygon
                key={`${x},${y}`}
                points={`${cx},${cy - TILE_H / 2} ${cx + TILE_W / 2},${cy} ${cx},${cy + TILE_H / 2} ${cx - TILE_W / 2},${cy}`}
                fill={fill}
                stroke="#7fbf82"
                strokeWidth={1}
                onClick={() => handleTile(x, y)}
                className="cursor-pointer"
              />
            );
          })}
          {sortedObjects.map((o) => {
            const item = TANE_ITEM_BY_ID.get(o.itemId);
            if (!item) return null;
            const { cx, cy } = center(o.x, o.y);
            return item.imageUrl ? (
              <image
                key={o.objectId}
                href={item.imageUrl}
                x={cx - 24}
                y={cy - 44}
                width={48}
                height={48}
                pointerEvents="none"
              />
            ) : (
              <text key={o.objectId} x={cx} y={cy + 6} fontSize={30} textAnchor="middle" pointerEvents="none">
                {item.emoji}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-2 mb-3 min-h-[40px]">
        {selectedObjectId ? (
          <>
            <p className="flex-1 text-xs text-[#78716c]">空いているマスをタップすると動かせます</p>
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
        <div className="grid grid-cols-4 gap-2">
          {garden.items.map(({ itemId, quantity }) => {
            const item = TANE_ITEM_BY_ID.get(itemId);
            if (!item) return null;
            const left = remaining(itemId);
            const active = paletteItemId === itemId;
            return (
              <button
                key={itemId}
                type="button"
                disabled={left <= 0}
                onClick={() => {
                  setPaletteItemId(active ? null : itemId);
                  setSelectedObjectId(null);
                }}
                className={`bg-white rounded-xl p-2 text-center border-2 disabled:opacity-40 ${active ? "border-emerald-500" : "border-transparent"}`}
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
          })}
        </div>
      )}
    </div>
  );
}
