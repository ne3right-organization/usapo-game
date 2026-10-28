// 地図タネの、まいたタネ(拠点)の育ち方。画面と Lambda の両方から使う(ブラウザ・Node のどちらにも依存しない)。
// 設計書は docs/地図タネ_全体設計書.md の 5.1。
//
// まく → 1日たつと芽が出る → 芽 → 若葉 → つぼみ → 花 → 実り。
// 1日たつと1段階育ち、チェックイン(持ち主の水やりでも、ほかの人の訪問でも)があるとさらに1段階進む。
// 実ったタネに持ち主が現地でチェックインすると収穫で、もの3つとタネ1個がもらえ、芽に戻ってランクが1つ上がる

import { msUntilSprout } from "./geo";

export interface GrowthStage {
  label: string;
  emoji: string;
}

/** 芽が出てからの段階。最後が実り */
export const GROWTH_STAGES: GrowthStage[] = [
  { label: "芽", emoji: "🌱" },
  { label: "若葉", emoji: "🌿" },
  { label: "つぼみ", emoji: "🌼" },
  { label: "花", emoji: "🌸" },
  { label: "実り", emoji: "✨" },
];
export const RIPE_STAGE = GROWTH_STAGES.length - 1;

/** 収穫でもらえる数(仮) */
export const HARVEST_ITEMS = 3;
export const HARVEST_SEEDS = 1;
/** ランクの上限(コースの表の10段階) */
export const MAX_RANK = 10;

export interface GrowingBase {
  plantedAt: string;
  /** いまの育ちの始まり(芽が出たとき、または前に収穫したとき)。無ければ芽が出たときから */
  growFrom?: string | null;
  /** いまの育ちの間にあったチェックインの数 */
  waterCount?: number | null;
}

/**
 * いまの段階。まだ芽が出ていなければ -1、出ていれば 0(芽)〜 RIPE_STAGE(実り)。
 * dayMs は「1日」の長さ(芽が出るまでの時間と同じ。本番は24時間、dev は5分)
 */
export function growthStage(base: GrowingBase, now: Date, dayMs: number): number {
  if (msUntilSprout(base.plantedAt, now, dayMs) > 0) return -1;
  const from = base.growFrom ? new Date(base.growFrom).getTime() : new Date(base.plantedAt).getTime() + dayMs;
  const days = Math.max(0, Math.floor((now.getTime() - from) / dayMs));
  return Math.min(RIPE_STAGE, days + (base.waterCount ?? 0));
}
