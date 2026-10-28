"use client";

import { useId } from "react";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import type { GardenObject } from "@/lib/game/chizuTane/garden";

// ガーデンの絵(斜め見下ろしのマス目)。自宅の庭のつもりで、土台の厚みのある芝生の島に、奥の角の家・木・柵を描く
// (飾りの絵で、置き場所のデータは変わらない)。トップ画面では見るだけ、飾る画面ではマスをタップして編集する

const TILE_W = 64;
const TILE_H = 32;
const TOP = 176; // 奥の角の家と木、奥の列に置いた背の高いものが収まるよう、上に空ける
const SIDE = 22; // 土台の厚み
const FENCE_H = 13;

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

type Point = { px: number; py: number };

export default function GardenSvg({ width, height, objects, onTileClick, selectedObjectId = null, placing = false }: GardenSvgProps) {
  const uid = useId().replace(/:/g, "");
  const viewW = (width + height) * (TILE_W / 2) + 24;
  const viewH = TOP + (width + height) * (TILE_H / 2) + SIDE + 16;
  const left = height * (TILE_W / 2) + 12;
  // 格子点(i, j)を高さ z だけ持ち上げた位置。i は x 方向、j は y 方向。マス(x, y)の真ん中は (x + 0.5, y + 0.5)
  const at = (i: number, j: number, z = 0): Point => ({
    px: left + (i - j) * (TILE_W / 2),
    py: TOP + (i + j) * (TILE_H / 2) - z,
  });
  const pts = (...ps: Point[]) => ps.map((p) => `${p.px},${p.py}`).join(" ");
  const objectAt = new Map(objects.map((o) => [`${o.x},${o.y}`, o]));

  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.push({ x, y });
  const sortedObjects = [...objects].sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);

  const T = at(0, 0);
  const R = at(width, 0);
  const B = at(width, height);
  const L = at(0, height);
  const down = (p: Point): Point => ({ px: p.px, py: p.py + SIDE });

  // 柵: 奥の2辺はものより先に、手前の2辺はものの後に描く(手前の柵がものの足もとにかかる)。手前・右下の辺の真ん中は門
  const gate = Math.floor(height / 2);
  const backFence: [Point, Point][] = [
    ...Array.from({ length: width }, (_, i) => [at(i, 0), at(i + 1, 0)] as [Point, Point]),
    ...Array.from({ length: height }, (_, j) => [at(0, j), at(0, j + 1)] as [Point, Point]),
  ];
  const frontFence: [Point, Point][] = [
    ...Array.from({ length: height }, (_, j) => j)
      .filter((j) => j !== gate)
      .map((j) => [at(width, j), at(width, j + 1)] as [Point, Point]),
    ...Array.from({ length: width }, (_, i) => [at(i, height), at(i + 1, height)] as [Point, Point]),
  ];

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-auto select-none" role="img" aria-label="ガーデン">
      <defs>
        <linearGradient id={`grass-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fdc7c" />
          <stop offset="1" stopColor="#7cc65e" />
        </linearGradient>
        <linearGradient id={`soilL-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b98a5a" />
          <stop offset="1" stopColor="#8f6538" />
        </linearGradient>
        <linearGradient id={`soilR-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a47648" />
          <stop offset="1" stopColor="#7a5430" />
        </linearGradient>
        <filter id={`shadow-${uid}`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#3d2b14" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* 島の下の影 */}
      <ellipse cx={(L.px + R.px) / 2} cy={B.py + SIDE + 4} rx={(R.px - L.px) / 2.3} ry={10} fill="#3d2b14" opacity={0.12} />

      {/* 奥の木と家(島の外の奥) */}
      <g pointerEvents="none" filter={`url(#shadow-${uid})`}>
        <Tree p={at(-1.1, 2.6)} scale={1.05} />
        <Tree p={at(3.2, -1.2)} scale={0.95} />
        <IsoHouse at={at} />
        <Tree p={at(-1.2, 5.6)} scale={0.8} />
        <Tree p={at(6.4, -1.1)} scale={0.85} />
      </g>

      {/* 土台(土の側面) */}
      <polygon points={pts(L, B, down(B), down(L))} fill={`url(#soilL-${uid})`} />
      <polygon points={pts(B, R, down(R), down(B))} fill={`url(#soilR-${uid})`} />
      <polyline points={pts(down(L), down(B), down(R))} fill="none" stroke="#6b4a29" strokeWidth={1.5} opacity={0.5} />

      {/* 芝生のマス */}
      <polygon points={pts(T, R, B, L)} fill={`url(#grass-${uid})`} />
      {tiles.map(({ x, y }) => {
        const here = objectAt.get(`${x},${y}`);
        const isSelected = selectedObjectId !== null && here?.objectId === selectedObjectId;
        const fill = isSelected ? "#fde68a" : placing && !here ? "#d9f99d" : (x + y) % 2 === 0 ? "#ffffff" : "#000000";
        const opacity = isSelected ? 0.9 : placing && !here ? 0.75 : (x + y) % 2 === 0 ? 0.07 : 0.03;
        return (
          <polygon
            key={`${x},${y}`}
            points={pts(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1))}
            fill={fill}
            fillOpacity={opacity}
            stroke="#ffffff"
            strokeOpacity={onTileClick ? 0.35 : 0.15}
            strokeWidth={1}
            onClick={onTileClick ? () => onTileClick(x, y) : undefined}
            className={onTileClick ? "cursor-pointer" : undefined}
          />
        );
      })}
      {/* 何も置いていないマスの草と小さな花(マスの位置で決まるので、描き直しても変わらない) */}
      <g pointerEvents="none">
        {tiles.map(({ x, y }) => {
          if (objectAt.has(`${x},${y}`)) return null;
          const h = (x * 73 + y * 151 + 17) % 11;
          if (h > 3) return null;
          const c = at(x + 0.5 + ((h % 2) - 0.5) * 0.4, y + 0.5 + (h / 3 - 0.5) * 0.4);
          return h === 0 ? (
            <g key={`${x},${y}`}>
              <circle cx={c.px - 3} cy={c.py} r={2} fill="#fff7d6" />
              <circle cx={c.px + 3} cy={c.py + 1} r={2} fill="#fbcfe8" />
              <circle cx={c.px} cy={c.py - 2} r={1.6} fill="#fde68a" />
            </g>
          ) : (
            <path
              key={`${x},${y}`}
              d={`M${c.px - 4},${c.py + 2} l2,-6 l2,6 M${c.px},${c.py + 2} l2,-8 l2,8`}
              fill="none"
              stroke="#5fa847"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </g>

      <Fence segments={backFence} />

      {/* 置いたもの。足もとに影を付ける */}
      {sortedObjects.map((o) => {
        const item = TANE_ITEM_BY_ID.get(o.itemId);
        if (!item) return null;
        const c = at(o.x + 0.5, o.y + 0.5);
        return (
          <g key={o.objectId} pointerEvents="none">
            <ellipse cx={c.px} cy={c.py + 4} rx={15} ry={6} fill="#2f4a1f" opacity={0.22} />
            {item.imageUrl ? (
              <image href={item.imageUrl} x={c.px - 24} y={c.py - 42} width={48} height={48} />
            ) : (
              <text x={c.px} y={c.py + 3} fontSize={32} textAnchor="middle" filter={`url(#shadow-${uid})`}>
                {item.emoji}
              </text>
            )}
          </g>
        );
      })}

      <Fence segments={frontFence} />
    </svg>
  );
}

/** 木の柵。各区間の両端に杭を立て、横木2本でつなぐ */
function Fence({ segments }: { segments: [Point, Point][] }) {
  return (
    <g pointerEvents="none" strokeLinecap="round">
      {segments.map(([a, b], k) => (
        <g key={k}>
          <line x1={a.px} y1={a.py - FENCE_H} x2={b.px} y2={b.py - FENCE_H} stroke="#c9935e" strokeWidth={3} />
          <line x1={a.px} y1={a.py - FENCE_H / 2} x2={b.px} y2={b.py - FENCE_H / 2} stroke="#b07d4c" strokeWidth={3} />
          {[a, b].map((p, i) => (
            <g key={i}>
              <line x1={p.px} y1={p.py + 1} x2={p.px} y2={p.py - FENCE_H - 4} stroke="#8a6440" strokeWidth={4.5} />
              <circle cx={p.px} cy={p.py - FENCE_H - 4} r={2.4} fill="#e2b98a" />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

/** 丸い木。p が根もと */
function Tree({ p, scale = 1 }: { p: Point; scale?: number }) {
  const s = scale;
  return (
    <g transform={`translate(${p.px} ${p.py}) scale(${s})`}>
      <ellipse cx={0} cy={2} rx={18} ry={6} fill="#2f4a1f" opacity={0.18} />
      <rect x={-4} y={-26} width={8} height={28} rx={3} fill="#8a5a33" />
      <circle cx={0} cy={-44} r={22} fill="#4f9d3a" />
      <circle cx={-12} cy={-34} r={14} fill="#5fb045" />
      <circle cx={12} cy={-36} r={15} fill="#58a83f" />
      <circle cx={-5} cy={-54} r={11} fill="#77c45a" />
      <circle cx={6} cy={-48} r={5} fill="#9ad97c" opacity={0.8} />
    </g>
  );
}

/** 奥の角の家(斜め見下ろし)。島の外、奥の角のうしろに建てる。手前の2つの壁と、切妻の屋根 */
function IsoHouse({ at }: { at: (i: number, j: number, z?: number) => Point }) {
  const i0 = -2.6;
  const i1 = -0.4;
  const j0 = -2.6;
  const j1 = -0.4;
  const wall = 44;
  const roof = 30;
  const p = (i: number, j: number, z = 0) => {
    const q = at(i, j, z);
    return `${q.px},${q.py}`;
  };
  const jm = (j0 + j1) / 2;
  // 窓・戸は壁の上の点で描く(左の壁は j = j1 の面、右の壁は i = i1 の面)
  const leftQuad = (a: number, b: number, z0: number, z1: number) => `${p(a, j1, z0)} ${p(b, j1, z0)} ${p(b, j1, z1)} ${p(a, j1, z1)}`;
  const rightQuad = (a: number, b: number, z0: number, z1: number) => `${p(i1, a, z0)} ${p(i1, b, z0)} ${p(i1, b, z1)} ${p(i1, a, z1)}`;
  return (
    <g>
      {/* 壁 */}
      <polygon points={`${p(i0, j1)} ${p(i1, j1)} ${p(i1, j1, wall)} ${p(i0, j1, wall)}`} fill="#fff4dc" stroke="#d9b98c" strokeWidth={1.5} />
      <polygon points={`${p(i1, j1)} ${p(i1, j0)} ${p(i1, j0, wall)} ${p(i1, j1, wall)}`} fill="#f1dfbd" stroke="#d9b98c" strokeWidth={1.5} />
      {/* 屋根(奥の面。上から少し見える) */}
      <polygon points={`${p(i0 - 0.25, jm, wall + roof)} ${p(i1 + 0.25, jm, wall + roof)} ${p(i1 + 0.25, j0 - 0.3, wall - 4)} ${p(i0 - 0.25, j0 - 0.3, wall - 4)}`} fill="#c9573f" stroke="#b44a36" strokeWidth={1.5} strokeLinejoin="round" />
      {/* 右の壁の三角(切妻) */}
      <polygon points={`${p(i1, j1, wall)} ${p(i1, j0, wall)} ${p(i1, jm, wall + roof)}`} fill="#f1dfbd" stroke="#d9b98c" strokeWidth={1.5} />
      {/* 戸と窓 */}
      <polygon points={leftQuad(-1.75, -1.25, 0, 28)} fill="#a8744f" />
      <polygon points={leftQuad(-2.35, -1.95, 16, 32)} fill="#bfe3f5" stroke="#c9a77c" strokeWidth={1.5} />
      <polygon points={leftQuad(-1.05, -0.65, 16, 32)} fill="#bfe3f5" stroke="#c9a77c" strokeWidth={1.5} />
      <polygon points={rightQuad(-1.2, -1.8, 14, 30)} fill="#bfe3f5" stroke="#c9a77c" strokeWidth={1.5} />
      {/* 屋根(手前の面) と 煙突 */}
      <polygon points={`${p(i0 - 0.25, jm, wall + roof)} ${p(i1 + 0.25, jm, wall + roof)} ${p(i1 + 0.25, j1 + 0.3, wall - 4)} ${p(i0 - 0.25, j1 + 0.3, wall - 4)}`} fill="#e0694f" stroke="#b44a36" strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points={`${p(-2.0, -1.0, wall + 14)} ${p(-1.7, -1.0, wall + 14)} ${p(-1.7, -1.0, wall + 34)} ${p(-2.0, -1.0, wall + 34)}`} fill="#9f5f45" />
      {/* 屋根の棟 */}
      <line
        x1={at(i0 - 0.25, jm, wall + roof).px}
        y1={at(i0 - 0.25, jm, wall + roof).py}
        x2={at(i1 + 0.25, jm, wall + roof).px}
        y2={at(i1 + 0.25, jm, wall + roof).py}
        stroke="#b44a36"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
}
