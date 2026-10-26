"use client";

import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";
import { currentUser } from "@/lib/auth";
import { areaKeyOf, data, rankingKeyOf, unwrap, type Schema } from "@/lib/amplify/data";

// 地図パズルとプロフィールのデータ。Amplify Data(amplify/data/resource.ts)をブラウザから直接呼ぶ。
// 得点・ベスト記録・合計はクライアントから書けず、記録の送信とニックネームの変更は
// カスタムミューテーション(amplify/functions)が行う。設計は docs/amplify_data_migration.md

export type { Difficulty };

export interface AreaInfo {
  difficulty: Difficulty;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

// 都道府県パズル(初級)は全国固定のため、専用のエリアコードで表現する
export const BEGINNER_AREA = { prefCode: "00", prefName: "全国" } as const;

export interface ChallengeSubmission extends AreaInfo {
  totalPieces: number;
  missCount: number;
  elapsedSeconds: number;
  comment?: string;
}

export interface ChallengeRecord extends AreaInfo {
  id: string;
  totalPieces: number;
  missCount: number;
  elapsedSeconds: number;
  baseScore: number;
  timeBonus: number;
  missPenalty: number;
  score: number;
  isNewBest: boolean;
  comment: string | null;
  playedAt: string;
}

export interface ChallengeHistoryPage {
  items: ChallengeRecord[];
  nextCursor: string | null;
}

export interface ProgressPayload extends AreaInfo {
  placedIds: number[];
  missCount: number;
  elapsedSeconds: number;
}

export interface SavedProgressRecord extends AreaInfo {
  id: string;
  placedIds: number[];
  missCount: number;
  elapsedSeconds: number;
  savedAt: string;
}

export interface AreaKey {
  prefCode: string;
  cityCode: string | null;
}

export interface GameProfilePublic {
  userId: string;
  nickname: string | null;
  totalScore: number;
  areasPlayedCount: number;
}

export interface BestRecord extends AreaInfo {
  bestScore: number;
  playCount: number;
  lastPlayedAt: string;
}

export interface RankingEntry extends AreaInfo {
  userId: string;
  nickname: string | null;
  bestScore: number;
  lastPlayedAt: string;
  /** エリア名の代わりに出す補足(1人1行に集計したランキングで「最高〇点(エリア名)」を出す) */
  detail?: string;
  /** 点数の上に添える説明(1人1行に集計したランキングで「〇エリア合計」と出す) */
  scoreCaption?: string;
}

export interface RankingPage {
  items: RankingEntry[];
  nextCursor: string | null;
}

// ─── 変換ヘルパー ────────────────────────────────────────────────────────────

type ChallengeItem = Schema["GameMapPuzzleChallenge"]["type"];
type ProgressItem = Schema["GameMapPuzzleProgress"]["type"];
type BestItem = Schema["GameMapPuzzleBest"]["type"];

function areaOf(item: {
  difficulty: Difficulty | null;
  prefCode: string;
  prefName: string;
  cityCode?: string | null;
  cityName?: string | null;
}): AreaInfo {
  return {
    difficulty: item.difficulty as Difficulty,
    prefCode: item.prefCode,
    prefName: item.prefName,
    cityCode: item.cityCode ?? undefined,
    cityName: item.cityName ?? undefined,
  };
}

function toChallenge(item: ChallengeItem): ChallengeRecord {
  return {
    ...areaOf(item),
    id: item.id,
    totalPieces: item.totalPieces,
    missCount: item.missCount,
    elapsedSeconds: item.elapsedSeconds,
    baseScore: item.baseScore,
    timeBonus: item.timeBonus,
    missPenalty: item.missPenalty,
    score: item.score,
    isNewBest: item.isNewBest,
    comment: item.comment ?? null,
    playedAt: item.playedAt,
  };
}

function toProgress(item: ProgressItem): SavedProgressRecord {
  return {
    ...areaOf(item),
    id: item.areaKey,
    placedIds: (item.placedIds ?? []).filter((n): n is number => n !== null),
    missCount: item.missCount,
    elapsedSeconds: item.elapsedSeconds,
    savedAt: item.savedAt,
  };
}

function toBest(item: BestItem): BestRecord {
  return {
    ...areaOf(item),
    bestScore: item.bestScore,
    playCount: item.playCount,
    lastPlayedAt: item.lastPlayedAt,
  };
}

function toRanking(item: BestItem): RankingEntry {
  return { ...toBest(item), userId: item.userId, nickname: item.nickname ?? null };
}

async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

/** ある人のベスト記録を全部(ページを最後までたどる)。prefix で難易度を絞れる */
async function listAllBest(userId: string, areaKeyPrefix?: string): Promise<BestItem[]> {
  const items: BestItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameMapPuzzleBest.list({
      userId,
      ...(areaKeyPrefix && { areaKey: { beginsWith: areaKeyPrefix } }),
      nextToken,
    });
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

// ─── チャレンジ(挑戦結果)の送信・履歴 ──────────────────────────────────────────

// 得点(baseScore/timeBonus/missPenalty/score)と isNewBest は Lambda(submit-map-puzzle-challenge)が
// 計算し直すため、ここでは送らない(クライアントの自己申告を信用しない)
export async function submitChallenge(payload: ChallengeSubmission): Promise<ChallengeRecord> {
  await requireUserId();
  const res = await data.mutations.submitMapPuzzleChallenge({
    difficulty: payload.difficulty,
    prefCode: payload.prefCode,
    prefName: payload.prefName,
    cityCode: payload.cityCode ?? null,
    cityName: payload.cityName ?? null,
    totalPieces: payload.totalPieces,
    missCount: payload.missCount,
    elapsedSeconds: payload.elapsedSeconds,
    comment: payload.comment?.trim() || null,
  });
  const item = unwrap(res);
  if (!item) throw new Error("記録を保存できませんでした");
  return toChallenge(item as ChallengeItem);
}

export async function fetchChallengeHistory(
  cursor?: string | null,
  limit = 20
): Promise<ChallengeHistoryPage> {
  const userId = await requireUserId();
  const page = await data.models.GameMapPuzzleChallenge.listMapPuzzleChallengesByUser(
    { userId },
    { sortDirection: "DESC", limit, nextToken: cursor ?? undefined }
  );
  return { items: unwrap(page).map(toChallenge), nextCursor: page.nextToken ?? null };
}

// ─── 途中保存 ────────────────────────────────────────────────────────────────

export async function fetchSavedProgress(area: AreaInfo): Promise<SavedProgressRecord | null> {
  const userId = await requireUserId();
  const item = unwrap(await data.models.GameMapPuzzleProgress.get({ userId, areaKey: areaKeyOf(area) }));
  return item ? toProgress(item) : null;
}

export async function fetchAllSavedProgress(difficulty: Difficulty): Promise<SavedProgressRecord[]> {
  const userId = await requireUserId();
  const items: ProgressItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameMapPuzzleProgress.list({
      userId,
      areaKey: { beginsWith: `${difficulty}#` },
      nextToken,
    });
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items.map(toProgress);
}

export async function saveProgress(payload: ProgressPayload): Promise<void> {
  const userId = await requireUserId();
  const fields = {
    userId,
    areaKey: areaKeyOf(payload),
    difficulty: payload.difficulty,
    prefCode: payload.prefCode,
    prefName: payload.prefName,
    cityCode: payload.cityCode ?? null,
    cityName: payload.cityName ?? null,
    placedIds: payload.placedIds,
    missCount: payload.missCount,
    elapsedSeconds: payload.elapsedSeconds,
    savedAt: new Date().toISOString(),
  };
  const existing = unwrap(await data.models.GameMapPuzzleProgress.get({ userId, areaKey: fields.areaKey }));
  unwrap(
    existing
      ? await data.models.GameMapPuzzleProgress.update(fields)
      : await data.models.GameMapPuzzleProgress.create(fields)
  );
}

export async function discardProgress(area: AreaInfo): Promise<void> {
  const userId = await requireUserId();
  unwrap(await data.models.GameMapPuzzleProgress.delete({ userId, areaKey: areaKeyOf(area) }));
}

// エリア選択マップの色分け用。指定難易度でクリア済みの(prefCode, cityCode)一覧を返す
export async function fetchClearedAreas(difficulty: Difficulty): Promise<AreaKey[]> {
  const userId = await requireUserId();
  const items = await listAllBest(userId, `${difficulty}#`);
  return items.map((b) => ({ prefCode: b.prefCode, cityCode: b.cityCode ?? null }));
}

// ─── プロフィール ────────────────────────────────────────────────────────────

/** 他人のプロフィールは、ニックネームを設定している人だけ返す(未設定なら null) */
export async function fetchGameProfile(userId?: string): Promise<GameProfilePublic | null> {
  const me = await requireUserId();
  const targetId = userId ?? me;
  const item = unwrap(await data.models.GameProfile.get({ userId: targetId }));
  if (!item) return null;
  if (targetId !== me && !item.nickname) return null;
  return {
    userId: item.userId,
    nickname: item.nickname ?? null,
    totalScore: item.totalScore,
    areasPlayedCount: item.areasPlayedCount,
  };
}

export async function updateNickname(nickname: string): Promise<GameProfilePublic> {
  await requireUserId();
  const trimmed = nickname.trim();
  if ([...trimmed].length > 12) {
    throw new Error("ニックネームは12文字以内で入力してください");
  }
  const item = unwrap(await data.mutations.setNickname({ nickname: trimmed }));
  if (!item) throw new Error("ニックネームを保存できませんでした");
  return {
    userId: item.userId,
    nickname: item.nickname ?? null,
    totalScore: item.totalScore,
    areasPlayedCount: item.areasPlayedCount,
  };
}

export async function fetchBestList(userId?: string): Promise<BestRecord[]> {
  const targetId = userId ?? (await requireUserId());
  const items = await listAllBest(targetId);
  return items.sort((a, b) => b.bestScore - a.bestScore).map(toBest);
}

// ─── ランキング ──────────────────────────────────────────────────────────────
// ログインして遊んだ人は全員出す(ニックネームが無ければ「未設定」と表示)。cursor は Amplify Data の nextToken

export async function fetchModeRanking(
  difficulty: Difficulty,
  cursor?: string | null,
  limit = 20
): Promise<RankingPage> {
  await requireUserId(); // ランキング閲覧も要ログイン
  const page = await data.models.GameMapPuzzleBest.listMapPuzzleBestByDifficulty(
    { difficulty },
    { sortDirection: "DESC", limit, nextToken: cursor ?? undefined }
  );
  return { items: unwrap(page).map(toRanking), nextCursor: page.nextToken ?? null };
}

export async function fetchAreaRanking(
  area: { difficulty: Difficulty; prefCode: string; cityCode?: string },
  cursor?: string | null,
  limit = 20
): Promise<RankingPage> {
  await requireUserId(); // ランキング閲覧も要ログイン
  const page = await data.models.GameMapPuzzleBest.listMapPuzzleBestByRankingKey(
    { rankingKey: rankingKeyOf(area) },
    { sortDirection: "DESC", limit, nextToken: cursor ?? undefined }
  );
  return { items: unwrap(page).map(toRanking), nextCursor: page.nextToken ?? null };
}
