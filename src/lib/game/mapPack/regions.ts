// 地図パック: geojson(都道府県/市区町村/町丁)からピースの元になる地域データを作る。
// 座標は経度をcos(基準緯度)で補正した平面(メートル)に投影し、画面と同じくy軸を下向きにする。

export type Point = [number, number];

export type Region = {
  id: number;
  name: string;
  /** 外周リング(メートル、閉じ点なし)。穴は物理形状・描画とも無視する */
  rings: Point[][];
  /** 面積(㎡) */
  area: number;
  /** 重心(メートル) */
  cx: number;
  cy: number;
};

export type AreaData = {
  regions: Region[];
  /** regions[i] と隣接する地域のid(境界を共有するもの+離島を最寄りとつないだもの) */
  adjacency: Set<number>[];
  /** 同じ名前の地域idのまとまり(町丁は統計上の小地域分割で同名が複数ある)。落とすときはまとめて連続で出す */
  groups: number[][];
};

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type Feature = { geometry: Geometry | null; properties: Record<string, unknown> };

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

/**
 * 描画・物理演算の前に、地域の一辺(√面積)の中央値に対してこの割合の誤差で頂点を間引く(北海道の市区町村で約25万頂点あるため)。
 * 全体の大きさを基準にすると、小笠原まで含む東京都などで本土側を間引きすぎるため、典型的な地域の大きさを基準にする
 */
const PRESIMPLIFY_RATIO = 0.01;
/** 地域の中で、最大のリングからこの距離(最大リングの一辺の倍数)より遠い島は捨てる(小笠原・先島諸島など) */
const FAR_RING_FACTOR = 3;
/** 陸続きでない島(群)を最寄りとつなぐとき、離れすぎていればこの距離(本土側の大きさの割合)まで寄せる */
const ISLAND_MAX_GAP_RATIO = 0.04;

export function signedArea(ring: Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function ringCentroid(ring: Point[]): [number, number, number] {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const c = x1 * y2 - x2 * y1;
    a += c; x += (x1 + x2) * c; y += (y1 + y2) * c;
  }
  a /= 2;
  if (!a) return [ring[0][0], ring[0][1], 0];
  return [x / (6 * a), y / (6 * a), Math.abs(a)];
}

function perpDistSq(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

function dpOpen(pts: Point[], tolSq: number): Point[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistSq(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tolSq) return [pts[0], pts[pts.length - 1]];
  const left = dpOpen(pts.slice(0, idx + 1), tolSq);
  return left.slice(0, -1).concat(dpOpen(pts.slice(idx), tolSq));
}

/** 閉じたリングの Douglas-Peucker 間引き(始点から最も遠い点で2本の折れ線に分けて処理する) */
export function simplifyRing(ring: Point[], tol: number): Point[] {
  if (tol <= 0 || ring.length < 4) return ring.slice();
  let far = 0, maxD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > maxD) { maxD = d; far = i; }
  }
  const tolSq = tol * tol;
  const a = dpOpen(ring.slice(0, far + 1), tolSq);
  const b = dpOpen(ring.slice(far).concat([ring[0]]), tolSq);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** 隣接判定用に頂点を同一視するキー。境界データは隣同士で頂点を共有しているため、丸めた座標の一致で判定できる */
const vertexKey = (lon: number, lat: number) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boxOf(rings: Point[][]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
  return b;
}

const boxGap = (a: Box, b: Box) =>
  Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));

/** 2地域の最近接点(頂点同士の距離で近似。前処理で間引き済みなので十分) */
function closestPoints(a: Point[][], b: Point[][]): { d: number; pa: Point; pb: Point } {
  let best = { d: Infinity, pa: a[0][0], pb: b[0][0] };
  for (const ra of a) for (const p of ra) for (const rb of b) for (const q of rb) {
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d < best.d) best = { d, pa: p, pb: q };
  }
  return { ...best, d: Math.sqrt(best.d) };
}

function components(n: number, adjacency: Set<number>[]): number[][] {
  const seen = new Array<boolean>(n).fill(false);
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const o of adjacency[x]) if (!seen[o]) { seen[o] = true; stack.push(o); }
    }
    result.push(comp);
  }
  return result.sort((p, q) => q.length - p.length);
}

export function buildAreaData(geojson: { features: Feature[] }, nameKey: string): AreaData {
  const features = geojson.features.filter((f): f is Feature & { geometry: Geometry } => !!f.geometry);
  // 外周リングと穴のリング。穴は形には使わないが、内側に囲まれた飛び地との隣接判定に使う
  const polys = features.map((f) =>
    f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
  );

  let latSum = 0, latCount = 0;
  for (const p of polys) for (const poly of p) for (const [, lat] of poly[0]) { latSum += lat; latCount++; }
  const kx = EARTH_R * DEG * Math.cos((latSum / latCount) * DEG);
  const ky = EARTH_R * DEG;
  const project = ([lon, lat]: number[]): Point => [lon * kx, -lat * ky];

  // ----- 隣接(頂点共有) -----
  const owners = new Map<string, Set<number>>();
  polys.forEach((p, id) => {
    for (const poly of p) for (const ring of poly) for (const [lon, lat] of ring) {
      const key = vertexKey(lon, lat);
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(id);
    }
  });
  const adjacency = features.map(() => new Set<number>());
  for (const ids of owners.values()) {
    if (ids.size < 2) continue;
    for (const a of ids) for (const b of ids) if (a !== b) adjacency[a].add(b);
  }

  // ----- 投影・間引き・遠い島の除去 -----
  const outer = polys.map((p) => p.map((poly) => poly[0].slice(0, -1).map(project))); // geojsonのリングは始点で閉じている
  const sides = outer
    .map((rings) => Math.sqrt(rings.reduce((s, r) => s + Math.abs(signedArea(r)), 0)))
    .sort((a, b) => a - b);
  const tol = sides[sides.length >> 1] * PRESIMPLIFY_RATIO;

  const regions: Region[] = outer.map((rings, id) => {
    let kept = rings.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 3);
    if (!kept.length) kept = [rings[0]];
    const cents = kept.map(ringCentroid);
    const main = cents.reduce((m, c, i) => (c[2] > cents[m][2] ? i : m), 0);
    const limit = FAR_RING_FACTOR * Math.sqrt(cents[main][2]);
    const near = kept.filter((_, i) => Math.hypot(cents[i][0] - cents[main][0], cents[i][1] - cents[main][1]) <= limit);
    let area = 0, sx = 0, sy = 0;
    for (const ring of near) {
      const [x, y, a] = ringCentroid(ring);
      area += a; sx += x * a; sy += y * a;
    }
    const name = String(features[id].properties[nameKey] ?? "");
    return { id, name, rings: near, area, cx: area ? sx / area : near[0][0][0], cy: area ? sy / area : near[0][0][1] };
  });

  // ----- 陸続きでない島(群)を最寄りの地域とつなぐ -----
  // 一番大きいかたまりに、そこから一番近いかたまりを順に1本ずつつないでいく。
  // 離れすぎている島(沖縄・伊豆諸島など)は、ピースが合体したときに地図が間延びしないよう本土側に寄せる
  let comps = components(regions.length, adjacency);
  if (comps.length > 1) {
    const mainBox = boxOf(comps[0].flatMap((i) => regions[i].rings));
    const maxGap = ISLAND_MAX_GAP_RATIO * Math.hypot(mainBox.maxX - mainBox.minX, mainBox.maxY - mainBox.minY);
    const boxes = regions.map((r) => boxOf(r.rings));
    const inMain = new Set(comps[0]);
    let rest = comps.slice(1);
    while (rest.length) {
      let best = { d: Infinity, comp: 0, a: 0, b: 0, pa: [0, 0] as Point, pb: [0, 0] as Point };
      rest.forEach((comp, ci) => {
        for (const a of comp) for (const b of inMain) {
          if (boxGap(boxes[a], boxes[b]) >= best.d) continue;
          const c = closestPoints(regions[a].rings, regions[b].rings);
          if (c.d < best.d) best = { d: c.d, comp: ci, a, b, pa: c.pa, pb: c.pb };
        }
      });
      const comp = rest[best.comp];
      if (best.d > maxGap) {
        const k = (best.d - maxGap) / best.d;
        const dx = (best.pb[0] - best.pa[0]) * k, dy = (best.pb[1] - best.pa[1]) * k;
        for (const id of comp) {
          const r = regions[id];
          r.rings = r.rings.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as Point));
          r.cx += dx;
          r.cy += dy;
          boxes[id] = boxOf(r.rings);
        }
      }
      adjacency[best.a].add(best.b);
      adjacency[best.b].add(best.a);
      for (const id of comp) inMain.add(id);
      rest = rest.filter((_, i) => i !== best.comp);
    }
    comps = [[...inMain]];
  }

  const byName = new Map<string, number[]>();
  for (const r of regions) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push(r.id);
  }

  return { regions, adjacency, groups: [...byName.values()] };
}
