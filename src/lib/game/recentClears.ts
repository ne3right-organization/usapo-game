"use client";

import type { PlayArea } from "@/lib/game/playLinks";
import { data, guestOrUserAuthMode, unwrap } from "@/lib/amplify/data";

// 各ゲームのトップに出す「最近クリアされたエリア」。誰がクリアしたかは出さない
// (GameRecentClear。記録を送る Lambda が更新する。未ログインでも読める)

export interface RecentClear extends PlayArea {
  lastClearedAt: string;
}

export async function fetchRecentClears(game: "map-puzzle" | "map-pack", limit = 8): Promise<RecentClear[]> {
  const page = await data.models.GameRecentClear.listRecentClearsByGame(
    { game },
    { sortDirection: "DESC", limit, authMode: await guestOrUserAuthMode() }
  );
  return unwrap(page).map((item) => ({
    difficulty: item.difficulty as PlayArea["difficulty"],
    prefCode: item.prefCode,
    prefName: item.prefName,
    cityCode: item.cityCode ?? undefined,
    cityName: item.cityName ?? undefined,
    lastClearedAt: item.lastClearedAt,
  }));
}
