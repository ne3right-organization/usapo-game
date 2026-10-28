"use client";

import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import type { GardenObject } from "@/lib/game/chizuTane/garden";

// タネニワの絵(斜め見下ろしのマス目)。トップ画面では見るだけ、飾る画面ではマスをタップして編集する

const TILE_W = 64;
const TILE_H = 32;
const TOP = 44; // 奥の列に置いた背の高いものがはみ出さないよう、上に空ける

export interface GardenSvgProps {
  width: number;
  height: number;
  objects: GardenObject[];
  /** 渡さなければ見るだけの絵にする */
  onTileClick?: (x: number, y: number) => void;
  selectedObjectId?: string | null;
  /** 置く・動かす先を選んでいる最中(空いているマスを明るくする) */
  placing?: boolean;
}

export default function GardenSvg({ width, height, objects, onTileClick, selectedObjectId = null, placing = false }: GardenSvgProps) {
  const viewW = (width + height) * (TILE_W / 2);
  const viewH = TOP + (width + height) * (TILE_H / 2);
  const center = (x: number, y: number) => ({
    cx: height * (TILE_W / 2) + (x - y) * (TILE_W / 2),
    cy: TOP + TILE_H / 2 + (x + y) * (TILE_H / 2),
  });
  const objectAt = new Map(objects.map((o) => [`${o.x},${o.y}`, o]));

  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.push({ x, y });
  const sortedObjects = [...objects].sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-auto select-none" role="img" aria-label="タネニワ">
      {tiles.map(({ x, y }) => {
        const { cx, cy } = center(x, y);
        const here = objectAt.get(`${x},${y}`);
        const isSelected = selectedObjectId !== null && here?.objectId === selectedObjectId;
        const fill = isSelected ? "#fde68a" : placing && !here ? "#bbf7d0" : (x + y) % 2 === 0 ? "#a3d9a5" : "#97cf99";
        return (
          <polygon
            key={`${x},${y}`}
            points={`${cx},${cy - TILE_H / 2} ${cx + TILE_W / 2},${cy} ${cx},${cy + TILE_H / 2} ${cx - TILE_W / 2},${cy}`}
            fill={fill}
            stroke="#7fbf82"
            strokeWidth={1}
            onClick={onTileClick ? () => onTileClick(x, y) : undefined}
            className={onTileClick ? "cursor-pointer" : undefined}
          />
        );
      })}
      {sortedObjects.map((o) => {
        const item = TANE_ITEM_BY_ID.get(o.itemId);
        if (!item) return null;
        const { cx, cy } = center(o.x, o.y);
        return item.imageUrl ? (
          <image key={o.objectId} href={item.imageUrl} x={cx - 24} y={cy - 44} width={48} height={48} pointerEvents="none" />
        ) : (
          <text key={o.objectId} x={cx} y={cy + 6} fontSize={30} textAnchor="middle" pointerEvents="none">
            {item.emoji}
          </text>
        );
      })}
    </svg>
  );
}
