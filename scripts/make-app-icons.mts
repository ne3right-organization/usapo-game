// アプリのアイコン(ホーム画面・タブ・通知)を、うさぽ農園の実の絵を並べて作る。
//
//   npx tsx scripts/make-app-icons.mts
//
// 実の絵は、画像生成AIで作った元のシート(art/chizu-tane/sheets/。git には入れていない)から大きいまま切り抜く
// (ゲーム用の public/chizu-tane/items/ は 96px で、アイコンには小さいため)。置く実と場所は下の ICON_ITEMS で変える。
// 背景は空と丘(BACKGROUND_SVG)。iPhone のアイコンは透明にできないので、端まで塗る

import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { type Rgba, cutSheet, sheetRows } from "./chizu-tane/itemArt.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHEETS_DIR = path.join(ROOT, "art/chizu-tane/sheets");
const SIZE = 512;

/** 置く実(奥から順に描く)。x は下端の中央、bottom は地面に接する高さ、height は絵の高さ(どれも 512px の画面で) */
const ICON_ITEMS: { itemId: string; sheet: string; x: number; bottom: number; height: number }[] = [
  // 奥の段: カメラ・すずめ・パン屋さん
  { itemId: "photo_spot_1", sheet: "hobby-1", x: 100, bottom: 290, height: 115 }, // カメラ(一眼レフ)
  { itemId: "bird_woods_1", sheet: "animal-1", x: 232, bottom: 290, height: 105 }, // すずめ
  { itemId: "bakery_3", sheet: "building-1", x: 392, bottom: 300, height: 200 }, // パン屋さん
  // 手前の段: チューリップ・自転車
  { itemId: "flower_field_1", sheet: "plant-1", x: 165, bottom: 455, height: 145 }, // チューリップ
  { itemId: "cycle_port_1", sheet: "vehicle-1", x: 350, bottom: 455, height: 140 }, // 自転車
];

/** カメラからパン屋さんにかける虹(丘より奥に描くので、両端は丘に隠れる)。cx は真ん中、r はいちばん外の色の半径 */
const RAINBOW = { cx: 246, cy: 260, r: 160, band: 9, opacity: 0.75 };
const RAINBOW_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#8ce99a", "#74c0fc", "#748ffc", "#b197fc"];
const RAINBOW_SVG = RAINBOW_COLORS.map((color, i) => {
  const r = RAINBOW.r - RAINBOW.band * i;
  return `<path d="M ${RAINBOW.cx - r} ${RAINBOW.cy} A ${r} ${r} 0 0 1 ${RAINBOW.cx + r} ${RAINBOW.cy}" fill="none" stroke="${color}" stroke-width="${RAINBOW.band + 0.5}" opacity="${RAINBOW.opacity}"/>`;
}).join("\n  ");

const BACKGROUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fd8ff"/>
      <stop offset="1" stop-color="#e8f6ff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#sky)"/>
  ${RAINBOW_SVG}
  <path d="M0 250 C 100 200, 210 200, 300 240 C 380 205, 460 205, 512 225 L512 512 L0 512 Z" fill="#a8da78"/>
  <path d="M0 330 C 130 295, 300 295, 512 320 L512 512 L0 512 Z" fill="#86c95a"/>
</svg>`;

/**
 * 出すファイル。maskable はホーム画面で端が丸く切れてもよいよう、実を中央に寄せて小さくしたもの
 * (manifest.ts。安全なのは中央の直径8割の円)
 */
const OUTPUTS: { file: string; size: number; maskable?: boolean }[] = [
  { file: "public/icons/icon-512.png", size: 512 },
  { file: "public/icons/icon-maskable-512.png", size: 512, maskable: true },
  { file: "public/icons/icon-192.png", size: 192 },
  { file: "src/app/apple-icon.png", size: 180 },
  { file: "src/app/icon.png", size: 64 },
];
const MASKABLE_SCALE = 0.78;

async function loadPieces(): Promise<Map<string, Rgba>> {
  const pieces = new Map<string, Rgba>();
  for (const sheet of new Set(ICON_ITEMS.map((i) => i.sheet))) {
    const file = path.join(SHEETS_DIR, `${sheet}.png`);
    const rows = sheetRows(sheet);
    if (!existsSync(file) || !rows) throw new Error(`${file} がありません(元のシートは git に入っていないので、手元に置いてから動かす)`);
    for (const [id, piece] of await cutSheet(file, rows)) if (piece) pieces.set(id, piece);
  }
  return pieces;
}

async function compose(pieces: Map<string, Rgba>, scale: number): Promise<Buffer> {
  const layers: sharp.OverlayOptions[] = [];
  for (const item of ICON_ITEMS) {
    const piece = pieces.get(item.itemId);
    if (!piece) throw new Error(`${item.itemId} の絵が ${item.sheet} にありません`);
    const h = Math.round(item.height * scale);
    const w = Math.round((piece.width * h) / piece.height);
    const input = await sharp(piece.data, { raw: { width: piece.width, height: piece.height, channels: 4 } })
      .resize(w, h, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    // 中央(256, 256)を中心に縮める
    const x = SIZE / 2 + (item.x - SIZE / 2) * scale;
    const bottom = SIZE / 2 + (item.bottom - SIZE / 2) * scale;
    layers.push({ input, left: Math.round(x - w / 2), top: Math.round(bottom - h) });
  }
  return sharp(Buffer.from(BACKGROUND_SVG)).composite(layers).png().toBuffer();
}

const pieces = await loadPieces();
const full = await compose(pieces, 1);
const maskable = await compose(pieces, MASKABLE_SCALE);
for (const { file, size, maskable: isMaskable } of OUTPUTS) {
  await sharp(isMaskable ? maskable : full)
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, file));
  console.log(`${file} (${size}px)`);
}
