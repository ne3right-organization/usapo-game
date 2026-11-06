// うさぽ農園の毎日のガチャ(2026-11-06)。無料で、平日は1日1回、土日祝は朝・昼・夜に1回ずつ(1日3回)引けて、当たりも出やすい
// (1日は水やりと同じく日本時間の朝4時から。dev は水やりと同じ短い区切りごとに1回)。
// 出るのはタネか実(引く人のいまのレベルまでの種類)で、まれになぞのタネ(mysteryItems.ts。まくとレアな畑になり、こくみんうさぎのぬいぐるみがなる)。
// 画面(ホームのガチャ)と Lambda(chizu-tane-seeds の drawTaneGacha)の両方から使う。
// 出る確率と中身はここで決める(遊んでいる人の様子を見て調整する)

import { TANE_BASE_TYPE_BY_ID, TANE_ITEMS, type TaneItem } from "./courses";
import { MYSTERY_ITEMS } from "./mysteryItems";
import { DAY_MS_PRODUCTION, slotKey } from "./geo";
import { OFFICIAL_OWNER_ID } from "./official";

/** 出る確率(全体に対する割合。実は残り) */
export interface GachaRates {
  /** なぞのタネ */
  mystery: number;
  /** ふつうのタネ */
  seed: number;
}

/** 平日の確率(レア5%・タネ25%・実70%)。タネは増えやすいので、実を多めに */
export const GACHA_RATES_WEEKDAY: GachaRates = { mystery: 0.05, seed: 0.25 };
/** 土日祝の確率(レア20%・タネ50%・実30%) */
export const GACHA_RATES_HOLIDAY: GachaRates = { mystery: 0.2, seed: 0.5 };
/** 平日のなぞのタネの確率(管理画面に出す) */
export const GACHA_MYSTERY_RATE = GACHA_RATES_WEEKDAY.mystery;

/**
 * 祝日(振替休日・国民の休日を含む。内閣府の「国民の祝日」)。計算では出しにくい(春分・秋分の日、振替休日)ので、年ごとに書いておく。
 * **毎年、翌年の分を足す**(内閣府が前の年の2月ごろに発表する)。無い年は土日だけになる
 */
export const JP_HOLIDAYS = new Set([
  // 2026年(令和8年)
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  // 【動作確認用。本番に出す前に消す】土日祝のガチャを dev で試すため、2026-11-06 を祝日にしている
  "2026-11-06",
  // 2027年(令和9年)
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04",
  "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
]);

/** ガチャの「1日」の日付(日本時間の朝4時で切り替わる。水やりの朝・昼・夜と同じ) */
export function gachaDate(now: Date): string {
  return slotKey(now, DAY_MS_PRODUCTION).slice(0, 10);
}

/** 土日祝(1日3回引けて、当たりが出やすい日)か */
export function isGachaHoliday(now: Date): boolean {
  const date = gachaDate(now);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6 || JP_HOLIDAYS.has(date);
}

/** その日の確率 */
export function gachaRates(now: Date): GachaRates {
  return isGachaHoliday(now) ? GACHA_RATES_HOLIDAY : GACHA_RATES_WEEKDAY;
}

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

/** ガチャを1回引く。level は引く人のいまのレベル、rates はその日の確率(gachaRates) */
export function drawGacha(level: number, rates: GachaRates, random: () => number = Math.random): GachaPrize {
  const r = random();
  if (r < rates.mystery) return { kind: "seed", item: pick(MYSTERY_ITEMS, random), mystery: true };
  const kind = r < rates.mystery + rates.seed ? "seed" : "fruit";
  return { kind, item: pick(gachaPool(level), random), mystery: false };
}

/**
 * 1回引ける区切り。本番の平日は1日(朝4時から)、土日祝は朝・昼・夜(水やりと同じ区切り)。
 * それ以外(dev)は試しやすいように、チェックインと同じ短い区切り(土日祝かどうかは本番と同じく日付で見る)
 */
export function gachaDayKey(now: Date, dayMs: number): string {
  if (dayMs !== DAY_MS_PRODUCTION) return slotKey(now, dayMs);
  return isGachaHoliday(now) ? slotKey(now, dayMs) : gachaDate(now);
}
