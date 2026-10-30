import type L from "leaflet";
import { TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { GROWTH_STAGES, RIPE_STAGE, growthStage, isWaitingReplant, type GrowingBase } from "@/lib/game/chizuTane/growth";
import { GROWTH_IMAGE_URLS } from "@/lib/game/chizuTane/growthImages.generated";

// 地図に出すタネのアイコン(全国農地とおでかけで同じもの)。自分のタネか他人のタネかではなく、育ち具合で見せる:
// タネ〜花はその段階の絵(無ければ絵文字)を緑の丸で、実っていれば実(梨の木など)の絵(無ければ絵文字)を金色の丸で囲み、少し大きくする。タネ待ちは何も無いことが分かるよう、茶色の枠の白い丸(空き地の絵があればその絵を入れる)。
// hidden(ほかの人のご当地の畑。localItems.ts の isHiddenLocalBase)は、実っていても実の絵の代わりに「？」を出す

export const GROWING_COLOR = "#10b981";
export const RIPE_COLOR = "#f59e0b";
export const WAITING_COLOR = "#a16207";

export function taneMarkerIcon(Lmod: typeof L, base: GrowingBase & { seedItemId: string }, hidden = false): L.DivIcon {
  // 大きさは style で指定する(Leaflet の CSS がマーカーの中の img を width: auto にするので、width 属性だと元の 96px で出てしまう)
  const img = (url: string, px: number) =>
    `<img src="${url}" alt="" style="display:block;width:${px}px;height:${px}px;max-width:none" />`;
  if (isWaitingReplant(base)) {
    const waiting = GROWTH_IMAGE_URLS.waiting ? img(GROWTH_IMAGE_URLS.waiting, 20) : "";
    return Lmod.divIcon({
      className: "",
      html: `<div style="width:28px;height:28px;border-radius:9999px;border:3px solid ${WAITING_COLOR};background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center">${waiting}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }
  const stage = growthStage(base);
  const ripe = stage === RIPE_STAGE;
  const size = ripe ? 36 : 28;
  const fruit = ripe ? TANE_ITEM_BY_ID.get(base.seedItemId) : undefined;
  // 実ったら、もらえる実と同じ絵を出す(絵文字だと、もらった実の絵と見た目がちがいすぎるため)
  const content = ripe
    ? hidden
      ? "❓"
      : fruit?.imageUrl
        ? img(fruit.imageUrl, 26)
        : (fruit?.emoji ?? "✨")
    : GROWTH_IMAGE_URLS[String(stage)]
      ? img(GROWTH_IMAGE_URLS[String(stage)], 20)
      : GROWTH_STAGES[stage].emoji;
  const ring = ripe
    ? `border:3px solid ${RIPE_COLOR};background:#fffbeb;box-shadow:0 0 0 3px rgba(245,158,11,.25),0 1px 4px rgba(0,0,0,.25)`
    : `border:3px solid ${GROWING_COLOR};background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)`;
  return Lmod.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;${ring};display:flex;align-items:center;justify-content:center;font-size:${ripe ? 20 : 15}px;line-height:1">${content}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
