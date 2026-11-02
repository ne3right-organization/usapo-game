// うさぽ農園(地図タネ)のアイテムの絵を、画像生成AIで作った画像からゲーム用の PNG にする。
// 手順は docs/地図タネ_絵の作り方.md の手順3。
//
//   npx tsx scripts/chizu-tane/process-item-images.mts            # art/chizu-tane/ にある画像を全部
//   npx tsx scripts/chizu-tane/process-item-images.mts plant-1    # シートや単品を指定して
//
// 入力(art/chizu-tane/。元の画像は大きいので git には入れない):
//   sheets/{シートID}.png   作業表の1シート(3×3。Lv.10 のシートは 1×3)。シートID は plant-1 〜 building-4
//   sheets/growth.png       まいたタネの育つ途中の絵(2×3。タネ・芽・若葉 / つぼみ・花・タネ待ちの空き地)
//   sheets/local-{都道府県コード}-{何個目}.png  ご当地のもの(1×5。植物・動物・趣味・乗り物・建物。頼む文は local-art-prompts.mts で出す)
//   singles/{アイテムID}.png 1点だけ作り直したもの(例: orchard_1.png。育つ途中の絵は growth_0 〜 growth_4・growth_waiting)
// 出力:
//   public/chizu-tane/items/{アイテムID}.png  96×96、背景透過、下端の中央が地面に接する点
//   src/lib/game/chizuTane/itemImages.generated.ts  絵のあるアイテムの一覧(courses.ts が imageUrl に使う)
//   public/chizu-tane/growth/growth_{段階}.png と growthImages.generated.ts  育つ途中の絵(段階は growth.ts の GROWTH_STAGES の番号。
//   実りは畑の実の絵を出すので無い。waiting は実が全部取られたあとのタネ待ち)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as coursesModule from "../../src/lib/game/chizuTane/courses";
import * as localItemsModule from "../../src/lib/game/chizuTane/localItems";
import { GROWTH_ROWS, GROWTH_SHEET_ID, type Rgba, cutOut, cutSheet, findParts, loadRgba, removeWhiteBackground, sheetRows } from "./itemArt.mjs";

// package.json が "type": "module" ではないので、tsx で動かすと courses.ts は CommonJS として読まれ、中身は default に入る。
// 型の上(next build の型チェック)では ES モジュールなので、どちらでも取り出せるようにする
const courses = (coursesModule as unknown as { default?: typeof coursesModule }).default ?? coursesModule;
const { TANE_ITEM_BY_ID, TANE_ITEMS } = courses;
const { TANE_LOCAL_ITEM_BY_ID } = ((localItemsModule as unknown as { default?: typeof localItemsModule }).default ?? localItemsModule);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHEETS_DIR = join(ROOT, "art/chizu-tane/sheets");
const SINGLES_DIR = join(ROOT, "art/chizu-tane/singles");
const OUT_DIR = join(ROOT, "public/chizu-tane/items");
const GENERATED = join(ROOT, "src/lib/game/chizuTane/itemImages.generated.ts");
const GROWTH_OUT_DIR = join(ROOT, "public/chizu-tane/growth");
const GROWTH_GENERATED = join(ROOT, "src/lib/game/chizuTane/growthImages.generated.ts");

const GROWTH_IDS = new Set(GROWTH_ROWS.flat());
const outDirFor = (id: string) => (GROWTH_IDS.has(id) ? GROWTH_OUT_DIR : OUT_DIR);

const SIZE = 96; // 表示は 48px 前後なので2倍
const MAX_W = 88;
const MAX_H = 90;
const BOTTOM_MARGIN = 3;

const fitScale = (piece: Rgba) => Math.min(MAX_W / piece.width, MAX_H / piece.height);

/** 96×96 に収め、下端の中央が地面に接する点になるよう、下に寄せて左右中央に置く。scale を渡すとその倍率で(シートの中で大きさをそろえる) */
async function writeItem(itemId: string, piece: Rgba, scale = fitScale(piece)): Promise<void> {
  const w = Math.max(1, Math.round(piece.width * scale));
  const h = Math.max(1, Math.round(piece.height * scale));
  const resized = await sharp(piece.data, { raw: { width: piece.width, height: piece.height, channels: 4 } })
    .resize(w, h, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.round((SIZE - w) / 2), top: SIZE - BOTTOM_MARGIN - h }])
    .png({ compressionLevel: 9 })
    .toFile(join(outDirFor(itemId), `${itemId}.png`));
  console.log(`  ${itemId}.png`);
}

/** シート(行 × 列)を切り分ける */
async function processSheet(file: string, rows: string[][], sameScale = false): Promise<void> {
  const pieces: [string, Rgba][] = [];
  for (const [id, piece] of await cutSheet(file, rows)) {
    if (piece) pieces.push([id, piece]);
    else console.warn(`  ! ${id}: マスに絵が見つかりません`);
  }
  // 育つ途中の絵は、同じ土の山が育っていくように見せるため、いちばん大きい絵に合わせた同じ倍率で縮める
  const shared = sameScale ? Math.min(...pieces.map(([, piece]) => fitScale(piece))) : undefined;
  for (const [id, piece] of pieces) await writeItem(id, piece, shared);
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
  const local = urls.filter(([id]) => TANE_LOCAL_ITEM_BY_ID.has(id)).length;
  console.log(`一覧を更新: 絵のあるアイテム ${urls.length - local} / ${TANE_ITEMS.length}、ご当地 ${local} / ${TANE_LOCAL_ITEM_BY_ID.size}`);
}

/** 育つ途中の絵の一覧を作り直す(growth_{段階}.png → 段階の番号か waiting) */
function writeGrowthGenerated(): void {
  const urls: [string, string][] = [];
  for (const f of listImages(GROWTH_OUT_DIR).sort()) {
    const id = basename(f, extname(f));
    if (!GROWTH_IDS.has(id)) continue;
    const hash = createHash("sha1").update(readFileSync(join(GROWTH_OUT_DIR, f))).digest("hex").slice(0, 8);
    urls.push([id.slice("growth_".length), `/chizu-tane/growth/${f}?v=${hash}`]);
  }
  const body = urls.map(([stage, url]) => `  ${JSON.stringify(stage)}: ${JSON.stringify(url)},`).join("\n");
  writeFileSync(
    GROWTH_GENERATED,
    `// scripts/chizu-tane/process-item-images.mts が作るファイル。手で直さない\n` +
      `// 育つ途中の絵(growth.ts の GROWTH_STAGES の番号か waiting(タネ待ち) → 画像の URL)。無いときは絵文字などを出す\n` +
      `export const GROWTH_IMAGE_URLS: Record<string, string> = {\n${body}${body ? "\n" : ""}};\n`
  );
  console.log(`一覧を更新: 絵のある育つ途中の段階 ${urls.length} / ${GROWTH_IDS.size}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(GROWTH_OUT_DIR, { recursive: true });
  const only = new Set(process.argv.slice(2));
  const pick = (name: string) => only.size === 0 || only.has(name);

  for (const f of listImages(SHEETS_DIR)) {
    const sheetId = basename(f, extname(f));
    if (!pick(sheetId)) continue;
    const rows = sheetRows(sheetId);
    if (!rows) {
      console.warn(`! sheets/${f}: シートID が分かりません(plant-1 〜 building-4、growth、ご当地の local-01-1 〜 local-47-3)`);
      continue;
    }
    console.log(`sheets/${f}（${rows.length}行 × ${Math.max(...rows.map((r) => r.length))}）`);
    await processSheet(join(SHEETS_DIR, f), rows, sheetId === GROWTH_SHEET_ID);
  }
  for (const f of listImages(SINGLES_DIR)) {
    const itemId = basename(f, extname(f));
    if (!pick(itemId)) continue;
    if (!TANE_ITEM_BY_ID.has(itemId) && !GROWTH_IDS.has(itemId)) {
      console.warn(`! singles/${f}: アイテムID が分かりません`);
      continue;
    }
    console.log(`singles/${f}`);
    await processSingle(join(SINGLES_DIR, f), itemId);
  }
  writeGenerated();
  writeGrowthGenerated();
}

await main();
