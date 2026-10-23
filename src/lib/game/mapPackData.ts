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
  splitCount: number;
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
      split_count: payload.splitCount,
      cleared: payload.cleared,
      elapsed_seconds: payload.elapsedSeconds,
    })
    .select("score, is_new_best")
    .single();

  if (error) throw new Error(error.message);
  return { score: data.score, isNewBest: data.is_new_best };
}

// ─── 遊んだ履歴 ──────────────────────────────────────────────────────────────

export interface MapPackHistoryRecord extends MapPackArea {
  id: string;
  score: number;
  cleared: boolean;
  totalPieces: number;
  restackCount: number;
  elapsedSeconds: number;
  isNewBest: boolean;
  playedAt: string;
}

export async function fetchMapPackHistory(
  cursor?: string | null,
  limit = 20,
): Promise<{ items: MapPackHistoryRecord[]; nextCursor: string | null }> {
  const supabase = createClient();
  const userId = await requireUserId();
  let query = supabase
    .from("game_map_pack_challenges")
    .select(
      "id, difficulty, pref_code, pref_name, city_code, city_name, score, cleared, total_pieces, restack_count, elapsed_seconds, is_new_best, played_at",
    )
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(limit);
  if (cursor) query = query.lt("played_at", cursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const items: MapPackHistoryRecord[] = (data ?? []).map((row) => ({
    id: row.id,
    difficulty: row.difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    score: row.score,
    cleared: row.cleared,
    totalPieces: row.total_pieces,
    restackCount: row.restack_count,
    elapsedSeconds: row.elapsed_seconds,
    isNewBest: row.is_new_best,
    playedAt: row.played_at,
  }));
  return { items, nextCursor: items.length === limit ? items[items.length - 1].playedAt : null };
}

/**
 * 難易度別ランキング(1人1行)。その難易度のエリアごとの自己ベストの合計点で並べ、一番点の高いエリアを
 * 代表として返す(bestScore は合計点、エリアは一番点の高いエリア)。cursor は読み飛ばす件数
 */
export async function fetchMapPackModeRanking(
  difficulty: Difficulty,
  cursor?: string | null,
  limit = 20,
): Promise<RankingPage> {
  const supabase = createClient();
  await requireUserId(); // 閲覧は要ログイン(anon には実行を許可していない)
  const offset = cursor ? Number(cursor) : 0;
  const { data, error } = await supabase.rpc("fetch_map_pack_user_ranking", {
    p_difficulty: difficulty,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const items: RankingEntry[] = ((data ?? []) as {
    user_id: string;
    nickname: string | null;
    total_score: number;
    areas_count: number;
    top_pref_code: string;
    top_pref_name: string;
    top_city_code: string | null;
    top_city_name: string | null;
    top_score: number;
    last_played_at: string;
  }[]).map((row) => {
    const top = {
      difficulty,
      prefCode: row.top_pref_code,
      prefName: row.top_pref_name,
      cityCode: row.top_city_code ?? undefined,
      cityName: row.top_city_name ?? undefined,
    };
    const topLabel = difficulty === "beginner" ? "全国" : top.cityName ? `${top.prefName} ${top.cityName}` : top.prefName;
    return {
      ...top,
      userId: row.user_id,
      nickname: row.nickname,
      bestScore: row.total_score,
      lastPlayedAt: row.last_played_at,
      detail: `🏅 最高 ${row.top_score.toLocaleString()}点（${topLabel}）`,
      scoreCaption: `${row.areas_count}エリア合計`,
    };
  });
  return { items, nextCursor: items.length === limit ? String(offset + limit) : null };
}

/** ランキングのカードを開いたときに出す、その人のその難易度のエリア一覧(点数の高い順) */
export interface MapPackUserArea extends MapPackArea {
  bestScore: number;
  cleared: boolean;
  playCount: number;
}

export async function fetchMapPackUserAreas(userId: string, difficulty: Difficulty): Promise<MapPackUserArea[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("game_map_pack_best")
    .select("pref_code, pref_name, city_code, city_name, best_score, first_cleared_at, play_count")
    .eq("user_id", userId)
    .eq("difficulty", difficulty)
    .order("best_score", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    bestScore: row.best_score,
    cleared: row.first_cleared_at != null,
    playCount: row.play_count,
  }));
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

// ─── 途中保存(中断) ──────────────────────────────────────────────────────────
// 地図パズルと同じ2段構え: プレイ中は同じタブの sessionStorage に自動保存し、
// 「中断」ボタンではサーバー(game_map_pack_progress)に保存して別の端末からも再開できるようにする

/** ゲームの途中の状態。MapPackGame が作り、再開時にそのまま戻す */
export interface MapPackSnapshot {
  version: 1;
  /** 箱の中のピース(合体したかたまり)。位置が無いものは積み直し待ちだったピースで、再開時に落とし直す */
  pieces: { ids: number[]; x?: number; y?: number; angle: number; tag?: number }[];
  /** これから出す地域(今構えていたピースが先頭)と、その名前のまとまりの大きさ */
  queue: number[];
  queueGroupSize: number;
  /** まだ1つも出していない名前のまとまり(groups の添字) */
  remainingGroups: number[];
  dropped: number;
  mergePoints: number;
  restacks: number;
  /** 割って積み直した回数(この機能を入れる前の保存には無い) */
  splits?: number;
  /** 一度くっついたことのある地域同士の union-find(地域idごとの親)。くっつけ直しを0点にするため */
  joined?: number[];
  elapsedSec: number;
}

/** sessionStorage に入れる形(エリアの情報も一緒に持ち、ページを開き直したときの再開確認に使う) */
export interface MapPackSessionSave {
  snapshot: MapPackSnapshot;
  geojsonUrl: string;
  areaLabel: string;
  area: MapPackArea;
  updatedAt: number;
}

export function mapPackSessionKey(difficulty: Difficulty, geojsonUrl: string): string {
  return `mapPackProgress:${difficulty}:${geojsonUrl}`;
}

/** 同じタブで中断中のゲームのうち、一番新しいもの */
export function findMapPackSessionSave(difficulty: Difficulty): MapPackSessionSave | null {
  const prefix = mapPackSessionKey(difficulty, "");
  let best: MapPackSessionSave | null = null;
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "") as MapPackSessionSave;
        if (saved?.snapshot?.version !== 1 || !saved.area) continue;
        if (!best || saved.updatedAt > best.updatedAt) best = saved;
      } catch {
        // 壊れた保存データは無視
      }
    }
  } catch {
    // sessionStorage が使えない環境
  }
  return best;
}

export function clearMapPackSessionSaves(difficulty: Difficulty, geojsonUrl?: string): void {
  try {
    if (geojsonUrl !== undefined) {
      window.sessionStorage.removeItem(mapPackSessionKey(difficulty, geojsonUrl));
      return;
    }
    const prefix = mapPackSessionKey(difficulty, "");
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage が使えない環境
  }
}

export async function saveMapPackProgress(area: MapPackArea, snapshot: MapPackSnapshot): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId();
  const { error } = await supabase.from("game_map_pack_progress").upsert(
    {
      user_id: userId,
      difficulty: area.difficulty,
      pref_code: area.prefCode,
      pref_name: area.prefName,
      city_code: area.cityCode ?? null,
      city_name: area.cityName ?? null,
      state: snapshot,
      elapsed_seconds: snapshot.elapsedSec,
      saved_at: new Date().toISOString(),
    },
    { onConflict: "user_id,difficulty,pref_code,city_code_key" },
  );
  if (error) throw new Error(error.message);
}

/** 未ログインなら null(ゲスト扱い) */
export async function fetchMapPackProgress(area: MapPackArea): Promise<MapPackSnapshot | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const supabase = createClient();
  let query = supabase
    .from("game_map_pack_progress")
    .select("state")
    .eq("user_id", userId)
    .eq("difficulty", area.difficulty)
    .eq("pref_code", area.prefCode);
  query = area.cityCode ? query.eq("city_code", area.cityCode) : query.is("city_code", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  const state = data?.state as MapPackSnapshot | undefined;
  return state?.version === 1 ? state : null;
}

/** 中断中のゲームの一覧の1行(どこを中断したか思い出せるように、トップに並べる) */
export interface MapPackSavedGame {
  area: MapPackArea;
  savedAt: number;
  dropped: number;
  /** server: 「中断」でサーバーに保存したもの / session: このタブに自動保存されているもの */
  source: "server" | "session";
}

/** 中断中のゲームの一覧(新しい順)。サーバー(ログイン時)とこのタブの両方を見て、同じエリアは新しい方だけ残す */
export async function fetchMapPackSavedGames(): Promise<MapPackSavedGame[]> {
  const list: MapPackSavedGame[] = [];
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key?.startsWith("mapPackProgress:")) continue;
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "") as MapPackSessionSave;
        if (saved?.snapshot?.version !== 1 || !saved.area) continue;
        list.push({ area: saved.area, savedAt: saved.updatedAt, dropped: saved.snapshot.dropped, source: "session" });
      } catch {
        // 壊れた保存データは無視
      }
    }
  } catch {
    // sessionStorage が使えない環境
  }

  const userId = await currentUserId();
  if (userId) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("game_map_pack_progress")
      .select("difficulty, pref_code, pref_name, city_code, city_name, saved_at, state")
      .eq("user_id", userId)
      .order("saved_at", { ascending: false });
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      list.push({
        area: {
          difficulty: row.difficulty,
          prefCode: row.pref_code,
          prefName: row.pref_name,
          cityCode: row.city_code ?? undefined,
          cityName: row.city_name ?? undefined,
        },
        savedAt: new Date(row.saved_at).getTime(),
        dropped: (row.state as MapPackSnapshot | null)?.dropped ?? 0,
        source: "server",
      });
    }
  }

  const byArea = new Map<string, MapPackSavedGame>();
  for (const g of list) {
    const key = `${g.area.difficulty}:${g.area.prefCode}:${g.area.cityCode ?? ""}`;
    const cur = byArea.get(key);
    if (!cur || g.savedAt > cur.savedAt) byArea.set(key, g);
  }
  return [...byArea.values()].sort((a, b) => b.savedAt - a.savedAt);
}

export async function discardMapPackProgress(area: MapPackArea): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = createClient();
  let query = supabase
    .from("game_map_pack_progress")
    .delete()
    .eq("user_id", userId)
    .eq("difficulty", area.difficulty)
    .eq("pref_code", area.prefCode);
  query = area.cityCode ? query.eq("city_code", area.cityCode) : query.is("city_code", null);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export { mapPackPlayHref } from "@/lib/game/playLinks";

export function mapPackAreaRankingHref(area: MapPackArea): string {
  const q = new URLSearchParams({ difficulty: area.difficulty, prefCode: area.prefCode, prefName: area.prefName });
  if (area.cityCode && area.cityName) {
    q.set("cityCode", area.cityCode);
    q.set("cityName", area.cityName);
  }
  return `/game/map-pack/ranking/area?${q.toString()}`;
}
