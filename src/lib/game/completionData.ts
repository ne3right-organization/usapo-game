"use client";

import { createClient } from "@/lib/supabase/client";
import type { Difficulty } from "@/lib/game/mapPuzzleData";
import { mapPackPlayHref, mapPuzzlePlayHref } from "@/lib/game/playLinks";
import { ZUKAN_DIFFICULTIES } from "@/lib/game/zukanQuizDifficulty";

// プロフィールのコンプリート表示用。ゲーム×レベルごとに、そのユーザーがクリアしたエリアを集める。
// 公開範囲は各テーブルのRLSのまま(本人か、ニックネームを設定した人の記録だけが読める)。
//   地図パズル: game_map_puzzle_best の全行(完成した挑戦しか記録しない)
//   地図ポットン: game_map_pack_best のうち first_cleared_at がある行(あきらめた挑戦も記録するため)
//   図鑑クイズ: game_zukan_collections。上の難易度で登録した市区町村は下の難易度でもクリア扱いにする

export type CompletionGame = "map-puzzle" | "map-pack" | "zukan-quiz";

export const COMPLETION_GAMES: CompletionGame[] = ["map-puzzle", "map-pack", "zukan-quiz"];

export const COMPLETION_LEVELS: Difficulty[] = ["beginner", "intermediate", "advanced"];

/**
 * 地図の見せ方。nation: 全国1エリア(初級) / prefecture: 都道府県が1エリア(中級) /
 * municipality: 市区町村が1エリア(上級・図鑑クイズ)。市区町村は全国ぶんを一度に読むと重いので、
 * 全国の地図では都道府県ごとのクリア数を出し、都道府県を選ぶとその県の市区町村の地図に切り替える
 */
export type CompletionScope = "nation" | "prefecture" | "municipality";

export function completionScopeOf(game: CompletionGame, level: Difficulty): CompletionScope {
  if (game === "zukan-quiz") return "municipality";
  if (level === "beginner") return "nation";
  return level === "intermediate" ? "prefecture" : "municipality";
}

export interface ClearedArea {
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
  /** 図鑑クイズには点数が無い */
  bestScore?: number;
}

export type CompletionData = Record<Difficulty, ClearedArea[]>;

export function completionLevelLabel(game: CompletionGame, level: Difficulty): string {
  const labels: Record<CompletionGame, Record<Difficulty, string>> = {
    "map-puzzle": { beginner: "初級（都道府県）", intermediate: "中級（市区町村）", advanced: "上級（町丁）" },
    "map-pack": { beginner: "都道府県ポットン", intermediate: "自治体ポットン", advanced: "ご近所ポットン" },
    "zukan-quiz": { beginner: "かんたん", intermediate: "ふつう", advanced: "むずかしい" },
  };
  return labels[game][level];
}

/** そのエリア(省略時はレベル全体)を遊ぶ画面。図鑑クイズは出題がランダムなのでレベルの画面に飛ぶ */
export function completionPlayHref(
  game: CompletionGame,
  level: Difficulty,
  area?: { prefCode: string; prefName: string; cityCode?: string; cityName?: string },
): string {
  if (game === "zukan-quiz") return `/game/zukan-quiz/play/${level}`;
  const href = game === "map-puzzle" ? mapPuzzlePlayHref : mapPackPlayHref;
  if (level === "beginner") return href({ difficulty: "beginner", prefCode: "00", prefName: "全国" });
  // エリアを渡さなければ、プレイ画面のエリア選択から始まる
  return area ? href({ difficulty: level, ...area }) : `/game/${game}/${level}`;
}

const PAGE_SIZE = 1000; // PostgREST が1回に返す行数の上限

interface AreaRow {
  difficulty: Difficulty;
  pref_code: string;
  pref_name: string;
  city_code: string | null;
  city_name: string | null;
  best_score: number;
}

async function fetchBestRows(table: "game_map_puzzle_best" | "game_map_pack_best", userId: string): Promise<AreaRow[]> {
  const supabase = createClient();
  const rows: AreaRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select("difficulty, pref_code, pref_name, city_code, city_name, best_score")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (table === "game_map_pack_best") query = query.not("first_cleared_at", "is", null);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as AreaRow[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function groupByLevel(rows: AreaRow[]): CompletionData {
  const out: CompletionData = { beginner: [], intermediate: [], advanced: [] };
  for (const r of rows) {
    out[r.difficulty].push({
      prefCode: r.pref_code,
      prefName: r.pref_name,
      cityCode: r.city_code ?? undefined,
      cityName: r.city_name ?? undefined,
      bestScore: r.best_score,
    });
  }
  return out;
}

async function fetchZukanCompletion(userId: string): Promise<CompletionData> {
  const supabase = createClient();
  const out: CompletionData = { beginner: [], intermediate: [], advanced: [] };
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("game_zukan_collections")
      .select("pref_code, pref_name, city_code, city_name, best_difficulty")
      .eq("user_id", userId)
      .order("pref_code", { ascending: true })
      .order("city_code", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const area: ClearedArea = { prefCode: r.pref_code, prefName: r.pref_name, cityCode: r.city_code, cityName: r.city_name };
      // 上の難易度で登録したカードは、それより下の難易度でもクリア扱い
      const rank = ZUKAN_DIFFICULTIES.indexOf(r.best_difficulty);
      ZUKAN_DIFFICULTIES.forEach((d, i) => {
        if (i <= rank) out[d].push(area);
      });
    }
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

export async function fetchCompletion(game: CompletionGame, userId: string): Promise<CompletionData> {
  if (game === "zukan-quiz") return fetchZukanCompletion(userId);
  const rows = await fetchBestRows(game === "map-puzzle" ? "game_map_puzzle_best" : "game_map_pack_best", userId);
  return groupByLevel(rows);
}
