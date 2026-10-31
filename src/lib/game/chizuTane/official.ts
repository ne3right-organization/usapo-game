// うさぽ農園の公式の畑(2026-10-31)。遊ぶ人が少なく、近くにほかの人の畑が無くてもレベルが上がるように置く。
// 画面(トップの「公式の畑」)と Lambda(chizu-tane-checkin の checkInTaneOfficialField)の両方から使う。
// - コースごとに Lv.1 の種類の、ランク1〜3 のもの(タネ)の畑が1つずつ(5コース×3 = 15か所。果樹園なら みかんの木・梨の木・いちご畑)。
//   自分のコースの3か所は出さず、ほかのコースの12か所を使う。はじめからほかのコースの Lv.1 のもの全部の実が集められる
//   (12か所はちょうど Lv.3 の条件。本番の上限 Lv.3 まで公式の畑だけで上がれて、その先のご当地のタネは現地に行くしかない)
// - 遠くからチェックインでき、初めての公式の畑はたずねたタネ1か所と数える。新しい公式の畑は1日 OFFICIAL_DAILY_LIMIT か所まで
// - いつも実っていて、1つの公式の畑から1人1個だけ、その畑の実とタネを1個ずつもらう(チェックインと同時に)。
//   タネはほかのコースのものでも、おでかけでまける(まくのにレベルの制限は無い)
// - 実際の地区は持たず、全国農地の地図にも出さない。タネは落とさない(拾う人がいないので)。手伝いの回数にも数えない

import { TANE_BASE_TYPES, TANE_ITEMS, type TaneBaseType, type TaneCourse, type TaneItem } from "./courses";
import { DAY_MS_PRODUCTION, jstDate, slotKey } from "./geo";

/** 新しい公式の畑にチェックインできるのは1日にこの数まで */
export const OFFICIAL_DAILY_LIMIT = 3;
/** 公式の畑の実の収穫の記録に入れる生産者の ID(ユーザーの ID とは重ならない) */
export const OFFICIAL_OWNER_ID = "official";
/** 公式の畑の実の産地(収穫の記録・集めたものに出す) */
export const OFFICIAL_PLACE = { prefName: "", cityName: "うさぽ農園", townName: "公式の畑" } as const;

export interface TaneOfficialField {
  /** 畑の目印(もらえる実の itemId と同じ) */
  fieldId: string;
  baseType: TaneBaseType;
  /** もらえる実 */
  item: TaneItem;
}

export const TANE_OFFICIAL_FIELDS: TaneOfficialField[] = TANE_BASE_TYPES.filter((t) => t.unlockLevel === 1).flatMap((baseType) =>
  TANE_ITEMS.filter((i) => i.baseTypeId === baseType.id && i.rank <= 3).map((item) => ({ fieldId: item.itemId, baseType, item }))
);

/** そのコースの人が使える公式の畑(ほかのコースのもの。コースの順、その中はランクの順) */
export function officialFieldsFor(course: TaneCourse): TaneOfficialField[] {
  return TANE_OFFICIAL_FIELDS.filter((f) => f.baseType.course !== course);
}

/** 「1日 OFFICIAL_DAILY_LIMIT か所」の区切り(本番は日本時間の日付。それ以外は試しやすいように、チェックインと同じ短い区切り) */
export function officialDayKey(now: Date, dayMs: number): string {
  return dayMs === DAY_MS_PRODUCTION ? jstDate(now) : slotKey(now, dayMs);
}
