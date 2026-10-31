"use client";

import { useId } from "react";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import type { GardenDesignId, GardenObject, HouseTierId } from "@/lib/game/chizuTane/garden";

// ガーデンの絵(斜め見下ろしのマス目)。土台の厚みのある島に、奥の角の家・木・柵を描く(飾りの絵で、置き場所のデータは変わらない)。
// design でガーデンのデザイン(地面・木・周りの色)、houseTier で家と柵の立派さ(ユーザーのレベルで決まる)が変わる。
// トップ画面では見るだけ、飾る画面ではマスをタップして編集する。見た目の一覧は管理画面 /admin/chizu-tane/gardens

const TILE_W = 64;
const TILE_H = 32;
const TOP = 216; // 奥の角の家と木、奥の列に置いた背の高いものが収まるよう、上に空ける(お屋敷の屋根の棟が入る高さ)
const SIDE = 22; // 土台の厚み

type TreeKind = "round" | "cherry" | "palm" | "conifer";

interface Theme {
  ground: [string, string];
  sideL: [string, string];
  sideR: [string, string];
  edge: string;
  tuft: string;
  /** 何も置いていないマスに、花を咲かせる割合(11 分の n) */
  flowers: number;
  flowerColors: [string, string, string];
  tree: TreeKind;
  /** 島の周りの水(海辺) */
  water?: boolean;
}

const THEMES: Record<GardenDesignId, Theme> = {
  home: {
    ground: ["#9fdc7c", "#7cc65e"],
    sideL: ["#b98a5a", "#8f6538"],
    sideR: ["#a47648", "#7a5430"],
    edge: "#6b4a29",
    tuft: "#5fa847",
    flowers: 1,
    flowerColors: ["#fff7d6", "#fbcfe8", "#fde68a"],
    tree: "round",
  },
  flower: {
    ground: ["#c4e89a", "#a3d67e"],
    sideL: ["#c99a6a", "#9c7046"],
    sideR: ["#b6855a", "#8a5f3a"],
    edge: "#7a5532",
    tuft: "#6cb24f",
    flowers: 5,
    flowerColors: ["#f9a8d4", "#fde047", "#c4b5fd"],
    tree: "cherry",
  },
  seaside: {
    ground: ["#f5e6b8", "#ead69c"],
    sideL: ["#e2c98d", "#c9ab6a"],
    sideR: ["#d6bb7c", "#b8995a"],
    edge: "#a8894f",
    tuft: "#8fbf6a",
    flowers: 1,
    flowerColors: ["#ffffff", "#fecdd3", "#fde68a"],
    tree: "palm",
    water: true,
  },
  forest: {
    ground: ["#7fbf63", "#5ea64c"],
    sideL: ["#8a6440", "#674627"],
    sideR: ["#7a5636", "#573b21"],
    edge: "#4a321c",
    tuft: "#3f8a37",
    flowers: 1,
    flowerColors: ["#fca5a5", "#ffffff", "#fde68a"],
    tree: "conifer",
  },
};

export interface GardenSvgProps {
  width: number;
  height: number;
  objects: GardenObject[];
  /** ガーデンのデザイン(省略するとおうちの庭) */
  design?: GardenDesignId;
  /** 家と柵の立派さ(省略すると家) */
  houseTier?: HouseTierId;
  /** 渡さなければ見るだけの絵にする */
  onTileClick?: (x: number, y: number) => void;
  selectedObjectId?: string | null;
  /** 置く・動かす先を選んでいる最中(空いているマスを明るくする) */
  placing?: boolean;
}

type Point = { px: number; py: number };
type At = (i: number, j: number, z?: number) => Point;

export default function GardenSvg({
  width,
  height,
  objects,
  design = "home",
  houseTier = "house",
  onTileClick,
  selectedObjectId = null,
  placing = false,
}: GardenSvgProps) {
  const uid = useId().replace(/:/g, "");
  const theme = THEMES[design];
  const viewW = (width + height) * (TILE_W / 2) + 24;
  const viewH = TOP + (width + height) * (TILE_H / 2) + SIDE + 16;
  const left = height * (TILE_W / 2) + 12;
  // 格子点(i, j)を高さ z だけ持ち上げた位置。i は x 方向、j は y 方向。マス(x, y)の真ん中は (x + 0.5, y + 0.5)
  const at: At = (i, j, z = 0) => ({
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
  const gatePosts: [Point, Point] = [at(width, gate), at(width, gate + 1)];

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-auto select-none" role="img" aria-label="ガーデン">
      <defs>
        <linearGradient id={`grass-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={theme.ground[0]} />
          <stop offset="1" stopColor={theme.ground[1]} />
        </linearGradient>
        <linearGradient id={`soilL-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={theme.sideL[0]} />
          <stop offset="1" stopColor={theme.sideL[1]} />
        </linearGradient>
        <linearGradient id={`soilR-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={theme.sideR[0]} />
          <stop offset="1" stopColor={theme.sideR[1]} />
        </linearGradient>
        <filter id={`shadow-${uid}`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#3d2b14" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* 島の下の影(海辺は水) */}
      {theme.water ? (
        <ellipse cx={(L.px + R.px) / 2} cy={B.py + SIDE - 6} rx={(R.px - L.px) / 1.9} ry={26} fill="#7dd3fc" opacity={0.55} />
      ) : (
        <ellipse cx={(L.px + R.px) / 2} cy={B.py + SIDE + 4} rx={(R.px - L.px) / 2.3} ry={10} fill="#3d2b14" opacity={0.12} />
      )}

      {/* 奥の木と家(島の外の奥) */}
      <g pointerEvents="none" filter={`url(#shadow-${uid})`}>
        <Tree kind={theme.tree} p={at(-1.1, 2.6)} scale={1.05} />
        <Tree kind={theme.tree} p={at(3.2, -1.2)} scale={0.95} />
        <IsoHouse at={at} tier={houseTier} />
        <Tree kind={theme.tree} p={at(-1.2, 5.6)} scale={0.8} />
        <Tree kind={theme.tree} p={at(6.4, -1.1)} scale={0.85} />
      </g>

      {/* 土台(側面) */}
      <polygon points={pts(L, B, down(B), down(L))} fill={`url(#soilL-${uid})`} />
      <polygon points={pts(B, R, down(R), down(B))} fill={`url(#soilR-${uid})`} />
      <polyline points={pts(down(L), down(B), down(R))} fill="none" stroke={theme.edge} strokeWidth={1.5} opacity={0.5} />

      {/* 地面のマス */}
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
          if (h > 3 + theme.flowers) return null;
          const c = at(x + 0.5 + ((h % 2) - 0.5) * 0.4, y + 0.5 + ((h % 3) / 3 - 0.3) * 0.4);
          const [f1, f2, f3] = theme.flowerColors;
          return h < theme.flowers ? (
            <g key={`${x},${y}`}>
              <circle cx={c.px - 3} cy={c.py} r={2} fill={f1} />
              <circle cx={c.px + 3} cy={c.py + 1} r={2} fill={f2} />
              <circle cx={c.px} cy={c.py - 2} r={1.6} fill={f3} />
            </g>
          ) : (
            <path
              key={`${x},${y}`}
              d={`M${c.px - 4},${c.py + 2} l2,-6 l2,6 M${c.px},${c.py + 2} l2,-8 l2,8`}
              fill="none"
              stroke={theme.tuft}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </g>

      <Fence segments={backFence} tier={houseTier} />

      {/* 置いたもの。足もとに影を付ける。絵はマスより上にはみ出すので、絵をタップしてもそのマスをタップしたことにする
          (マスにだけ反応させると、絵を押したつもりで奥の空いたマスを押してしまい、選べない・しまえない) */}
      {sortedObjects.map((o) => {
        const item = TANE_ITEM_BY_ID.get(o.itemId);
        if (!item) return null;
        const c = at(o.x + 0.5, o.y + 0.5);
        return (
          <g
            key={o.objectId}
            pointerEvents={onTileClick ? "visiblePainted" : "none"}
            onClick={onTileClick ? () => onTileClick(o.x, o.y) : undefined}
            className={onTileClick ? "cursor-pointer" : undefined}
          >
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

      <Fence segments={frontFence} tier={houseTier} />
      <GatePosts posts={gatePosts} tier={houseTier} />
    </svg>
  );
}

// ─── 柵(家の段階で立派になる) ──────────────────────────────────────────────
// 小屋: 低い杭と縄 / 家: 木の柵 / 2階建て: 白い柵 / お屋敷: 石の塀

function Fence({ segments, tier }: { segments: [Point, Point][]; tier: HouseTierId }) {
  return (
    <g pointerEvents="none" strokeLinecap="round">
      {segments.map(([a, b], k) => (
        <FenceSegment key={k} a={a} b={b} tier={tier} />
      ))}
    </g>
  );
}

function FenceSegment({ a, b, tier }: { a: Point; b: Point; tier: HouseTierId }) {
  if (tier === "hut") {
    const h = 9;
    return (
      <g>
        <path d={`M${a.px},${a.py - h} Q${(a.px + b.px) / 2},${(a.py + b.py) / 2 - h + 4} ${b.px},${b.py - h}`} fill="none" stroke="#c8a878" strokeWidth={1.5} />
        {[a, b].map((p, i) => (
          <line key={i} x1={p.px} y1={p.py + 1} x2={p.px} y2={p.py - h - 2} stroke="#8a6440" strokeWidth={3} />
        ))}
      </g>
    );
  }
  if (tier === "twostory") {
    const h = 15;
    const pickets = [0.25, 0.5, 0.75].map((t) => ({ px: a.px + (b.px - a.px) * t, py: a.py + (b.py - a.py) * t }));
    return (
      <g>
        <line x1={a.px} y1={a.py - h + 3} x2={b.px} y2={b.py - h + 3} stroke="#e7e5e4" strokeWidth={2.5} />
        <line x1={a.px} y1={a.py - 5} x2={b.px} y2={b.py - 5} stroke="#e7e5e4" strokeWidth={2.5} />
        {[a, ...pickets, b].map((p, i) => (
          <path key={i} d={`M${p.px - 1.8},${p.py + 1} L${p.px - 1.8},${p.py - h} L${p.px},${p.py - h - 3} L${p.px + 1.8},${p.py - h} L${p.px + 1.8},${p.py + 1} Z`} fill="#ffffff" stroke="#d6d3d1" strokeWidth={0.8} />
        ))}
      </g>
    );
  }
  if (tier === "mansion") {
    const h = 16;
    return (
      <g>
        <polygon points={`${a.px},${a.py + 1} ${b.px},${b.py + 1} ${b.px},${b.py - h} ${a.px},${a.py - h}`} fill="#d6d3d1" stroke="#a8a29e" strokeWidth={1} />
        <line x1={a.px} y1={a.py - h / 2} x2={b.px} y2={b.py - h / 2} stroke="#a8a29e" strokeWidth={0.8} />
        <polygon points={`${a.px},${a.py - h} ${b.px},${b.py - h} ${b.px},${b.py - h - 3} ${a.px},${a.py - h - 3}`} fill="#a8a29e" />
      </g>
    );
  }
  const h = 13;
  return (
    <g>
      <line x1={a.px} y1={a.py - h} x2={b.px} y2={b.py - h} stroke="#c9935e" strokeWidth={3} />
      <line x1={a.px} y1={a.py - h / 2} x2={b.px} y2={b.py - h / 2} stroke="#b07d4c" strokeWidth={3} />
      {[a, b].map((p, i) => (
        <g key={i}>
          <line x1={p.px} y1={p.py + 1} x2={p.px} y2={p.py - h - 4} stroke="#8a6440" strokeWidth={4.5} />
          <circle cx={p.px} cy={p.py - h - 4} r={2.4} fill="#e2b98a" />
        </g>
      ))}
    </g>
  );
}

/** 門の柱(2階建て・お屋敷だけ立派な門柱を立てる) */
function GatePosts({ posts, tier }: { posts: [Point, Point]; tier: HouseTierId }) {
  if (tier !== "twostory" && tier !== "mansion") return null;
  const h = tier === "mansion" ? 26 : 20;
  const color = tier === "mansion" ? "#a8a29e" : "#ffffff";
  return (
    <g pointerEvents="none">
      {posts.map((p, i) => (
        <g key={i}>
          <rect x={p.px - 4} y={p.py - h} width={8} height={h + 1} fill={color} stroke="#78716c" strokeWidth={0.8} />
          {tier === "mansion" && <circle cx={p.px} cy={p.py - h - 3} r={3.5} fill="#fbbf24" stroke="#b45309" strokeWidth={0.8} />}
        </g>
      ))}
    </g>
  );
}

// ─── 木(ガーデンのデザインで変わる) ────────────────────────────────────────

/** p が根もと */
function Tree({ kind, p, scale = 1 }: { kind: TreeKind; p: Point; scale?: number }) {
  return (
    <g transform={`translate(${p.px} ${p.py}) scale(${scale})`}>
      <ellipse cx={0} cy={2} rx={18} ry={6} fill="#2f4a1f" opacity={0.18} />
      {kind === "conifer" ? (
        <>
          <rect x={-3.5} y={-16} width={7} height={18} rx={2} fill="#7a4e2c" />
          <polygon points="0,-78 -20,-30 20,-30" fill="#2f7a3a" />
          <polygon points="0,-62 -24,-14 24,-14" fill="#3a8d45" />
          <polygon points="0,-88 -14,-52 14,-52" fill="#4ca356" />
        </>
      ) : kind === "palm" ? (
        <>
          <path d="M0,2 C4,-20 -2,-40 6,-62" fill="none" stroke="#a0703f" strokeWidth={6} strokeLinecap="round" />
          {[
            [-34, -52],
            [32, -50],
            [-26, -74],
            [24, -76],
            [4, -82],
          ].map(([dx, dy], i) => (
            <path key={i} d={`M6,-62 Q${(6 + dx) / 2},${dy - 14} ${dx},${dy}`} fill="none" stroke="#3f9b45" strokeWidth={7} strokeLinecap="round" />
          ))}
          <circle cx={3} cy={-60} r={3} fill="#7a4e2c" />
          <circle cx={9} cy={-59} r={3} fill="#7a4e2c" />
        </>
      ) : (
        <>
          <rect x={-4} y={-26} width={8} height={28} rx={3} fill="#8a5a33" />
          {kind === "cherry" ? (
            <>
              <circle cx={0} cy={-44} r={22} fill="#f4a7c3" />
              <circle cx={-12} cy={-34} r={14} fill="#f7bad0" />
              <circle cx={12} cy={-36} r={15} fill="#f29bb9" />
              <circle cx={-5} cy={-54} r={11} fill="#fbd0df" />
              <circle cx={6} cy={-48} r={5} fill="#ffffff" opacity={0.7} />
            </>
          ) : (
            <>
              <circle cx={0} cy={-44} r={22} fill="#4f9d3a" />
              <circle cx={-12} cy={-34} r={14} fill="#5fb045" />
              <circle cx={12} cy={-36} r={15} fill="#58a83f" />
              <circle cx={-5} cy={-54} r={11} fill="#77c45a" />
              <circle cx={6} cy={-48} r={5} fill="#9ad97c" opacity={0.8} />
            </>
          )}
        </>
      )}
    </g>
  );
}

// ─── 家(家の段階で立派になる) ──────────────────────────────────────────────

interface HouseStyle {
  /** 奥の角のうしろに建てる範囲(格子点) */
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  wall: number;
  roof: number;
  floors: 1 | 2;
  wallL: string;
  wallR: string;
  stroke: string;
  roofBack: string;
  roofFront: string;
  roofStroke: string;
  chimney: boolean;
  door: string;
}

const HOUSE_STYLES: Record<HouseTierId, HouseStyle> = {
  // 小さな木の小屋(煙突なし)
  hut: {
    i0: -2.2, i1: -0.5, j0: -2.2, j1: -0.5, wall: 32, roof: 24, floors: 1,
    wallL: "#d9b38a", wallR: "#c49a6e", stroke: "#9c7650", roofBack: "#a0743f", roofFront: "#b8874e", roofStroke: "#7d5a30", chimney: false, door: "#7a5232",
  },
  // ふつうの家(今までの絵)
  house: {
    i0: -2.6, i1: -0.4, j0: -2.6, j1: -0.4, wall: 44, roof: 30, floors: 1,
    wallL: "#fff4dc", wallR: "#f1dfbd", stroke: "#d9b98c", roofBack: "#c9573f", roofFront: "#e0694f", roofStroke: "#b44a36", chimney: true, door: "#a8744f",
  },
  // 2階建て(青い屋根)
  twostory: {
    i0: -2.8, i1: -0.4, j0: -2.8, j1: -0.4, wall: 70, roof: 32, floors: 2,
    wallL: "#fefce8", wallR: "#f1ecd2", stroke: "#cfc6a4", roofBack: "#3f6fb0", roofFront: "#4f86cc", roofStroke: "#2f5890", chimney: true, door: "#8b5e3c",
  },
  // お屋敷(大きく、濃い屋根)
  mansion: {
    i0: -3.4, i1: -0.3, j0: -3.4, j1: -0.3, wall: 78, roof: 38, floors: 2,
    wallL: "#fff7ed", wallR: "#f3e3cf", stroke: "#c9a77c", roofBack: "#4b3a5a", roofFront: "#5f4a72", roofStroke: "#3a2c47", chimney: true, door: "#6b3f22",
  },
};

/** 奥の角の家(斜め見下ろし)。島の外、奥の角のうしろに建てる。手前の2つの壁と、切妻の屋根 */
function IsoHouse({ at, tier }: { at: At; tier: HouseTierId }) {
  const st = HOUSE_STYLES[tier];
  const { i0, i1, j0, j1, wall, roof } = st;
  const p = (i: number, j: number, z = 0) => {
    const q = at(i, j, z);
    return `${q.px},${q.py}`;
  };
  const jm = (j0 + j1) / 2;
  const leftQuad = (a: number, b: number, z0: number, z1: number) => `${p(a, j1, z0)} ${p(b, j1, z0)} ${p(b, j1, z1)} ${p(a, j1, z1)}`;
  const rightQuad = (a: number, b: number, z0: number, z1: number) => `${p(i1, a, z0)} ${p(i1, b, z0)} ${p(i1, b, z1)} ${p(i1, a, z1)}`;
  const w = i1 - i0;
  const d = j1 - j0;
  // 窓は階ごとに並べる(左の壁に2つ、右の壁に1つ)
  const floorZ = st.floors === 2 ? [14, 14 + wall / 2] : [16];
  const winH = st.floors === 2 ? 14 : 16;
  const glass = { fill: "#bfe3f5", stroke: st.stroke, strokeWidth: 1.5 };
  return (
    <g>
      {/* 壁 */}
      <polygon points={`${p(i0, j1)} ${p(i1, j1)} ${p(i1, j1, wall)} ${p(i0, j1, wall)}`} fill={st.wallL} stroke={st.stroke} strokeWidth={1.5} />
      <polygon points={`${p(i1, j1)} ${p(i1, j0)} ${p(i1, j0, wall)} ${p(i1, j1, wall)}`} fill={st.wallR} stroke={st.stroke} strokeWidth={1.5} />
      {st.floors === 2 && (
        <polyline points={`${p(i0, j1, wall / 2)} ${p(i1, j1, wall / 2)} ${p(i1, j0, wall / 2)}`} fill="none" stroke={st.stroke} strokeWidth={2} />
      )}
      {/* 屋根(奥の面) */}
      <polygon
        points={`${p(i0 - 0.25, jm, wall + roof)} ${p(i1 + 0.25, jm, wall + roof)} ${p(i1 + 0.25, j0 - 0.3, wall - 4)} ${p(i0 - 0.25, j0 - 0.3, wall - 4)}`}
        fill={st.roofBack}
        stroke={st.roofStroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* 右の壁の三角(切妻) */}
      <polygon points={`${p(i1, j1, wall)} ${p(i1, j0, wall)} ${p(i1, jm, wall + roof)}`} fill={st.wallR} stroke={st.stroke} strokeWidth={1.5} />
      {/* 戸と窓 */}
      <polygon points={leftQuad(i0 + w * 0.4, i0 + w * 0.62, 0, Math.min(28, wall * 0.6))} fill={st.door} />
      {floorZ.map((z, k) => (
        <g key={k}>
          {(k === 0 ? [0.12, 0.76] : [0.12, 0.44, 0.76]).map((t, n) => (
            <polygon key={n} points={leftQuad(i0 + w * t, i0 + w * (t + 0.16), z, z + winH)} {...glass} />
          ))}
          <polygon points={rightQuad(j1 - d * 0.36, j1 - d * 0.64, z - 2, z - 2 + winH)} {...glass} />
        </g>
      ))}
      {/* 屋根(手前の面) と 煙突 */}
      <polygon
        points={`${p(i0 - 0.25, jm, wall + roof)} ${p(i1 + 0.25, jm, wall + roof)} ${p(i1 + 0.25, j1 + 0.3, wall - 4)} ${p(i0 - 0.25, j1 + 0.3, wall - 4)}`}
        fill={st.roofFront}
        stroke={st.roofStroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {st.chimney && (
        <polygon
          points={`${p(i0 + w * 0.27, jm + 0.6, wall + 14)} ${p(i0 + w * 0.4, jm + 0.6, wall + 14)} ${p(i0 + w * 0.4, jm + 0.6, wall + 36)} ${p(i0 + w * 0.27, jm + 0.6, wall + 36)}`}
          fill="#9f5f45"
        />
      )}
      {/* 屋根の棟(お屋敷は金の飾り) */}
      <line
        x1={at(i0 - 0.25, jm, wall + roof).px}
        y1={at(i0 - 0.25, jm, wall + roof).py}
        x2={at(i1 + 0.25, jm, wall + roof).px}
        y2={at(i1 + 0.25, jm, wall + roof).py}
        stroke={tier === "mansion" ? "#fbbf24" : st.roofStroke}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
}
