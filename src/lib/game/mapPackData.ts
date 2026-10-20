"use client";

import { createClient } from "@/lib/supabase/client";
import type { Difficulty, RankingEntry, RankingPage } from "@/lib/game/mapPuzzleData";

// 地図ポットンの挑戦結果の送信とランキング取得。地図パズル(mapPuzzleData.ts)と同じく、
// RLS (supabase/migrations/20261019000000_map_pack_schema.sql) がアクセス制御を担うため
// クライアントから直接 supabase-js で読み書きする。
// ランキングは地図パズルとは別集計(game_map_pack_best)。game_profiles.total_score(地図パズルの合計)には含めない

export interface MapPackArea {
  difficulty: Difficulty;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

// 都道府県(初級)は全国固定のため、地図パズルと同じ専用のエリアコードで表現する
export const MAP_PACK_BEGINNER_AREA = { prefCode: "00", prefName: "全国" } as const;

export interface MapPackSubmission extends MapPackArea {
  totalPieces: number;
  /** 合体で得た点の合計(減点前) */
  mergePoints: number;
  restackCount: number;
  cleared: boolean;
  elapsedSeconds: number;
}

export interface MapPackSubmitResult {
  score: number;
  isNewBest: boolean;
}

interface BestRow {
  user_id: string;
  nickname: string | null;
  difficulty: Difficulty;
  pref_code: string;
  pref_name: string;
  city_code: string | null;
  city_name: string | null;
  best_score: number;
  last_played_at: string;
}

function rowToRanking(row: BestRow): RankingEntry {
  return {
    difficulty: row.difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    userId: row.user_id,
    nickname: row.nickname,
    bestScore: row.best_score,
    lastPlayedAt: row.last_played_at,
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

/** 未ログインなら null を返す(ゲストプレイ) */
export async function currentUserId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// score / clear_bonus / is_new_best は DB 側のトリガーが送られた値から計算し直すため、ここでは送らない
export async function submitMapPackChallenge(payload: MapPackSubmission): Promise<MapPackSubmitResult> {
  const supabase = createClient();
  const userId = await requireUserId();

  const { data: profile } = await supabase
    .from("game_profiles")
    .select("nickname")
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("game_map_pack_challenges")
    .insert({
      user_id: userId,
      nickname: profile?.nickname ?? null,
      difficulty: payload.difficulty,
      pref_code: payload.prefCode,
      pref_name: payload.prefName,
      city_code: payload.cityCode ?? null,
      city_name: payload.cityName ?? null,
      total_pieces: payload.totalPieces,
      merge_points: payload.mergePoints,
      restack_count: payload.restackCount,
      cleared: payload.cleared,
      elapsed_seconds: payload.elapsedSeconds,
    })
    .select("score, is_new_best")
    .single();

  if (error) throw new Error(error.message);
  return { score: data.score, isNewBest: data.is_new_best };
}

export async function fetchMapPackModeRanking(
  difficulty: Difficulty,
  cursor?: string | null,
  limit = 20,
): Promise<RankingPage> {
  const supabase = createClient();
  await requireUserId(); // 地図パズルと同じく閲覧も要ログイン(anonには権限を付けていないため、呼ばないと生のpermission deniedが出る)

  let query = supabase
    .from("game_map_pack_best")
    .select("*")
    .eq("difficulty", difficulty)
    .order("best_score", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (cursor) query = query.lt("best_score", Number(cursor));

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map(rowToRanking);
  return { items, nextCursor: items.length === limit ? String(items[items.length - 1].bestScore) : null };
}

export async function fetchMapPackAreaRanking(
  area: { difficulty: Difficulty; prefCode: string; cityCode?: string },
  cursor?: string | null,
  limit = 20,
): Promise<RankingPage> {
  const supabase = createClient();
  await requireUserId();

  // city_code は都道府県内の3桁コードなので、都道府県コードと組み合わせないと別の県の同じコードと混ざる
  let query = supabase
    .from("game_map_pack_best")
    .select("*")
    .eq("difficulty", area.difficulty)
    .eq("pref_code", area.prefCode)
    .order("best_score", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  query = area.cityCode ? query.eq("city_code", area.cityCode) : query.is("city_code", null);
  if (cursor) query = query.lt("best_score", Number(cursor));

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map(rowToRanking);
  return { items, nextCursor: items.length === limit ? String(items[items.length - 1].bestScore) : null };
}

/** そのエリアのプレイ画面(エリア選択を飛ばして直接始める)。初級は全国固定なのでエリア指定なし */
export function mapPackPlayHref(area: MapPackArea): string {
  if (area.difficulty === "beginner") return "/game/map-pack/beginner";
  const q = new URLSearchParams({ prefCode: area.prefCode, prefName: area.prefName });
  if (area.cityCode && area.cityName) {
    q.set("cityCode", area.cityCode);
    q.set("cityName", area.cityName);
  }
  return `/game/map-pack/${area.difficulty}?${q.toString()}`;
}

export function mapPackAreaRankingHref(area: MapPackArea): string {
  const q = new URLSearchParams({ difficulty: area.difficulty, prefCode: area.prefCode, prefName: area.prefName });
  if (area.cityCode && area.cityName) {
    q.set("cityCode", area.cityCode);
    q.set("cityName", area.cityName);
  }
  return `/game/map-pack/ranking/area?${q.toString()}`;
}
