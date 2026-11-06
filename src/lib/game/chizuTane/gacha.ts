// うさぽ農園の毎日のガチャ(2026-11-06)。1日1回(本番は日本時間の日付、dev は水やりと同じ短い区切り)、無料で引ける。
// 出るのはタネか実(引く人のいまのレベルまでの種類)で、まれになぞのタネ(mysteryItems.ts。まくとレアな畑になり、こくみんうさぎのぬいぐるみがなる)。
// 画面(ホームのガチャ)と Lambda(chizu-tane-seeds の drawTaneGacha)の両方から使う。
// 出る確率と中身はここで決める(遊んでいる人の様子を見て調整する)

import { TANE_BASE_TYPE_BY_ID, TANE_ITEMS, type TaneItem } from "./courses";
import { MYSTERY_ITEMS } from "./mysteryItems";
import { OFFICIAL_OWNER_ID, officialDayKey } from "./official";

/** なぞのタネが出る確率(1日1回引いて、月に1〜2個) */
export const GACHA_MYSTERY_RATE = 0.05;
/** なぞのタネ以外のうち、タネが出る確率(残りは実。タネは増えやすいので、実を多めに) */
export const GACHA_SEED_RATE = 0.3;

/** ガチャの実の収穫の記録に入れる生産者(画面では「うさぽ農園」。公式の畑と同じ) */
export const GACHA_OWNER_ID = OFFICIAL_OWNER_ID;
/** ガチャの実の産地(収穫の記録・集めたものに出す) */
export const GACHA_PLACE = { prefName: "", cityName: "うさぽ農園", townName: "ガチャ" } as const;

export interface GachaPrize {
  kind: "seed" | "fruit";
  item: TaneItem;
  /** なぞのタネ(大当たり) */
  mystery: boolean;
}

/** なぞのタネ以外で出るもの。引く人のいまのレベルまでの種類の、どのコースのものでも */
export function gachaPool(level: number): TaneItem[] {
  return TANE_ITEMS.filter((i) => (TANE_BASE_TYPE_BY_ID.get(i.baseTypeId)?.unlockLevel ?? Infinity) <= level);
}

const pick = <T>(list: T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

/** ガチャを1回引く。level は引く人のいまのレベル */
export function drawGacha(level: number, random: () => number = Math.random): GachaPrize {
  if (random() < GACHA_MYSTERY_RATE) return { kind: "seed", item: pick(MYSTERY_ITEMS, random), mystery: true };
  const kind = random() < GACHA_SEED_RATE ? "seed" : "fruit";
  return { kind, item: pick(gachaPool(level), random), mystery: false };
}

/** 「1日1回」の区切り(本番は日本時間の日付。それ以外は試しやすいように、チェックインと同じ短い区切り)。公式の畑と同じ */
export function gachaDayKey(now: Date, dayMs: number): string {
  return officialDayKey(now, dayMs);
}
