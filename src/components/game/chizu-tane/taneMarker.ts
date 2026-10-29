import type L from "leaflet";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { GROWTH_STAGES, RIPE_STAGE, growthStage, type GrowingBase } from "@/lib/game/chizuTane/growth";

// 地図に出すタネのアイコン(全国農地とおでかけで同じもの)。自分のタネか他人のタネかではなく、育ち具合で見せる:
// タネ〜花はその段階の絵文字を緑の丸で、実っていれば実(梨の木など)の絵文字を金色の丸で囲み、少し大きくする

export const GROWING_COLOR = "#10b981";
export const RIPE_COLOR = "#f59e0b";

export function taneMarkerIcon(Lmod: typeof L, base: GrowingBase & { seedItemId: string }): L.DivIcon {
  const stage = growthStage(base);
  const ripe = stage === RIPE_STAGE;
  const emoji = ripe ? (TANE_ITEM_BY_ID.get(base.seedItemId)?.emoji ?? "✨") : GROWTH_STAGES[stage].emoji;
  const size = ripe ? 36 : 28;
  const ring = ripe
    ? `border:3px solid ${RIPE_COLOR};background:#fffbeb;box-shadow:0 0 0 3px rgba(245,158,11,.25),0 1px 4px rgba(0,0,0,.25)`
    : `border:3px solid ${GROWING_COLOR};background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)`;
  return Lmod.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;${ring};display:flex;align-items:center;justify-content:center;font-size:${ripe ? 20 : 15}px;line-height:1">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
