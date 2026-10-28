// 地図タネの「いまいる地区」の判定で使う、市区町村ごとの範囲(四隅の緯度・経度)の一覧を作る。
// 都道府県・市区町村の geojson は大きい(北海道の市区町村は 7MB 超)ので、画面からは毎回読まず、
// この一覧で現在地を囲む市区町村を絞ってから、その市区町村の町丁 geojson だけを読む。
// 47都道府県分を読むのはこのスクリプトを動かすときだけ(2020年の境界なので、作り直すのは境界データが変わったとき)
//
//   node scripts/chizu-tane/build-municipality-bounds.mjs
//
// 出力: public/chizu-tane/municipality-bounds.json  [[prefCode, cityCode, minLng, minLat, maxLng, maxLat], ...]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLOUDFRONT_URL = "https://dbr7d89af0fox.cloudfront.net";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../public/chizu-tane/municipality-bounds.json");
// 境界のすぐ外で判定から漏れないよう、少しだけ広げる(約200m)
const PAD = 0.002;

function extend(box, coords) {
  if (typeof coords[0] === "number") {
    const [lng, lat] = coords;
    box[0] = Math.min(box[0], lng);
    box[1] = Math.min(box[1], lat);
    box[2] = Math.max(box[2], lng);
    box[3] = Math.max(box[3], lat);
    return;
  }
  for (const c of coords) extend(box, c);
}

const round = (v) => Math.round(v * 10000) / 10000;

const rows = [];
for (let p = 1; p <= 47; p++) {
  const prefCode = String(p).padStart(2, "0");
  const res = await fetch(`${CLOUDFRONT_URL}/geojson/municipality/2020/${prefCode}.geojson`);
  if (!res.ok) throw new Error(`${prefCode}: HTTP ${res.status}`);
  const data = await res.json();
  const boxes = new Map();
  for (const f of data.features) {
    if (!f.geometry) continue;
    const cityCode = String(f.properties.cityCode);
    const box = boxes.get(cityCode) ?? [Infinity, Infinity, -Infinity, -Infinity];
    extend(box, f.geometry.coordinates);
    boxes.set(cityCode, box);
  }
  for (const [cityCode, b] of boxes) {
    rows.push([prefCode, cityCode, round(b[0] - PAD), round(b[1] - PAD), round(b[2] + PAD), round(b[3] + PAD)]);
  }
  console.log(`${prefCode}: ${boxes.size}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rows));
console.log(`${rows.length} municipalities -> ${OUT}`);
