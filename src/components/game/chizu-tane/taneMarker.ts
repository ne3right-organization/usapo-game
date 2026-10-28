import type L from "leaflet";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";

// 地図に出すタネのアイコン(タネ地図とおでかけで同じもの)。まかれたもの(梨の木など)の絵文字を、
// 自分のタネは緑・ほかの人のタネは橙の丸で囲む

export const OWN_COLOR = "#10b981";
export const OTHER_COLOR = "#f59e0b";

export function taneMarkerIcon(Lmod: typeof L, base: { seedItemId: string; baseTypeId: string }, own: boolean): L.DivIcon {
  const emoji = TANE_ITEM_BY_ID.get(base.seedItemId)?.emoji ?? TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.emoji ?? "🌱";
  return Lmod.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:#fff;border:3px solid ${own ? OWN_COLOR : OTHER_COLOR};display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.25)">${emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}
