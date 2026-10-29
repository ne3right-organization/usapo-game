// 地図タネの、まいたタネ(拠点)の育ち方。画面と Lambda の両方から使う(ブラウザ・Node のどちらにも依存しない)。
// 設計書は docs/地図タネ_全体設計書.md の 5.1・5.5。
//
// まく → タネ → 芽 → 若葉 → つぼみ → 花 → 実り。時間では育たず、必ず水をやって育つ(芽が出るのも水)。
// 水は、現地のチェックイン(持ち主でもほかの人でも。チェックイン＝水やり)1回で10、持ち主が遠くからやると1(10分の1)。
// たまった水が WATER_TO_RIPE になると実って、実が FRUITS_WHEN_RIPE 個できる。実は現地にチェックインした人が誰でも1個ずつもらえ
// (1人1つの時間帯に1回、早い者勝ち)、全部なくなると芽に戻ってランクが1つ上がる。実っている間は水をやっても変わらない。
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
