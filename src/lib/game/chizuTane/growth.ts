// 地図タネの、まいたタネ(拠点)の育ち方。画面と Lambda の両方から使う(ブラウザ・Node のどちらにも依存しない)。
// 設計書は docs/地図タネ_全体設計書.md の 5.1・5.5。
//
// まく → タネ → 芽 → 若葉 → つぼみ → 花 → 実り。時間では育たず、必ず水をやって育つ(芽が出るのも水)。
// 水は、現地のチェックイン(持ち主でもほかの人でも。チェックイン＝水やり)1回で10、持ち主が遠くからやると1(10分の1)。
// たまった水が WATER_TO_RIPE になると実って、実が FRUITS_WHEN_RIPE 個できる。実は現地にチェックインした人が誰でも1個ずつもらえ
// (1人1つの時間帯に1回、早い者勝ち)、全部なくなるとランクが1つ上がって「タネ待ち」になる。実っている間は水をやっても変わらない。
// タネ待ちの畑は、持ち主が同じ種類の畑のタネをまき直すと、またタネから育つ(遠くからでもまける)。1週間まかなければ空き地に戻る。
// 実の数はランクとともに増える(ランク1は10個、ランク2は20個…。人が来て育ててくれた畑ほど豊かになる)

export interface GrowthStage {
  label: string;
  emoji: string;
}

/** 段階。まいたばかりはタネで、最後が実り */
export const GROWTH_STAGES: GrowthStage[] = [
  { label: "タネ", emoji: "🌰" },
  { label: "芽", emoji: "🌱" },
  { label: "若葉", emoji: "🌿" },
  { label: "つぼみ", emoji: "🌼" },
  { label: "花", emoji: "🌸" },
  { label: "実り", emoji: "✨" },
];
export const RIPE_STAGE = GROWTH_STAGES.length - 1;

/** 現地のチェックイン1回の水と、遠くからの水やり1回の水(仮) */
export const WATER_ONSITE = 10;
export const WATER_REMOTE = 1;
/** これだけたまると実る(現地なら5回、遠くからなら50回。仮) */
export const WATER_TO_RIPE = WATER_ONSITE * RIPE_STAGE;
/** ランク1で実ったときにできる実の数(仮)。ランクが1つ上がるごとにこれだけ増える */
export const FRUITS_WHEN_RIPE = 10;

/** そのランクで実ったときにできる実の数 */
export function fruitsWhenRipe(rank: number): number {
  return FRUITS_WHEN_RIPE * Math.max(1, rank);
}
/** ランクの上限(コースの表の10段階) */
export const MAX_RANK = 10;

export interface GrowingBase {
  water?: number | null;
  fruits?: number | null;
  /** 実が全部取られて、持ち主がタネをまき直すのを待っている(待ち始めた日時) */
  waitingSince?: string | null;
}

/**
 * タネ待ちの畑が空き地に戻るまでの区切り(geo.ts の slotKey の区切り)の数。朝・昼・夜の3つ × 7日 = 1週間。
 * dev は区切りが5分なので 105分
 */
export const REPLANT_LIMIT_SLOTS = 21;

/** タネ待ち(実が全部取られて、まき直しを待っている)か */
export function isWaitingReplant(base: GrowingBase): boolean {
  return !!base.waitingSince;
}

/** タネ待ちの畑が空き地に戻る日時(タネ待ちでなければ null)。slotMs は区切りの長さ(本番は8時間) */
export function replantDeadline(base: GrowingBase, slotMs: number): Date | null {
  if (!base.waitingSince) return null;
  return new Date(Date.parse(base.waitingSince) + REPLANT_LIMIT_SLOTS * slotMs);
}

/** タネ待ちのまま期限が過ぎた(空き地に戻った)か。空き地に戻った畑は、誰でも新しくタネをまける */
export function isAbandoned(base: GrowingBase, now: Date, slotMs: number): boolean {
  const deadline = replantDeadline(base, slotMs);
  return deadline !== null && deadline.getTime() <= now.getTime();
}

/** いまの段階。0(タネ)〜 RIPE_STAGE(実り) */
export function growthStage(base: GrowingBase): number {
  if ((base.fruits ?? 0) > 0) return RIPE_STAGE;
  return Math.min(RIPE_STAGE - 1, Math.floor((base.water ?? 0) / WATER_ONSITE));
}

/** 実るまでに、あと何回水をやればよいか(現地のチェックインなら何回、遠くからなら何回)。実っていれば null */
export function waterUntilRipe(base: GrowingBase): { onsite: number; remote: number } | null {
  if ((base.fruits ?? 0) > 0) return null;
  const rest = Math.max(0, WATER_TO_RIPE - (base.water ?? 0));
  return { onsite: Math.ceil(rest / WATER_ONSITE), remote: Math.ceil(rest / WATER_REMOTE) };
}
