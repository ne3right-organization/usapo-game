// うさぽ農園のアイテムの絵を、画像生成AIで作った元の画像(art/chizu-tane/)から切り抜く処理。
// process-item-images.mts(ゲーム用の絵)と make-app-icons.mts(アプリのアイコン)で使う

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as coursesModule from "../../src/lib/game/chizuTane/courses";
import * as localItemsModule from "../../src/lib/game/chizuTane/localItems";

// package.json が "type": "module" ではないので、tsx で動かすと courses.ts は CommonJS として読まれ、中身は default に入る。
// 型の上(next build の型チェック)では ES モジュールなので、どちらでも取り出せるようにする
const courses = (coursesModule as unknown as { default?: typeof coursesModule }).default ?? coursesModule;
const { TANE_COURSES, TANE_ITEMS, baseTypesOf } = courses;
const localItems = (localItemsModule as unknown as { default?: typeof localItemsModule }).default ?? localItemsModule;
const { localItemFor } = localItems;

/** ご当地のもののシートの並び(左から右へ)。1シート = 1都道府県の同じ何個目の5点を横1列に */
export const LOCAL_SHEET_COURSES = ["plant", "animal", "hobby", "vehicle", "building"] as const;

/** ご当地のもののシートID(local-13-1 = 東京都の1個目) */
export const localSheetId = (prefCode: string, rank: number) => `local-${prefCode}-${rank}`;

/** 2個目・3個目は、1シートに3都道府県ずつ(1行が1都道府県) */
export const LOCAL_GROUP_PREFS = 3;
/** 何都道府県かをまとめたシートのID(local-2-p01-03 = 北海道〜岩手県の2個目) */
export const localGroupSheetId = (rank: number, fromPrefCode: string, toPrefCode: string) => `local-${rank}-p${fromPrefCode}-${toPrefCode}`;

/**
 * 描き直しのシート(redo-1 など。3×3 の9点)の並び。local-art-prompts.mts --redo が redo.md から作る。
 * redo.md が変わっても、置いたシートの切り分けがずれないよう、頼む文を作ったときの並びをファイルに残しておく
 */
export const REDO_SHEETS_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../art/chizu-tane/redo-sheets.json");

function redoRows(sheetId: string): string[][] | null {
  if (!existsSync(REDO_SHEETS_FILE)) return null;
  const sheets = JSON.parse(readFileSync(REDO_SHEETS_FILE, "utf8")) as Record<string, string[][]>;
  return sheets[sheetId] ?? null;
}

// 育つ途中の絵(growth.ts の GROWTH_STAGES のタネ〜花と、タネ待ちの空き地。実りはその畑の実の絵を出す)
export const GROWTH_SHEET_ID = "growth";
export const GROWTH_ROWS = [
  ["growth_0", "growth_1", "growth_2"],
  ["growth_3", "growth_4", "growth_waiting"],
];

// 背景とみなす色: 明るくて(いちばん暗いチャンネルがこれ以上)、色みが無い(チャンネルの差がこれ以下)。
// 白のほか、AI が「透明」のつもりで描き込んでくる市松模様の灰色もこれで消える。
// 市松模様の灰色はシートによって 150 〜 230 くらいまでばらつくので、ふちが市松模様のシートは、ふちの灰色のマスより少し暗いところまで下げる
const BACKGROUND_MIN = 210;
const BACKGROUND_FLOOR = 120; // 市松模様のシートでも、これより下げない
const BACKGROUND_MAX_SPREAD = 14;
const HAZE_ALPHA = 128; // うすい半透明のもや(これより透明な画素)
const HAZE_RATIO = 0.02; // うすい画素が画像全体のこれより多ければ、もやのあるシートとみなす
const MIN_PART_RATIO = 0.0005; // これより小さいかたまり(画像全体に対する割合)はゴミとして捨てる

export type Rgba = { data: Buffer; width: number; height: number };

/** シートID(plant-1 など)から、行ごとのアイテムID(1行 = 1種類のタネ1〜3。ご当地の local-13-2 などは1行に5コース) */
export function sheetRows(sheetId: string): string[][] | null {
  if (sheetId === GROWTH_SHEET_ID) return GROWTH_ROWS;
  if (/^redo-\d+$/.test(sheetId)) return redoRows(sheetId);
  const group = /^local-([123])-p(\d{2})-(\d{2})$/.exec(sheetId);
  if (group) {
    const rows: string[][] = [];
    for (let code = Number(group[2]); code <= Number(group[3]); code++) {
      const row = LOCAL_SHEET_COURSES.map((course) => localItemFor(String(code).padStart(2, "0"), course, Number(group[1]))?.itemId);
      if (!row.every((id) => id)) return null;
      rows.push(row as string[]);
    }
    return rows.length > 0 ? rows : null;
  }
  const local = /^local-(\d{2})-([123])$/.exec(sheetId);
  if (local) {
    const row = LOCAL_SHEET_COURSES.map((course) => localItemFor(local[1], course, Number(local[2]))?.itemId);
    return row.every((id) => id) ? [row as string[]] : null;
  }
  const m = /^([a-z]+)-(\d+)$/.exec(sheetId);
  if (!m) return null;
  const course = TANE_COURSES.find((c) => c.id === m[1]);
  const n = Number(m[2]);
  if (!course || n < 1) return null;
  const types = baseTypesOf(course.id).filter((t) => t.unlockLevel > (n - 1) * 3 && t.unlockLevel <= n * 3);
  if (types.length === 0) return null;
  return types.map((t) =>
    TANE_ITEMS.filter((i) => i.baseTypeId === t.id)
      .sort((a, b) => a.rank - b.rank)
      .map((i) => i.itemId)
  );
}

export async function loadRgba(file: string): Promise<Rgba> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * 背景がすでに透明なら何もしない。白(や市松模様の灰色)の背景なら、外側からつながっているその色を透明にする。
 * 取っ手の輪の中のように絵に囲まれたところは外側とつながらないので、外側の背景が市松模様(明るさが2つ)のときだけ、
 * 囲まれたところも同じ2つの明るさがまざっていれば背景とみなして消す(白い背景では、白い絵の部分と見分けられないので消さない)
 */
export function removeWhiteBackground(img: Rgba): void {
  const { data, width, height } = img;
  const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  const edgePoints: [number, number][] = [];
  for (let x = 0; x < width; x++) edgePoints.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y++) edgePoints.push([0, y], [width - 1, y]);
  const transparentEdge = edgePoints.filter(([x, y]) => alphaAt(x, y) < 128).length;
  if (transparentEdge > edgePoints.length / 2) return;

  const isNeutral = (p: number, min: number) => {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    return Math.min(r, g, b) >= min && Math.max(r, g, b) - Math.min(r, g, b) <= BACKGROUND_MAX_SPREAD;
  };
  // 市松模様は白っぽいマスと灰色のマスにはっきり分かれ、そのあいだの明るさがほとんど無い。
  // 白い絵の陰影はなだらかなので、あいだの明るさが多くなる
  const levelOf = (p: number) => Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
  const shares = (levels: number[], lo: number, hi: number) => {
    const lightMin = hi - (hi - lo) / 3;
    const grayMax = lo + (hi - lo) / 3;
    const light = levels.filter((v) => v >= lightMin).length / levels.length;
    const gray = levels.filter((v) => v <= grayMax).length / levels.length;
    return { light, gray, between: 1 - light - gray };
  };
  const isChecker = ({ light, gray, between }: ReturnType<typeof shares>) => light >= 0.2 && gray >= 0.15 && between <= 0.15;
  // ふちのほとんどが色みの無い画素で、その明るさが2つに分かれていれば市松模様。灰色のマス(lo)と白っぽいマス(hi)の明るさを測る
  const edgeLevels = edgePoints
    .map(([x, y]) => y * width + x)
    .filter((p) => isNeutral(p, 0))
    .map(levelOf)
    .sort((a, b) => a - b);
  const lo = edgeLevels[Math.floor(edgeLevels.length * 0.25)] ?? 255;
  const hi = edgeLevels[Math.floor(edgeLevels.length * 0.75)] ?? 255;
  const checker = edgeLevels.length >= edgePoints.length * 0.8 && hi - lo >= 15 && isChecker(shares(edgeLevels, lo, hi));
  const backgroundMin = checker ? Math.max(BACKGROUND_FLOOR, Math.min(BACKGROUND_MIN, lo - 20)) : BACKGROUND_MIN;
  const isBackground = (p: number) => isNeutral(p, backgroundMin);
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!seen[p] && isBackground(p)) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  /** stack から、つながっている背景の色の画素を全部たどる */
  const flood = (): number[] => {
    const region: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      const x = p % width;
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < width * (height - 1)) push(p + width);
    }
    return region;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  const outside = flood();
  for (const p of outside) data[p * 4 + 3] = 0;

  if (!checker) return;
  // 囲まれたところは、白い絵の陰影も白と灰色に分かれて見えることがあるので、マス目の並びでも確かめる。
  // ふちの上の行からマスの大きさ(同じ明るさが続く長さ)を測り、マス1つぶん横にずらした画素と白・灰色が入れ替わっていれば市松模様
  const mid = (lo + hi) / 2;
  const runs: number[] = [];
  let run = 1;
  for (let x = 1; x < width; x++) {
    if (levelOf(x) >= mid === levelOf(x - 1) >= mid) run++;
    else {
      runs.push(run);
      run = 1;
    }
  }
  runs.sort((a, b) => a - b);
  const cell = runs[Math.floor(runs.length / 2)];
  if (!cell || cell < 3) return;
  const minSize = Math.max(4, width * height * MIN_PART_RATIO);
  for (let start = 0; start < width * height; start++) {
    if (seen[start]) continue;
    push(start);
    const region = flood();
    if (region.length < minSize || !isChecker(shares(region.map(levelOf), lo, hi))) continue;
    const inRegion = new Set(region);
    let compared = 0;
    let flipped = 0;
    for (const p of region) {
      const q = p + cell;
      if ((p % width) + cell >= width || !inRegion.has(q)) continue;
      compared++;
      if (levelOf(p) >= mid !== levelOf(q) >= mid) flipped++;
    }
    if (compared > 0 && flipped >= compared * 0.6) for (const p of region) data[p * 4 + 3] = 0;
  }
}

export interface Part {
  pixels: number[];
  cx: number;
  cy: number;
}

/**
 * 透明でない画素のかたまり(4近傍でつながったもの)。小さいゴミは捨てる。
 * AI が背景にうすい半透明のもやを残してくることがあり(となりの絵とつながって1つのかたまりになる)、
 * うすい画素が多いシートでは、うすい画素も背景とみなす
 */
export function findParts(img: Rgba): Part[] {
  const { data, width, height } = img;
  let faint = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 16 && data[i] < HAZE_ALPHA) faint++;
  const minAlpha = faint > width * height * HAZE_RATIO ? HAZE_ALPHA : 16;
  const label = new Int32Array(width * height).fill(-1);
  const parts: Part[] = [];
  const minSize = Math.max(4, width * height * MIN_PART_RATIO);
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] < minAlpha) continue;
    const pixels: number[] = [];
    const stack = [start];
    label[start] = parts.length;
    let sx = 0;
    let sy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      sx += x;
      sy += y;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && label[q] === -1 && data[q * 4 + 3] >= minAlpha) {
          label[q] = parts.length;
          stack.push(q);
        }
      }
    }
    parts.push({ pixels, cx: sx / pixels.length, cy: sy / pixels.length });
  }
  return parts.filter((p) => p.pixels.length >= minSize);
}

/** かたまりの画素だけを切り出す(同じ範囲にある、ほかのマスのはみ出しは入れない) */
export function cutOut(img: Rgba, parts: Part[]): Rgba | null {
  if (parts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (const part of parts) {
    for (const p of part.pixels) {
      const x = p % img.width;
      const y = (p - x) / img.width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = Buffer.alloc(width * height * 4);
  for (const part of parts) {
    for (const p of part.pixels) {
      const x = p % img.width;
      const y = (p - x) / img.width;
      img.data.copy(data, ((y - minY) * width + (x - minX)) * 4, p * 4, p * 4 + 4);
    }
  }
  return { data, width, height };
}

/** シート(行 × 列)のマスごとのかたまりを切り出す。かたまりは中心がどのマスにあるかで振り分けるので、マス目が少しずれていてもよい */
export async function cutSheet(file: string, rows: string[][]): Promise<[string, Rgba | null][]> {
  const img = await loadRgba(file);
  removeWhiteBackground(img);
  const parts = findParts(img);
  const cellW = img.width / Math.max(...rows.map((r) => r.length));
  const cellH = img.height / rows.length;
  const pieces: [string, Rgba | null][] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const inCell = parts.filter((p) => Math.floor(p.cx / cellW) === c && Math.floor(p.cy / cellH) === r);
      pieces.push([rows[r][c], cutOut(img, inCell)]);
    }
  }
  return pieces;
}
