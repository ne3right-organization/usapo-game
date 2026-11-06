// うさぽ農園の「なぞのタネ」(2026-11-06)。毎日のガチャ(gacha.ts)でまれに出るタネで、現地の空き地にまくと「レアな畑」になり、
// 実るとこくみんうさぎのぬいぐるみがなる。育ち方はふつうの畑と同じ(手伝いの水やりも受けられる)だが、
// - 実(ぬいぐるみ)は現地に来た人に1人1個ずつ(畑ごとに1人1個。同じ人が同じぬいぐるみのレアな畑をいくつ作ってもよい)。持ち主も現地に来ないともらえない
//   (実ったときの生産者の取り分・手伝いのお礼・宅急便は無い)。10個全部渡ったら畑はなくなる(1回かぎり。まき直せない)
// - 枯れず、腐らない(growth.ts)。タネは落ちない(なぞのタネはガチャでしか出ない)。おすそ分けの棚にもなぞのタネは出せない
// TANE_ITEMS には入れていないので、レベルアップの条件・コースの表・市場の交換には入らない(TANE_ITEM_BY_ID では引ける)。
// なぞのタネのことは秘密にする(画面の説明・お知らせ・あそびかたには書かず、出た人にだけ出たときに説明する)。
// 何がなるかは実るまで分からないよう、タネのあいだは「なぞのタネ」と出す(asSeedLook)。実るまでは畑の実の名前も伏せる(isHiddenMysteryFruit)

import type { TaneBaseType, TaneItem } from "./courses";
import { ITEM_IMAGE_URLS } from "./itemImages.generated";

export const MYSTERY_BASE_TYPE_ID = "kokumin_usagi";

/** レアな畑(拠点の種類)。コースの表の外(レベルでは手に入らない)。course は集めたものの並べ方のためのもの */
export const MYSTERY_BASE_TYPE: TaneBaseType = { id: MYSTERY_BASE_TYPE_ID, course: "animal", unlockLevel: 12, name: "レアな畑", emoji: "👑" };

/**
 * なぞのタネからなるもの(こくみんうさぎのぬいぐるみ。ポーズちがいで、3の倍数ずつ増やす)。どれになるかはガチャで決まる
 * (なぞのタネは、なるものごとに別のタネ)。絵は本体のこくみんうさぎの絵を見本に、ほかのアイテムと同じ絵柄で描く
 */
export const MYSTERY_ITEMS: TaneItem[] = (
  [
    ["こくみんうさぎのぬいぐるみ（おねがい）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（しょぼん）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（すわる）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（びっくり）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（まる）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（ガッツポーズ）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（演説）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（立ち向かう）", "🐰"],
    ["こくみんうさぎのぬいぐるみ（走る）", "🐰"],
  ] as const
).map(([name, emoji], i) => {
  const itemId = `${MYSTERY_BASE_TYPE_ID}_${i + 1}`;
  return { itemId, baseTypeId: MYSTERY_BASE_TYPE_ID, rank: i + 1, name, emoji, imageUrl: ITEM_IMAGE_URLS[itemId] };
});

export const MYSTERY_ITEM_BY_ID = new Map(MYSTERY_ITEMS.map((i) => [i.itemId, i]));

export function isMysteryItemId(itemId: string): boolean {
  return MYSTERY_ITEM_BY_ID.has(itemId);
}

export function isMysteryBaseTypeId(baseTypeId: string): boolean {
  return baseTypeId === MYSTERY_BASE_TYPE_ID;
}

/** 畑の実の名前を伏せるか(レアな畑は、実るまで何がなるかを伏せる。持ち主にも) */
export function isHiddenMysteryFruit(base: { baseTypeId: string; fruits?: number | null }): boolean {
  return isMysteryBaseTypeId(base.baseTypeId) && (base.fruits ?? 0) <= 0;
}

/**
 * タネとして見せるときの姿。なぞのタネは、何がなるかを伏せて「なぞのタネ」(name は「なぞ」。画面では「○○のタネ」と続ける)。
 * 絵はレアな畑と同じ王冠
 */
export function asSeedLook(item: TaneItem): TaneItem {
  return isMysteryItemId(item.itemId) ? { ...item, name: "なぞ", emoji: MYSTERY_BASE_TYPE.emoji, imageUrl: undefined } : item;
}
