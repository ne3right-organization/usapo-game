// うさぽ農園(地図タネ)のアイテムの絵を、画像生成AIで作った画像からゲーム用の PNG にする。
// 手順は docs/地図タネ_絵の作り方.md の手順3。
//
//   npx tsx scripts/chizu-tane/process-item-images.mts            # art/chizu-tane/ にある画像を全部
//   npx tsx scripts/chizu-tane/process-item-images.mts plant-1    # シートや単品を指定して
//
// 入力(art/chizu-tane/。元の画像は大きいので git には入れない):
//   sheets/{シートID}.png   作業表の1シート(3×3。Lv.10 のシートは 1×3)。シートID は plant-1 〜 building-4
//   singles/{アイテムID}.png 1点だけ作り直したもの(例: orchard_1.png)
// 出力:
//   public/chizu-tane/items/{アイテムID}.png  96×96、背景透過、下端の中央が地面に接する点
//   src/lib/game/chizuTane/itemImages.generated.ts  絵のあるアイテムの一覧(courses.ts が imageUrl に使う)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as coursesModule from "../../src/lib/game/chizuTane/courses";

// package.json が "type": "module" ではないので、tsx で動かすと courses.ts は CommonJS として読まれ、中身は default に入る。
// 型の上(next build の型チェック)では ES モジュールなので、どちらでも取り出せるようにする
const courses = (coursesModule as unknown as { default?: typeof coursesModule }).default ?? coursesModule;
const { TANE_COURSES, TANE_ITEM_BY_ID, TANE_ITEMS, baseTypesOf } = courses;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHEETS_DIR = join(ROOT, "art/chizu-tane/sheets");
const SINGLES_DIR = join(ROOT, "art/chizu-tane/singles");
const OUT_DIR = join(ROOT, "public/chizu-tane/items");
const GENERATED = join(ROOT, "src/lib/game/chizuTane/itemImages.generated.ts");

const SIZE = 96; // 表示は 48px 前後なので2倍
const MAX_W = 88;
const MAX_H = 90;
const BOTTOM_MARGIN = 3;
// 背景とみなす色: 明るくて(いちばん暗いチャンネルがこれ以上)、色みが無い(チャンネルの差がこれ以下)。
// 白のほか、AI が「透明」のつもりで描き込んでくる市松模様の薄い灰色もこれで消える
const BACKGROUND_MIN = 210;
const BACKGROUND_MAX_SPREAD = 14;
const MIN_PART_RATIO = 0.0005; // これより小さいかたまり(画像全体に対する割合)はゴミとして捨てる

type Rgba = { data: Buffer; width: number; height: number };

/** シートID(plant-1 など)から、行ごとのアイテムID(1行 = 1種類のタネ1〜3) */
function sheetRows(sheetId: string): string[][] | null {
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

async function loadRgba(file: string): Promise<Rgba> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** 背景がすでに透明なら何もしない。白(や市松模様の灰色)の背景なら、外側からつながっているその色を透明にする */
function removeWhiteBackground(img: Rgba): void {
  const { data, width, height } = img;
  const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  let transparentEdge = 0;
  let edge = 0;
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) (edge++, alphaAt(x, y) < 128 && transparentEdge++);
  for (let y = 0; y < height; y++) for (const x of [0, width - 1]) (edge++, alphaAt(x, y) < 128 && transparentEdge++);
  if (transparentEdge > edge / 2) return;

  const isBackground = (p: number) => {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    return Math.min(r, g, b) >= BACKGROUND_MIN && Math.max(r, g, b) - Math.min(r, g, b) <= BACKGROUND_MAX_SPREAD;
  };
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!seen[p] && isBackground(p)) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x++) (push(x), push((height - 1) * width + x));
  for (let y = 0; y < height; y++) (push(y * width), push(y * width + width - 1));
  while (stack.length) {
    const p = stack.pop()!;
    data[p * 4 + 3] = 0;
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < width * (height - 1)) push(p + width);
  }
}

interface Part {
  pixels: number[];
  cx: number;
  cy: number;
}

/** 透明でない画素のかたまり(4近傍でつながったもの)。小さいゴミは捨てる */
function findParts(img: Rgba): Part[] {
  const { data, width, height } = img;
  const label = new Int32Array(width * height).fill(-1);
  const parts: Part[] = [];
  const minSize = Math.max(4, width * height * MIN_PART_RATIO);
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] < 16) continue;
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
        if (q >= 0 && label[q] === -1 && data[q * 4 + 3] >= 16) {
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
function cutOut(img: Rgba, parts: Part[]): Rgba | null {
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

/** 96×96 に収め、下端の中央が地面に接する点になるよう、下に寄せて左右中央に置く */
async function writeItem(itemId: string, piece: Rgba): Promise<void> {
  const scale = Math.min(MAX_W / piece.width, MAX_H / piece.height);
  const w = Math.max(1, Math.round(piece.width * scale));
  const h = Math.max(1, Math.round(piece.height * scale));
  const resized = await sharp(piece.data, { raw: { width: piece.width, height: piece.height, channels: 4 } })
    .resize(w, h, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.round((SIZE - w) / 2), top: SIZE - BOTTOM_MARGIN - h }])
    .png({ compressionLevel: 9 })
    .toFile(join(OUT_DIR, `${itemId}.png`));
  console.log(`  ${itemId}.png`);
}

/** シート(行 × 3列)を切り分ける。かたまりは中心がどのマスにあるかで振り分けるので、マス目が少しずれていてもよい */
async function processSheet(file: string, rows: string[][]): Promise<void> {
  const img = await loadRgba(file);
  removeWhiteBackground(img);
  const parts = findParts(img);
  const cellW = img.width / 3;
  const cellH = img.height / rows.length;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const inCell = parts.filter((p) => Math.floor(p.cx / cellW) === c && Math.floor(p.cy / cellH) === r);
      const piece = cutOut(img, inCell);
      if (piece) await writeItem(rows[r][c], piece);
      else console.warn(`  ! ${rows[r][c]}: マスに絵が見つかりません`);
    }
  }
}

async function processSingle(file: string, itemId: string): Promise<void> {
  const img = await loadRgba(file);
  removeWhiteBackground(img);
  const piece = cutOut(img, findParts(img));
  if (piece) await writeItem(itemId, piece);
  else console.warn(`  ! ${itemId}: 絵が見つかりません`);
}

const listImages = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(f).toLowerCase())) : [];

/** 出力フォルダにある絵から、courses.ts が読む一覧を作り直す(?v= は中身が変わったときにブラウザのキャッシュを効かせないため) */
function writeGenerated(): void {
  const urls: [string, string][] = [];
  for (const f of listImages(OUT_DIR).sort()) {
    const itemId = basename(f, extname(f));
    if (!TANE_ITEM_BY_ID.has(itemId)) {
      console.warn(`! ${f}: アイテムID に無いので一覧に入れません`);
      continue;
    }
    const hash = createHash("sha1").update(readFileSync(join(OUT_DIR, f))).digest("hex").slice(0, 8);
    urls.push([itemId, `/chizu-tane/items/${f}?v=${hash}`]);
  }
  const body = urls.map(([id, url]) => `  ${JSON.stringify(id)}: ${JSON.stringify(url)},`).join("\n");
  writeFileSync(
    GENERATED,
    `// scripts/chizu-tane/process-item-images.mts が作るファイル。手で直さない\n` +
      `// 絵のあるアイテム(アイテムID → 画像の URL)。courses.ts がアイテムの imageUrl にする\n` +
      `export const ITEM_IMAGE_URLS: Record<string, string> = {\n${body}${body ? "\n" : ""}};\n`
  );
  console.log(`一覧を更新: 絵のあるアイテム ${urls.length} / ${TANE_ITEMS.length}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const only = new Set(process.argv.slice(2));
  const pick = (name: string) => only.size === 0 || only.has(name);

  for (const f of listImages(SHEETS_DIR)) {
    const sheetId = basename(f, extname(f));
    if (!pick(sheetId)) continue;
    const rows = sheetRows(sheetId);
    if (!rows) {
      console.warn(`! sheets/${f}: シートID が分かりません(plant-1 〜 building-4)`);
      continue;
    }
    console.log(`sheets/${f}（${rows.length}行 × 3）`);
    await processSheet(join(SHEETS_DIR, f), rows);
  }
  for (const f of listImages(SINGLES_DIR)) {
    const itemId = basename(f, extname(f));
    if (!pick(itemId)) continue;
    if (!TANE_ITEM_BY_ID.has(itemId)) {
      console.warn(`! singles/${f}: アイテムID が分かりません`);
      continue;
    }
    console.log(`singles/${f}`);
    await processSingle(join(SINGLES_DIR, f), itemId);
  }
  writeGenerated();
}

await main();
