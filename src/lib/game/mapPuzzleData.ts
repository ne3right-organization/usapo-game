"use client";

import { createClient } from "@/lib/supabase/client";
import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";

// このファイルは元実装(team-kokuusa-platform-frontend)の
// src/lib/game/{mapPuzzleClient,gameProfileClient,rankingClient}.ts に相当する。
// 元実装はNext.js API RouteがAppSyncへのプロキシだったが、
// Supabaseでは RLS (supabase/migrations 参照) がアクセス制御を担うため、
// クライアントから直接 supabase-js で読み書きする構成にしている。

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
}

export interface RankingPage {
  items: RankingEntry[];
  nextCursor: string | null;
}

// ─── 変換ヘルパー ────────────────────────────────────────────────────────────

interface ChallengeRow {
  id: string;
  difficulty: Difficulty;
  pref_code: string;
  pref_name: string;
  city_code: string | null;
  city_name: string | null;
  total_pieces: number;
  miss_count: number;
  elapsed_seconds: number;
  base_score: number;
  time_bonus: number;
  miss_penalty: number;
  score: number;
  is_new_best: boolean;
  comment: string | null;
  played_at: string;
}

function rowToChallenge(row: ChallengeRow): ChallengeRecord {
  return {
    id: row.id,
    difficulty: row.difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    totalPieces: row.total_pieces,
    missCount: row.miss_count,
    elapsedSeconds: row.elapsed_seconds,
    baseScore: row.base_score,
    timeBonus: row.time_bonus,
    missPenalty: row.miss_penalty,
    score: row.score,
    isNewBest: row.is_new_best,
    comment: row.comment,
    playedAt: row.played_at,
  };
}

interface ProgressRow {
  id: string;
  difficulty: Difficulty;
  pref_code: string;
  pref_name: string;
  city_code: string | null;
  city_name: string | null;
  placed_ids: number[];
  miss_count: number;
  elapsed_seconds: number;
  saved_at: string;
}

function rowToProgress(row: ProgressRow): SavedProgressRecord {
  return {
    id: row.id,
    difficulty: row.difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    placedIds: row.placed_ids,
    missCount: row.miss_count,
    elapsedSeconds: row.elapsed_seconds,
    savedAt: row.saved_at,
  };
}

interface BestRow {
  difficulty: Difficulty;
  pref_code: string;
  pref_name: string;
  city_code: string | null;
  city_name: string | null;
  best_score: number;
  play_count: number;
  last_played_at: string;
}

function rowToBest(row: BestRow): BestRecord {
  return {
    difficulty: row.difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    bestScore: row.best_score,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
  };
}

interface RankingRow extends BestRow {
  user_id: string;
  nickname: string | null;
}

function rowToRanking(row: RankingRow): RankingEntry {
  return {
    ...rowToBest(row),
    userId: row.user_id,
    nickname: row.nickname,
  };
}

async function requireUserId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

// ─── チャレンジ(挑戦結果)の送信・履歴 ──────────────────────────────────────────

// スコア(baseScore/timeBonus/missPenalty/score)とisNewBestはDB側のトリガーが
// サーバー側で再計算するため、ここでは送らない(クライアントの自己申告を信用しない)
export async function submitChallenge(payload: ChallengeSubmission): Promise<ChallengeRecord> {
  const supabase = createClient();
  const userId = await requireUserId();

  const { data: profile } = await supabase
    .from("game_profiles")
    .select("nickname")
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("game_map_puzzle_challenges")
    .insert({
      user_id: userId,
      nickname: profile?.nickname ?? null,
      difficulty: payload.difficulty,
      pref_code: payload.prefCode,
      pref_name: payload.prefName,
      city_code: payload.cityCode ?? null,
      city_name: payload.cityName ?? null,
      total_pieces: payload.totalPieces,
      miss_count: payload.missCount,
      elapsed_seconds: payload.elapsedSeconds,
      comment: payload.comment?.trim().slice(0, 200) || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rowToChallenge(data);
}

export async function fetchChallengeHistory(
  cursor?: string | null,
  limit = 20
): Promise<ChallengeHistoryPage> {
  const supabase = createClient();
  const userId = await requireUserId();

  let query = supabase
    .from("game_map_puzzle_challenges")
    .select("*")
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt("played_at", cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const items = (data ?? []).map(rowToChallenge);
  const nextCursor = items.length === limit ? items[items.length - 1].playedAt : null;
  return { items, nextCursor };
}

// ─── 途中保存 ────────────────────────────────────────────────────────────────

export async function fetchSavedProgress(area: AreaInfo): Promise<SavedProgressRecord | null> {
  const supabase = createClient();
  const userId = await requireUserId();

  let query = supabase
    .from("game_map_puzzle_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("difficulty", area.difficulty)
    .eq("pref_code", area.prefCode);

  query = area.cityCode ? query.eq("city_code", area.cityCode) : query.is("city_code", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToProgress(data) : null;
}

export async function fetchAllSavedProgress(difficulty: Difficulty): Promise<SavedProgressRecord[]> {
  const supabase = createClient();
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("game_map_puzzle_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("difficulty", difficulty);

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToProgress);
}

export async function saveProgress(payload: ProgressPayload): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId();

  const { error } = await supabase.from("game_map_puzzle_progress").upsert(
    {
      user_id: userId,
      difficulty: payload.difficulty,
      pref_code: payload.prefCode,
      pref_name: payload.prefName,
      city_code: payload.cityCode ?? null,
      city_name: payload.cityName ?? null,
      placed_ids: payload.placedIds,
      miss_count: payload.missCount,
      elapsed_seconds: payload.elapsedSeconds,
      saved_at: new Date().toISOString(),
    },
    { onConflict: "user_id,difficulty,pref_code,city_code_key" }
  );

  if (error) throw new Error(error.message);
}

export async function discardProgress(area: AreaInfo): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId();

  let query = supabase
    .from("game_map_puzzle_progress")
    .delete()
    .eq("user_id", userId)
    .eq("difficulty", area.difficulty)
    .eq("pref_code", area.prefCode);

  query = area.cityCode ? query.eq("city_code", area.cityCode) : query.is("city_code", null);

  const { error } = await query;
  if (error) throw new Error(error.message);
}

// エリア選択マップの色分け用。指定難易度でクリア済みの(prefCode, cityCode)一覧を返す
// (元実装はチャレンジ履歴を全件スキャンして重複排除していたが、Postgresでは
// game_map_puzzle_best を直接引けば同じ結果がO(1クエリ)で得られる)
export async function fetchClearedAreas(difficulty: Difficulty): Promise<AreaKey[]> {
  const supabase = createClient();
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("game_map_puzzle_best")
    .select("pref_code, city_code")
    .eq("user_id", userId)
    .eq("difficulty", difficulty);

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ prefCode: r.pref_code, cityCode: r.city_code }));
}

// ─── プロフィール ────────────────────────────────────────────────────────────

export async function fetchGameProfile(userId?: string): Promise<GameProfilePublic | null> {
  const supabase = createClient();
  const targetId = userId ?? (await requireUserId());

  const { data, error } = await supabase
    .from("game_profiles")
    .select("*")
    .eq("user_id", targetId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    userId: data.user_id,
    nickname: data.nickname,
    totalScore: data.total_score,
    areasPlayedCount: data.areas_played_count,
  };
}

export async function updateNickname(nickname: string): Promise<GameProfilePublic> {
  const supabase = createClient();
  const userId = await requireUserId();
  const trimmed = nickname.trim();

  if (trimmed.length > 12) {
    throw new Error("ニックネームは12文字以内で入力してください");
  }

  const { data, error } = await supabase
    .from("game_profiles")
    .upsert(
      { user_id: userId, nickname: trimmed === "" ? null : trimmed },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);
  return {
    userId: data.user_id,
    nickname: data.nickname,
    totalScore: data.total_score,
    areasPlayedCount: data.areas_played_count,
  };
}

export async function fetchBestList(userId?: string): Promise<BestRecord[]> {
  const supabase = createClient();
  const targetId = userId ?? (await requireUserId());

  const { data, error } = await supabase
    .from("game_map_puzzle_best")
    .select("*")
    .eq("user_id", targetId)
    .order("best_score", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToBest);
}

// ─── ランキング ──────────────────────────────────────────────────────────────

export async function fetchModeRanking(
  difficulty: Difficulty,
  cursor?: string | null,
  limit = 20
): Promise<RankingPage> {
  const supabase = createClient();

  let query = supabase
    .from("game_map_puzzle_best")
    .select("*")
    .eq("difficulty", difficulty)
    .order("best_score", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);

  if (cursor) query = query.lt("best_score", Number(cursor));

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const items = (data ?? []).map(rowToRanking);
  const nextCursor = items.length === limit ? String(items[items.length - 1].bestScore) : null;
  return { items, nextCursor };
}

export async function fetchAreaRanking(
  area: { difficulty: Difficulty; prefCode: string; cityCode?: string },
  cursor?: string | null,
  limit = 20
): Promise<RankingPage> {
  const supabase = createClient();

  let query = supabase
    .from("game_map_puzzle_best")
    .select("*")
    .order("best_score", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);

  query = area.cityCode
    ? query.eq("city_code", area.cityCode)
    : query.eq("pref_code", area.prefCode).eq("difficulty", area.difficulty);

  if (cursor) query = query.lt("best_score", Number(cursor));

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const items = (data ?? []).map(rowToRanking);
  const nextCursor = items.length === limit ? String(items[items.length - 1].bestScore) : null;
  return { items, nextCursor };
}
