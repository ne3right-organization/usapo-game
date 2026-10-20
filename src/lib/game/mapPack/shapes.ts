// 地図ポットン: 地域の形を物理演算用の凸多角形に分解する。
// 物理エンジン(Matter.js)は凸多角形しか扱えないため、外周を間引いてから poly-decomp で凸分解する。
// 間引きの許容誤差は画面上の大きさで決まり、合体して小さく表示される地域ほど粗い形で済む。

import decomp from "poly-decomp";
import { signedArea, simplifyRing, type Point, type Region } from "./regions";

function convexHull(pts: Point[]): Point[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function decomposeRing(ring: Point[], tol: number): Point[][] {
  const want = Math.abs(signedArea(ring));
  // 間引くと自己交差することがあるので、許容誤差を段階的に下げて凸分解できるまで試す
  for (const k of [1, 0.6, 0.3, 0]) {
    const poly: [number, number][] = simplifyRing(ring, tol * k).map(([x, y]) => [x, y]);
    if (poly.length < 3 || !decomp.isSimple(poly)) continue;
    decomp.makeCCW(poly);
    decomp.removeDuplicatePoints(poly, 1e-6);
    decomp.removeCollinearPoints(poly, 0.01);
    if (poly.length < 3) continue;
    const parts = decomp.quickDecomp(poly);
    const got = parts.reduce((s, q) => s + Math.abs(signedArea(q)), 0);
    if (parts.length && Math.abs(got - want) < 0.03 * want) return parts;
  }
  return [convexHull(ring)];
}

// 許容誤差の段階: 地域の一辺(√面積)× LEVEL_BASE × 2^L。都道府県から町丁まで桁が違うので地域の大きさに比例させる
const LEVEL_BASE = 0.004;
const LEVELS = 9;
const cache = new Map<number, Map<number, Point[][]>>();

/**
 * 地域の凸パーツ(メートル座標)を返す。scale は画面単位/メートル、maxErr は許容する画面上の誤差。
 */
export function regionConvexParts(region: Region, scale: number, maxErr: number): Point[][] {
  const base = Math.sqrt(region.area) * LEVEL_BASE;
  const allowM = maxErr / scale;
  let level = 0;
  while (level + 1 < LEVELS && base * 2 ** (level + 1) <= allowM) level++;
  let byLevel = cache.get(region.id);
  if (!byLevel) { byLevel = new Map(); cache.set(region.id, byLevel); }
  let parts = byLevel.get(level);
  if (!parts) {
    parts = region.rings.flatMap((ring) => decomposeRing(ring, base * 2 ** level));
    byLevel.set(level, parts);
  }
  return parts;
}

/** 地域データを読み直したときに古い分解結果を使わないようにする */
export function clearShapeCache() {
  cache.clear();
}
