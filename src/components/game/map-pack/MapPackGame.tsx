"use client";

// 地図ポットン: 地域(都道府県/市区町村/町丁)のピースを箱に落とし、隣接する地域同士が触れたら
// 実際の地図上の位置関係のまま1つに固まる。全ピースが1つに固まったら完成。
// 物理演算は Matter.js、描画は canvas に自前で行う(Matter.Render は使わない)。

import Matter from "matter-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildAreaData, simplifyRing, type AreaData, type Point } from "@/lib/game/mapPack/regions";
import { clearShapeCache, regionConvexParts } from "@/lib/game/mapPack/shapes";
import {
  currentUserId,
  mapPackAreaRankingHref,
  submitMapPackChallenge,
  type MapPackArea,
} from "@/lib/game/mapPackData";

// ===== 箱とワールド(物理演算の座標系、1単位 ≒ 表示幅に応じて拡縮) =====
const BW = 300, BH = 420;
const MARGIN = 16;
const TOP = 110;                      // 箱の上の、次のピースを構えるスペース
const W = BW + MARGIN * 2, H = TOP + BH + 12;
const BOX_L = MARGIN, BOX_R = MARGIN + BW, RIM_Y = TOP, FLOOR_Y = TOP + BH;
const WALL_T = 200;                   // 壁・床の厚み(すり抜け防止)
const WALL_H = 4000;                  // あふれても終了しないので、壁は上方向に十分高くしておく

// ===== ピースの大きさ =====
// 一辺 ∝ 面積^SIZE_EXP。0.5未満なので、合体したピースは元の合計より小さくなり箱に隙間ができる
const SIZE_EXP = 0.35;
const MERGED_MAX = 0.9;               // 合体ピース(完成形を含む)の直径は箱の幅の90%まで
// ピースの大きさの基準: 全ピースをばらばらのまま並べたときの面積の合計が、箱の面積のこの割合になるようにする。
// ピース数が多いエリア(小田原市の町丁196、北海道の市区町村188など)でも箱からあふれすぎず、少ないエリアでは大きく見える。
// (最初は「全地域が固まった完成形が箱に収まる」大きさを基準にしたが、日本列島のように細長い地図だと
//  ピースが極端に小さくなったため不採用。完成形・合体ピースは buildPiece で MERGED_MAX に収まるよう個別に縮める)
const FILL_RATIO = 0.5;
const MIN_SIDE = 12;                  // 小さい地域でも見える・当たる大きさを確保する
const PHYS_TOL = 2;                   // 物理形状の許容誤差(ワールド単位)。ピース数が多いエリアの負荷を抑えるため粗め
const DRAW_TOL = 0.4;                 // 描画用の間引きの許容誤差(ワールド単位)
// 合体したピースの中の地域は、一辺がこれ以上なら小さめの文字でラベルを描く(単独のピースは常に描く)。
// 最初は26にしていたが、合体すると地名がほとんど消えてどこにくっつければいいか分からなくなったため下げた
const LABEL_MIN = 14;
const LABEL_FONT: [number, number] = [6.5, 9]; // ラベルの文字の大きさ(ワールド単位)の範囲
// スマホでスクロールせずに遊べるよう、箱を画面の高さにも収める。サイト共通ヘッダー・タイトル行・HUD・ボタンの分の高さ(px)
const RESERVED_HEIGHT_PX = 230;

// ===== ピースの弾み =====
// 一辺が BOUNCY_SIDE_MAX 未満のピースは、小さいほど反発係数を上げる。
// 止まっているピースは大きさを問わず時々ポンと跳ねる(合体したピースが固まったまま動かなくなるのを防ぐ)。
// 小さいピースほど高く・頻繁に、大きいピースほど低く・まれに跳ねる
const BOUNCY_SIDE_MAX = 30;
const RESTITUTION_MIN = 0.05, RESTITUTION_MAX = 0.6;
const HOP_INTERVAL_MS: [number, number] = [1000, 3500]; // 最も小さいピースの間隔。大きいピースは最大2倍まで延びる
// 上向きの初速(大きいピース 〜 最も小さいピース)。重力1.3では初速vで約 v²/0.72 だけ浮く(3.5で約17、5.5で約42)
const HOP_UP: [number, number] = [3.5, 5.5];
const HOP_SIDE = 1.5;                        // 横方向の初速の最大
// 回転の初速(ラジアン/ステップ)の範囲。向きはランダムで、ほぼ回らないハズレが出ないよう下限を設ける
const HOP_SPIN: [number, number] = [0.08, 0.16];
// これより遅ければ「落下中ではない」とみなして跳ねさせる。積み重なったピースはプルプル揺れて速度0にならないため、
// 揺れは含めて落下・跳躍中だけを除外できる値にする(落下中は3〜7程度)
const HOP_REST_SPEED = 1.5;

// ===== 積み直す(合体が止まったとき用) =====
// 箱の中のピースを全部取り出し、ランダムな順番で1つずつ時間差で落とし直す。
// 落とす位置は RESTACK_AIM の確率で、箱の中にある隣接地域の真上に寄せる(積み直すたびに合体が起きやすくなる)。
// 不採用にした方式: 全ピースを同時に跳ね上げる/まとめて上に積んで同時に降らせる → どちらも同じ速さで
// まとまって落ちるため並びがほとんど変わらなかった
const RESTACK_INTERVAL_MS = 150;
const RESTACK_AIM = 0.7;
const RESTACK_PENALTY = 50;
const SPAWN_GAP = 4;                  // 落とす・落とし直すピースを、真下のピースからこれだけ離して出現させる

// ===== まとめて落とす =====
// ピース数が多いエリア(900ピース近い市区町村もある)で、1つずつ落とすだけで一苦労なため、
// 次の何個かをバラバラのまま続けて落とせるようにする(あらかじめくっつけて落とす案はユーザーが不採用)。
// 個数はエリアのピース数で決める。250個未満はボタンを出さない
const BATCH_SIZES: [minPieces: number, size: number][] = [[1000, 20], [750, 15], [500, 10], [250, 5]];
const batchSizeFor = (pieces: number) => BATCH_SIZES.find(([min]) => pieces >= min)?.[1] ?? 0;
const BATCH_INTERVAL_MS = 120;
const BATCH_SPREAD = 0.3;             // 狙った位置から左右に、箱の幅のこの割合まで散らす

// ===== 物理・進行 =====
const STEP_MS = 1000 / 60;
const SUBSTEPS = 3;
const GRAVITY = 1.3;
const DROP_WAIT_MS = 600;             // 落としてから次のピースが出るまで
const NEIGHBOR_BIAS = 0.6;            // 箱の中の地域に隣接する地域を優先して出す確率
// 大きすぎる地域・歪な地域は、ふつうの地域を出し終わってから出す(序盤から箱を塞がないように)。
// 面積の大きい順・歪な順(円形度 4π×面積÷周長² の低い順)にそれぞれこの割合を後回しにする
const DEFER_LARGE_RATIO = 0.15;
const DEFER_IRREGULAR_RATIO = 0.15;

// ===== くっつく相手の引き上げ =====
// 落とす位置の線(点線)に重なっている、くっつく相手のピースを上に引っ張り上げる。
// 相手が山の下の方に埋まっていると、上から落としても届かずくっつけられないため(試遊での指摘)。
// 引っ張るのは狙っている間だけで、落とした(指を離した)瞬間にやめる(ユーザー指示)
const LIFT_FACTOR = 2.2;              // 重力の何倍の上向きの力をかけるか(1を超えた分だけ浮く)
const LIFT_STOP_BELOW_RIM = 30;       // 箱の縁からこの距離より上まで来たら引っ張るのをやめる(飛び出さないように)
const LIFT_MAX_UP_SPEED = 1;          // 上向きの速さがこれを超えていれば力をかけない(勢いがつきすぎないように)
const LIFT_PAUSE_AFTER_RESTACK_MS = 1000; // 積み直しで最後のピースを落としてから、引き上げを再開するまで
const FLASH_MS = 450;
const POPUP_MS = 900;

// ===== 得点 =====
// 合体1回ごとに「合体後のピースの地域数 × MERGE_POINT」。大きなかたまりに足していくほど伸びる。
// 得点 = max(0, 合体の点 - 積み直し回数 × RESTACK_PENALTY) + 完成ボーナス。
// DB側(supabase/migrations/20261019000000_map_pack_schema.sql のトリガー)でも同じ式で計算し直すので、変えるときは両方そろえること
const MERGE_POINT = 10;
const CLEAR_BONUS = 1000;
const TIME_BONUS_SEC = 300;           // 完成までこの秒数を切った分だけ、1秒あたり TIME_BONUS_PER_SEC 点
const TIME_BONUS_PER_SEC = 5;

type RegionPart = Matter.Body & { regionId?: number };

type Piece = {
  body: Matter.Body;
  regionIds: number[];
  area: number;
  cx: number;
  cy: number;
  scale: number;
  /** ピースのローカル座標系(角度0)での剛体の重心位置 */
  origin: { x: number; y: number };
  /** regionIds と同じ順番の、地域ごとの輪郭 */
  paths: Path2D[];
  /** regionIds と同じ順番の、地域ごとの重心(ピースのローカル座標) */
  centers: { x: number; y: number }[];
  labels: { text: string; x: number; y: number; size: number }[];
  /** 弾みやすさ(0: 弾まない 〜 1: 最も小さいピース) */
  bounciness: number;
  /** 次にポンと跳ねてよい時刻(0なら未設定) */
  nextHopAt: number;
  fill: string;
  stroke: string;
};

type HoverInfo = { name: string; index: number; total: number };

type Hud = {
  dropped: number;
  total: number;
  largest: number;
  score: number;
  hover: HoverInfo | null;
};

type Submit =
  | { status: "sending" }
  | { status: "guest" }
  | { status: "done"; isNewBest: boolean }
  | { status: "error"; message: string };

type Result = {
  kind: "clear" | "giveup";
  score: number;
  /** 完成時のボーナス(クリアボーナス+タイムボーナス)。あきらめた場合は0 */
  bonus: number;
  sec: number;
  largest: number;
};

const GROUP_HUE_STEP = 137.508; // 黄金角で町名ごとの色相を散らす

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type MapPackGameProps = {
  geojsonUrl: string;
  areaLabel: string;
  /** 地域名が入っている geojson のプロパティ名 */
  nameKey: string;
  /** 「町丁」「市区町村」「都道府県」など、ピース1つの呼び方 */
  unitLabel: string;
  /** ランキングの集計単位 */
  area: MapPackArea;
};

export default function MapPackGame({ geojsonUrl, nameKey, ...rest }: MapPackGameProps) {
  const [data, setData] = useState<AreaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(geojsonUrl)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((json) => {
        if (cancelled) return;
        clearShapeCache();
        setData(buildAreaData(json, nameKey));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [geojsonUrl, nameKey]);

  if (error) return <p className="text-center text-sm text-red-600 py-10">地図データを読み込めませんでした（{error}）</p>;
  if (!data) return <p className="text-center text-sm text-[#a8937a] py-10">地図データを読み込み中…</p>;
  return <MapPackBoard key={round} data={data} {...rest} onRestart={() => setRound((r) => r + 1)} />;
}

type BoardProps = Omit<MapPackGameProps, "geojsonUrl" | "nameKey"> & { data: AreaData; onRestart: () => void };

function MapPackBoard({ data, areaLabel, unitLabel, area, onRestart }: BoardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({ dropped: 0, total: data.regions.length, largest: 0, score: 0, hover: null });
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [submit, setSubmit] = useState<Submit | null>(null);
  const giveUpRef = useRef<() => void>(() => {});
  /** 積み直しを始め、全ピースを落とし終えるまでの見込み時間(ms)を返す */
  const restackRef = useRef<() => number>(() => 0);
  const [restacking, setRestacking] = useState(false);
  const batchRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { regions, adjacency, groups } = data;
    const groupOf = new Map<number, number>();
    groups.forEach((ids, g) => ids.forEach((id) => groupOf.set(id, g)));

    // ----- ピースの大きさの係数(一辺 = sizeK × 面積^SIZE_EXP)。FILL_RATIO 参照 -----
    const sizeK = Math.sqrt((FILL_RATIO * BW * BH) / regions.reduce((s, r) => s + Math.pow(r.area, 2 * SIZE_EXP), 0));

    // ----- 物理ワールド -----
    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
    const wallOpts = { isStatic: true, friction: 0.5 };
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(W / 2, FLOOR_Y + WALL_T / 2, W + WALL_T * 2, WALL_T, wallOpts),
      Matter.Bodies.rectangle(BOX_L - WALL_T / 2, FLOOR_Y - WALL_H / 2, WALL_T, WALL_H, wallOpts),
      Matter.Bodies.rectangle(BOX_R + WALL_T / 2, FLOOR_Y - WALL_H / 2, WALL_T, WALL_H, wallOpts),
    ]);

    const pieces = new Map<number, Piece>(); // body.id → 箱の中のピース
    let hover: Piece | null = null;
    let hoverInfo: HoverInfo | null = null;
    /** 今落とそうとしているピースとくっつく(隣接する)地域。箱の中で光らせて地名も出す */
    let hoverTargets = new Set<number>();
    /** 今のピースが出てから、プレイヤーが指(マウス)を動かして狙ったか */
    let aimedSinceSpawn = false;
    let aimX = W / 2;
    let nextHoverAt = 0;
    let dropped = 0;
    let startAt: number | null = null;
    let mergePoints = 0;
    let restacks = 0;
    let bonus = 0;
    const currentScore = () => Math.max(0, mergePoints - restacks * RESTACK_PENALTY) + bonus;
    let ended = false; // 完成またはあきらめた
    const flashes: { x: number; y: number; r: number; at: number }[] = [];
    const popups: { x: number; y: number; text: string; at: number }[] = [];
    let pending: [Matter.Body, Matter.Body][] = [];

    // ----- ピースの構築 -----
    function buildPiece(regionIds: number[], angle: number): Piece {
      const regs = regionIds.map((id) => regions[id]);
      const area = regs.reduce((s, r) => s + r.area, 0);
      const cx = regs.reduce((s, r) => s + r.cx * r.area, 0) / area;
      const cy = regs.reduce((s, r) => s + r.cy * r.area, 0) / area;
      let rMax = 0;
      for (const r of regs) for (const ring of r.rings) for (const [x, y] of ring) rMax = Math.max(rMax, Math.hypot(x - cx, y - cy));
      let scale = sizeK * Math.pow(area, SIZE_EXP - 0.5);
      scale = Math.max(scale, MIN_SIDE / Math.sqrt(area));
      scale = Math.min(scale, (MERGED_MAX * BW) / (2 * rMax));

      const toLocal = ([x, y]: Point) => ({ x: (x - cx) * scale, y: (y - cy) * scale });
      const parts: Matter.Body[] = [];
      for (const r of regs) {
        for (const poly of regionConvexParts(r, scale, PHYS_TOL)) {
          const verts = poly.map(toLocal);
          if (Matter.Vertices.area(verts, false) < 0.3) continue; // 極小の破片は物理演算を不安定にするので捨てる
          const part: RegionPart = Matter.Body.create({ position: Matter.Vertices.centre(verts), vertices: verts });
          part.regionId = r.id;
          parts.push(part);
        }
      }
      if (!parts.length) {
        // 全パーツが極小で捨てられた場合は外周の凸包1つで代用する
        // 型定義上は Vertex[] を要求するが、実装は x/y しか参照しない
        const verts = Matter.Vertices.hull(regs.flatMap((r) => r.rings.flat().map(toLocal)) as Matter.Vertex[]);
        const part: RegionPart = Matter.Body.create({ position: Matter.Vertices.centre(verts), vertices: verts });
        part.regionId = regs[0].id;
        parts.push(part);
      }
      const side = Math.sqrt(area) * scale;
      const bounciness = Math.min(1, Math.max(0, (BOUNCY_SIDE_MAX - side) / (BOUNCY_SIDE_MAX - MIN_SIDE)));
      const restitution = RESTITUTION_MIN + (RESTITUTION_MAX - RESTITUTION_MIN) * bounciness;
      const body = Matter.Body.create({ parts, friction: 0.5, frictionStatic: 0.8, restitution, frictionAir: 0.012 });
      const origin = { x: body.position.x, y: body.position.y };

      const paths = regs.map((r) => {
        const path = new Path2D();
        for (const ring of r.rings) {
          simplifyRing(ring, DRAW_TOL / scale).forEach((p, i) => {
            const v = toLocal(p);
            if (i === 0) path.moveTo(v.x - origin.x, v.y - origin.y);
            else path.lineTo(v.x - origin.x, v.y - origin.y);
          });
          path.closePath();
        }
        return path;
      });

      const centers = regs.map((r) => {
        const v = toLocal([r.cx, r.cy]);
        return { x: v.x - origin.x, y: v.y - origin.y };
      });

      // 同じ名前が複数含まれる場合は一番大きい区画にだけラベルを付ける
      const biggestByName = new Map<string, number>();
      regs.forEach((r, i) => {
        const cur = biggestByName.get(r.name);
        if (cur === undefined || r.area > regs[cur].area) biggestByName.set(r.name, i);
      });
      const labels = [...biggestByName.values()]
        .map((i) => ({ i, side: Math.sqrt(regs[i].area) * scale }))
        .filter(({ side }) => regs.length === 1 || side >= LABEL_MIN)
        .map(({ i, side }) => ({
          text: regs[i].name,
          ...centers[i],
          size: regs.length === 1 ? LABEL_FONT[1] : Math.min(LABEL_FONT[1], Math.max(LABEL_FONT[0], side * 0.3)),
        }));

      const groupIds = new Set(regionIds.map((id) => groupOf.get(id)!));
      let fill: string, stroke: string;
      if (groupIds.size === 1) {
        const hue = ([...groupIds][0] * GROUP_HUE_STEP) % 360;
        fill = `hsl(${hue} 60% 80%)`;
        stroke = `hsl(${hue} 35% 45%)`;
      } else {
        // 合体済みは大きくなるほど濃い緑にして、完成に近づいていく様子を見せる
        const t = regionIds.length / regions.length;
        fill = `hsl(${150 - 20 * t} 45% ${78 - 22 * t}%)`;
        stroke = `hsl(${150 - 20 * t} 40% 30%)`;
      }

      Matter.Body.setAngle(body, angle);
      return { body, regionIds, area, cx, cy, scale, origin, paths, centers, labels, bounciness, nextHopAt: 0, fill, stroke };
    }

    /** ピース上の地理座標(メートル)が今ワールドのどこにあるか */
    function worldOf(piece: Piece, x: number, y: number) {
      const lx = (x - piece.cx) * piece.scale - piece.origin.x;
      const ly = (y - piece.cy) * piece.scale - piece.origin.y;
      const c = Math.cos(piece.body.angle), s = Math.sin(piece.body.angle);
      return { x: piece.body.position.x + lx * c - ly * s, y: piece.body.position.y + lx * s + ly * c };
    }

    function keepInsideBox(body: Matter.Body) {
      const b = body.bounds;
      let dx = 0, dy = 0;
      if (b.min.x < BOX_L) dx = BOX_L - b.min.x + 0.5;
      else if (b.max.x > BOX_R) dx = BOX_R - b.max.x - 0.5;
      if (b.max.y > FLOOR_Y) dy = FLOOR_Y - b.max.y - 0.5;
      if (dx || dy) Matter.Body.translate(body, { x: dx, y: dy });
    }

    // ----- 出題順: 同じ名前は連続で出す。名前の選び方は箱の中に隣接するものを優先する -----
    const remainingGroups = new Set(groups.map((_, g) => g));

    // 後回しにする名前のまとまり。同じ名前は連続で出すので、まとまり単位で「一番大きい区画の面積」
    // 「一番歪な区画の円形度」を比べる(区画単位で選ぶと、区画の多い町名がまとめて後回しになり、
    // 小田原市では196ピース中93ピースが後回しになってしまった)
    const deferredGroups = (() => {
      const roundness = regions.map((r) => {
        let perimeter = 0;
        for (const ring of r.rings) ring.forEach((p, i) => {
          const q = ring[(i + 1) % ring.length];
          perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]);
        });
        return perimeter ? (4 * Math.PI * r.area) / perimeter ** 2 : 1;
      });
      const maxArea = groups.map((ids) => Math.max(...ids.map((id) => regions[id].area)));
      const minRound = groups.map((ids) => Math.min(...ids.map((id) => roundness[id])));
      const idx = groups.map((_, g) => g);
      const deferred = new Set<number>();
      // 上限はピース数で数える(区画の多い町名は1つ選ぶだけでピースが一気に増えるため)
      const take = (order: number[], ratio: number) => {
        let budget = Math.floor(regions.length * ratio);
        for (const g of order) {
          if (deferred.has(g)) continue;
          if (groups[g].length > budget) break;
          deferred.add(g);
          budget -= groups[g].length;
        }
      };
      take(idx.slice().sort((a, b) => maxArea[b] - maxArea[a]), DEFER_LARGE_RATIO);
      take(idx.slice().sort((a, b) => minRound[a] - minRound[b]), DEFER_IRREGULAR_RATIO);
      return deferred;
    })();
    let queue: number[] = [];
    let queueGroupSize = 0;

    function nextRegion(): { id: number; info: HoverInfo } | null {
      if (!queue.length) {
        if (!remainingGroups.size) return null;
        const placed = new Set<number>();
        for (const p of pieces.values()) p.regionIds.forEach((id) => placed.add(id));
        const normal = [...remainingGroups].filter((g) => !deferredGroups.has(g));
        const rest = normal.length ? normal : [...remainingGroups];
        const near = rest.filter((g) => groups[g].some((id) => [...adjacency[id]].some((o) => placed.has(o))));
        const pool = near.length && Math.random() < NEIGHBOR_BIAS ? near : rest;
        const g = pool[Math.floor(Math.random() * pool.length)];
        remainingGroups.delete(g);
        queue = shuffle(groups[g].slice());
        queueGroupSize = queue.length;
      }
      const id = queue.shift()!;
      return { id, info: { name: regions[id].name, index: queueGroupSize - queue.length, total: queueGroupSize } };
    }

    // 積み直し待ちのピース(箱から取り出して、まだ落とし直していないもの)
    let restackQueue: Piece[] = [];
    let restackNextAt = 0;

    function largestCount() {
      let m = 0;
      for (const p of pieces.values()) m = Math.max(m, p.regionIds.length);
      for (const p of restackQueue) m = Math.max(m, p.regionIds.length);
      return m;
    }

    function publishHud() {
      setHud({ dropped, total: regions.length, largest: largestCount(), score: currentScore(), hover: hoverInfo });
    }

    function spawnHover(now: number) {
      const next = nextRegion();
      if (!next) { hover = null; hoverInfo = null; publishHud(); return; }
      hover = buildPiece([next.id], 0);
      hoverInfo = next.info;
      hoverTargets = new Set(adjacency[next.id]);
      aimedSinceSpawn = false;
      nextHoverAt = now;
      publishHud();
    }

    /**
     * 箱の中のピースに重ならない出現位置の y を返す。真下(横の範囲が重なる)にあるピースのうち一番高いものより上にする。
     * 山が縁より高いと、決まった高さに出現させたピースが既存のピースの内側に深く重なり、物理エンジンが
     * 引き離せずにかたまりの中に埋まったまま残ることがあったため(積み直しで起きやすい)
     */
    function clearSpawnY(body: Matter.Body, x: number, preferredY: number) {
      const b = body.bounds, pos = body.position;
      const left = x - (pos.x - b.min.x), right = x + (b.max.x - pos.x), bottom = b.max.y - pos.y;
      let y = preferredY;
      for (const p of pieces.values()) {
        if (p.body === body) continue;
        const q = p.body.bounds;
        if (q.max.x < left || q.min.x > right) continue;
        y = Math.min(y, q.min.y - bottom - SPAWN_GAP);
      }
      return y;
    }

    function hoverPosition(piece: Piece) {
      const b = piece.body.bounds, p = piece.body.position;
      const half = { l: p.x - b.min.x, r: b.max.x - p.x, bottom: b.max.y - p.y };
      const x = Math.min(Math.max(aimX, BOX_L + half.l + 1), BOX_R - half.r - 1);
      return { x, y: RIM_Y - half.bottom - 6 };
    }

    /** 落とす位置の線に重なっている、くっつく相手のピースを上に引っ張る(Engine.update の前に毎回呼ぶ) */
    function liftTargets(now: number) {
      if (!hover || ended || !hoverTargets.size) return;
      // 新しいピースが出てきただけでは引っ張らず、プレイヤーが動かして狙い始めてから効かせる(ユーザー指示)
      if (!aimedSinceSpawn) return;
      // 積み直しの最中(と落とし終えて落ち着くまで)は引っ張らない。並びをばらす邪魔になるため
      if (restackQueue.length || now < restackNextAt + LIFT_PAUSE_AFTER_RESTACK_MS) return;
      if (batchRemaining) return; // まとめて落としている間は相手がめまぐるしく変わるので引っ張らない
      const x = hoverPosition(hover).x;
      for (const p of pieces.values()) {
        const b = p.body.bounds;
        if (x < b.min.x || x > b.max.x || b.min.y < RIM_Y + LIFT_STOP_BELOW_RIM) continue;
        if (p.body.velocity.y < -LIFT_MAX_UP_SPEED) continue;
        if (!p.regionIds.some((id) => hoverTargets.has(id))) continue;
        const up = p.body.mass * engine.gravity.y * engine.gravity.scale * LIFT_FACTOR;
        Matter.Body.applyForce(p.body, p.body.position, { x: 0, y: -up });
      }
    }

    /** batchX を渡すと、狙いの位置の代わりにその横位置に落とし、次のピースを待たずにすぐ出す(まとめて落とす用) */
    function drop(now: number, batchX?: number) {
      if (!hover || ended || now < nextHoverAt) return;
      const at = hoverPosition(hover);
      if (batchX !== undefined) {
        const b = hover.body.bounds, pos = hover.body.position;
        at.x = Math.min(Math.max(batchX, BOX_L + (pos.x - b.min.x) + 1), BOX_R - (b.max.x - pos.x) - 1);
      }
      Matter.Body.setPosition(hover.body, { x: at.x, y: clearSpawnY(hover.body, at.x, at.y) });
      Matter.Body.setVelocity(hover.body, { x: 0, y: 0 });
      Matter.Composite.add(engine.world, hover.body);
      pieces.set(hover.body.id, hover);
      hover = null;
      hoverInfo = null;
      dropped++;
      if (startAt === null) startAt = now;
      publishHud();
      if (batchX !== undefined) spawnHover(now);
      else setTimeout(() => { if (!ended) spawnHover(performance.now()); }, DROP_WAIT_MS);
    }

    // まとめて落とす残り個数
    let batchRemaining = 0;
    let batchNextAt = 0;

    batchRef.current = () => {
      if (ended || !hover || batchRemaining) return;
      batchRemaining = batchSizeFor(regions.length);
      batchNextAt = 0;
    };

    function feedBatch(now: number) {
      if (!batchRemaining || now < batchNextAt) return;
      if (!hover || ended) { batchRemaining = 0; return; }
      drop(now, aimX + (Math.random() * 2 - 1) * BW * BATCH_SPREAD);
      batchRemaining--;
      batchNextAt = now + BATCH_INTERVAL_MS;
    }

    // ----- 合体 -----
    function onCollision(e: Matter.IEventCollision<Matter.Engine>) {
      for (const pair of e.pairs) {
        const a = pair.bodyA as RegionPart, b = pair.bodyB as RegionPart;
        if (a.regionId === undefined || b.regionId === undefined || a.parent === b.parent) continue;
        if (adjacency[a.regionId].has(b.regionId)) pending.push([a.parent, b.parent]);
      }
    }
    Matter.Events.on(engine, "collisionStart", onCollision);
    Matter.Events.on(engine, "collisionActive", onCollision);

    function processMerges(now: number) {
      if (!pending.length) return;
      const pairs = pending;
      pending = [];
      let merged = false;
      for (const [ba, bb] of pairs) {
        const a = pieces.get(ba.id), b = pieces.get(bb.id);
        if (!a || !b) continue; // この処理の中で既に別のピースと合体した
        // 大きい方を動かさず、小さい方を地図上の正しい位置に吸い寄せる
        const anchor = a.area >= b.area ? a : b;
        const target = worldOf(anchor, anchor.cx, anchor.cy);
        const piece = buildPiece([...a.regionIds, ...b.regionIds], anchor.body.angle);
        Matter.Body.setPosition(piece.body, { x: 0, y: 0 });
        const off = worldOf(piece, anchor.cx, anchor.cy);
        Matter.Body.setPosition(piece.body, { x: target.x - off.x, y: target.y - off.y });
        keepInsideBox(piece.body);
        Matter.Composite.remove(engine.world, [a.body, b.body]);
        pieces.delete(a.body.id);
        pieces.delete(b.body.id);
        Matter.Composite.add(engine.world, piece.body);
        pieces.set(piece.body.id, piece);
        const b2 = piece.body.bounds;
        flashes.push({ x: target.x, y: target.y, r: Math.max(b2.max.x - b2.min.x, b2.max.y - b2.min.y) / 2, at: now });
        const gained = MERGE_POINT * piece.regionIds.length;
        if (!ended) {
          mergePoints += gained;
          popups.push({ x: target.x, y: target.y, text: `+${gained}`, at: now });
        }
        merged = true;
      }
      if (!merged || ended) return;
      publishHud();
      if (!hover && !queue.length && !remainingGroups.size && !restackQueue.length && pieces.size === 1 && startAt !== null) {
        const sec = Math.round((now - startAt) / 1000);
        bonus = CLEAR_BONUS + Math.max(0, TIME_BONUS_SEC - sec) * TIME_BONUS_PER_SEC;
        finish({ kind: "clear", score: currentScore(), bonus, sec, largest: regions.length });
      }
    }

    const rand = ([min, max]: [number, number]) => min + Math.random() * (max - min);

    /** 止まっているピースを時々ポンと跳ねさせる */
    function hopPieces(now: number) {
      for (const p of pieces.values()) {
        if (p.body.speed > HOP_REST_SPEED) { p.nextHopAt = 0; continue; }
        if (p.nextHopAt === 0) { p.nextHopAt = now + rand(HOP_INTERVAL_MS) * (2 - p.bounciness); continue; }
        if (now < p.nextHopAt) continue;
        const up = HOP_UP[0] + (HOP_UP[1] - HOP_UP[0]) * p.bounciness;
        Matter.Body.setVelocity(p.body, { x: (Math.random() * 2 - 1) * HOP_SIDE, y: -up });
        Matter.Body.setAngularVelocity(p.body, (Math.random() < 0.5 ? -1 : 1) * rand(HOP_SPIN));
        p.nextHopAt = 0;
      }
    }

    function finish(r: Result) {
      ended = true;
      hover = null;
      hoverInfo = null;
      publishHud();
      setResult(r);
      if (!dropped) return; // 1つも落とさずにあきらめた場合は記録しない
      setSubmit({ status: "sending" });
      // 未ログインならゲストプレイとして記録しない
      currentUserId()
        .then((userId) => {
          if (!userId) { setSubmit({ status: "guest" }); return; }
          return submitMapPackChallenge({
            ...area,
            totalPieces: regions.length,
            mergePoints,
            restackCount: restacks,
            cleared: r.kind === "clear",
            elapsedSeconds: r.sec,
          }).then((res) => setSubmit({ status: "done", isNewBest: res.isNewBest }));
        })
        .catch((e: unknown) => setSubmit({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    }

    restackRef.current = () => {
      if (ended || restackQueue.length || !pieces.size) return 0;
      restackQueue = shuffle([...pieces.values()]);
      for (const p of restackQueue) {
        Matter.Composite.remove(engine.world, p.body);
        pieces.delete(p.body.id);
      }
      pending = [];
      restackNextAt = 0;
      restacks++;
      popups.push({ x: W / 2, y: RIM_Y - 30, text: `積み直し -${RESTACK_PENALTY}`, at: performance.now() });
      publishHud();
      return restackQueue.length * RESTACK_INTERVAL_MS;
    };

    /** 積み直し待ちのピースを1つずつ落とし直す */
    function feedRestack(now: number) {
      if (!restackQueue.length || now < restackNextAt) return;
      const p = restackQueue.shift()!;
      Matter.Body.setAngle(p.body, Math.random() * Math.PI * 2);
      const b = p.body.bounds, pos = p.body.position;
      const left = pos.x - b.min.x, right = b.max.x - pos.x;
      const minX = BOX_L + left + 1, maxX = Math.max(minX, BOX_R - right - 1);
      const near = [...pieces.values()].filter((q) =>
        p.regionIds.some((id) => q.regionIds.some((o) => adjacency[id].has(o))),
      );
      const x = near.length && Math.random() < RESTACK_AIM
        ? near[Math.floor(Math.random() * near.length)].body.position.x
        : minX + Math.random() * (maxX - minX);
      const sx = Math.min(Math.max(x, minX), maxX);
      Matter.Body.setPosition(p.body, { x: sx, y: clearSpawnY(p.body, sx, RIM_Y - (b.max.y - pos.y) - 6) });
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(p.body, 0);
      p.nextHopAt = 0;
      Matter.Composite.add(engine.world, p.body);
      pieces.set(p.body.id, p);
      restackNextAt = now + RESTACK_INTERVAL_MS;
    }

    giveUpRef.current = () => {
      if (ended) return;
      const sec = startAt === null ? 0 : Math.round((performance.now() - startAt) / 1000);
      finish({ kind: "giveup", score: currentScore(), bonus: 0, sec, largest: largestCount() });
    };

    // ----- 描画 -----
    let viewScale = 1;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    function resize() {
      const cssW = Math.max(200, Math.min(wrap.clientWidth, ((window.innerHeight - RESERVED_HEIGHT_PX) * W) / H));
      viewScale = cssW / W;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssW * (H / W)}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssW * (H / W) * dpr);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);

    function drawPiece(piece: Piece, alpha = 1, targets?: Set<number>, pulse = 0) {
      const { body } = piece;
      const hit = targets ? piece.regionIds.map((id) => targets.has(id)) : null;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.fillStyle = piece.fill;
      ctx.strokeStyle = piece.stroke;
      ctx.lineWidth = 0.8;
      ctx.lineJoin = "round";
      for (const path of piece.paths) { ctx.fill(path); ctx.stroke(path); }
      if (hit?.some(Boolean)) {
        ctx.fillStyle = `rgba(245,158,11,${0.3 + 0.25 * pulse})`;
        ctx.strokeStyle = "#d97706";
        ctx.lineWidth = 2;
        piece.paths.forEach((path, i) => { if (hit[i]) { ctx.fill(path); ctx.stroke(path); } });
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      const c = Math.cos(body.angle), s = Math.sin(body.angle);
      const put = (text: string, lx: number, ly: number) => {
        const x = body.position.x + lx * c - ly * s;
        const y = body.position.y + lx * s + ly * c;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      };
      // くっつく相手の地域は大きさにかかわらず地名を出すので、通常のラベルからは外す
      const hitNames = new Set(hit ? piece.regionIds.filter((_, i) => hit[i]).map((id) => regions[id].name) : []);
      ctx.fillStyle = "#3c2a14";
      for (const l of piece.labels) {
        if (hitNames.has(l.text)) continue;
        ctx.font = `bold ${l.size}px sans-serif`;
        put(l.text, l.x, l.y);
      }
      if (hit) {
        ctx.font = "bold 10px sans-serif";
        ctx.fillStyle = "#b45309";
        const done = new Set<string>();
        piece.regionIds.forEach((id, i) => {
          const name = regions[id].name;
          if (!hit[i] || done.has(name)) return;
          done.add(name);
          put(name, piece.centers[i].x, piece.centers[i].y);
        });
      }
      ctx.restore();
    }

    function draw(now: number) {
      ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 箱
      ctx.fillStyle = "#fffaf2";
      ctx.fillRect(BOX_L, RIM_Y, BW, BH);
      ctx.strokeStyle = "#c8b8a0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(BOX_L - 1.5, RIM_Y);
      ctx.lineTo(BOX_L - 1.5, FLOOR_Y + 1.5);
      ctx.lineTo(BOX_R + 1.5, FLOOR_Y + 1.5);
      ctx.lineTo(BOX_R + 1.5, RIM_Y);
      ctx.stroke();

      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      for (const p of pieces.values()) drawPiece(p, 1, hover && !ended ? hoverTargets : undefined, pulse);

      if (hover && !ended) {
        const pos = hoverPosition(hover);
        Matter.Body.setPosition(hover.body, pos);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(120,90,40,0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pos.x, hover.body.bounds.max.y);
        ctx.lineTo(pos.x, FLOOR_Y);
        ctx.stroke();
        ctx.restore();
        drawPiece(hover, now < nextHoverAt + 150 ? 0.5 : 1);
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const t = (now - f.at) / FLASH_MS;
        if (t >= 1) { flashes.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (0.6 + 0.6 * t), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        const t = (now - p.at) / POPUP_MS;
        if (t >= 1) { popups.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t * t;
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.fillStyle = "#d97706";
        const y = p.y - 24 * t;
        ctx.strokeText(p.text, p.x, y);
        ctx.fillText(p.text, p.x, y);
        ctx.restore();
      }
    }

    // ----- ループ -----
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    function frame(now: number) {
      acc += Math.min(now - last, 100);
      last = now;
      while (acc >= STEP_MS) {
        for (let i = 0; i < SUBSTEPS; i++) {
          liftTargets(now); // 力は Engine.update のたびにリセットされるので、毎回かけ直す
          Matter.Engine.update(engine, STEP_MS / SUBSTEPS);
        }
        processMerges(now);
        hopPieces(now);
        feedRestack(now);
        feedBatch(now);
        acc -= STEP_MS;
      }
      draw(now);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    spawnHover(performance.now());

    const timer = setInterval(() => {
      if (startAt !== null && !ended) setElapsed(Math.floor((performance.now() - startAt) / 1000));
    }, 250);

    // ----- 操作: 指(マウス)の横位置で狙い、離したら落とす -----
    const toWorldX = (e: PointerEvent) => (e.clientX - canvas.getBoundingClientRect().left) / viewScale;
    let pressing = false;
    const aimAt = (e: PointerEvent) => {
      const x = toWorldX(e);
      if (x !== aimX) aimedSinceSpawn = true;
      aimX = x;
    };
    const onDown = (e: PointerEvent) => { pressing = true; aimAt(e); canvas.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => { aimAt(e); };
    const onUp = (e: PointerEvent) => {
      if (!pressing) return;
      pressing = false;
      aimX = toWorldX(e);
      drop(performance.now());
    };
    const onCancel = () => { pressing = false; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      Matter.Events.off(engine, "collisionStart", onCollision);
      Matter.Events.off(engine, "collisionActive", onCollision);
      Matter.Engine.clear(engine);
      ended = true; // 保留中の setTimeout から次のピースを出さない
    };
  }, [data, area]);

  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-[420px] flex items-end justify-between px-1 mb-2 text-[#3c2a14]">
        <div>
          <p className="text-xs text-[#a8937a]">いま落とす{unitLabel}</p>
          <p className="font-bold text-lg leading-tight min-h-[1.75rem]">
            {hud.hover ? hud.hover.name : "…"}
            {hud.hover && hud.hover.total > 1 && (
              <span className="ml-1 text-xs font-normal text-[#78716c]">
                （{hud.hover.index}/{hud.hover.total}）
              </span>
            )}
          </p>
        </div>
        <div className="text-right text-xs text-[#78716c] leading-relaxed">
          <p className="font-bold text-base text-[#d97706]">{hud.score.toLocaleString()} 点</p>
          <p>落とした {hud.dropped} / {hud.total}・最大 {hud.largest} {unitLabel}</p>
          <p>⏱ {formatTime(result ? result.sec : elapsed)}</p>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full max-w-[420px]">
        <canvas ref={canvasRef} className="block mx-auto touch-none select-none" />
        {result && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#fdf8f0]/70">
            <div className="bg-white rounded-2xl shadow-[0_4px_20px_rgba(120,90,40,0.15)] px-6 py-5 text-center min-w-[220px]">
              <p className="text-3xl mb-1">{result.kind === "clear" ? "🎉" : "🏳️"}</p>
              <p className="font-bold text-[#3c2a14]">
                {result.kind === "clear" ? `${areaLabel} 完成！` : "ここまで"}
              </p>
              <p className="text-2xl font-bold text-[#d97706] mt-2">{result.score.toLocaleString()} 点</p>
              <div className="text-xs text-[#78716c] mt-2 leading-relaxed">
                {result.bonus > 0 && <p>（完成ボーナス {result.bonus.toLocaleString()} 点を含む）</p>}
                <p>タイム {formatTime(result.sec)}・最大のかたまり {result.largest} / {hud.total} {unitLabel}</p>
              </div>
              <div className="text-xs mt-2 min-h-[1rem]">
                {submit?.status === "sending" && <p className="text-[#a8937a]">記録しています…</p>}
                {submit?.status === "done" && (
                  <p className="text-teal-700 font-semibold">{submit.isNewBest ? "🏆 自己ベスト更新！" : "記録しました"}</p>
                )}
                {submit?.status === "guest" && (
                  <p className="text-[#78716c]">
                    <Link href="/login" className="underline underline-offset-2 text-teal-700">ログイン</Link>
                    するとランキングに参加できます
                  </p>
                )}
                {submit?.status === "error" && <p className="text-red-600">記録できませんでした（{submit.message}）</p>}
              </div>
              <button
                type="button"
                onClick={onRestart}
                className="mt-4 px-5 py-2 rounded-full bg-teal-600 text-white text-sm font-bold active:scale-[0.97]"
              >
                もう一回
              </button>
              <p className="mt-3">
                <Link href={mapPackAreaRankingHref(area)} className="text-xs text-[#78716c] underline underline-offset-2">
                  🏆 このエリアのランキング
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
        {batchSizeFor(hud.total) > 0 && (
          <button
            type="button"
            disabled={result !== null || !hud.hover}
            onClick={() => batchRef.current()}
            className="px-4 py-1.5 rounded-full border border-amber-300 text-sm text-amber-700 bg-white active:scale-[0.97] disabled:opacity-40"
          >
            ⏬ {batchSizeFor(hud.total)}個まとめて落とす
          </button>
        )}
        <button
          type="button"
          disabled={result !== null || restacking}
          onClick={() => {
            const ms = restackRef.current();
            if (!ms) return;
            setRestacking(true);
            setTimeout(() => setRestacking(false), ms + 500);
          }}
          className="px-4 py-1.5 rounded-full border border-teal-300 text-sm text-teal-700 bg-white active:scale-[0.97] disabled:opacity-40"
        >
          🧱 積み直す<span className="ml-1 text-[10px]">-{RESTACK_PENALTY}点</span>
        </button>
        <button
          type="button"
          onClick={() => { if (hud.dropped === 0 || window.confirm("最初からやり直しますか？")) onRestart(); }}
          className="px-4 py-1.5 rounded-full border border-[#c8b8a0] text-sm text-[#78716c] bg-white active:scale-[0.97]"
        >
          ↺ やり直す
        </button>
        <button
          type="button"
          disabled={result !== null}
          onClick={() => { if (window.confirm("あきらめて、ここまでの得点で終わりますか？")) giveUpRef.current(); }}
          className="px-4 py-1.5 rounded-full border border-[#c8b8a0] text-sm text-[#78716c] bg-white active:scale-[0.97] disabled:opacity-40"
        >
          🏳️ あきらめる
        </button>
      </div>

      <p className="text-xs text-[#a8937a] mt-3">左右に動かして狙い、指を離す（クリックする）と落ちます</p>
    </div>
  );
}
