"use client";

import { createClient } from "@/lib/supabase/client";
import type { PlayArea } from "@/lib/game/playLinks";

// 各ゲームのトップに出す「最近クリアされたエリア」。誰がクリアしたかは出さない
// (ユーザーを特定しない集計RPC。supabase/migrations/20261020000001_recent_clears.sql)

export interface RecentClear extends PlayArea {
  lastClearedAt: string;
}

const RPC = {
  "map-puzzle": "fetch_recent_map_puzzle_clears",
  "map-pack": "fetch_recent_map_pack_clears",
} as const;

export async function fetchRecentClears(game: keyof typeof RPC, limit = 8): Promise<RecentClear[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC[game], { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    difficulty: PlayArea["difficulty"];
    pref_code: string;
    pref_name: string;
    city_code: string | null;
    city_name: string | null;
    last_cleared_at: string;
  }[]).map((row) => ({
    difficulty: row.difficulty,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code ?? undefined,
    cityName: row.city_name ?? undefined,
    lastClearedAt: row.last_cleared_at,
  }));
}
