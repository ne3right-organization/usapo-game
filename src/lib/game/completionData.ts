"use client";

import { data, unwrap } from "@/lib/amplify/data";
import type { Difficulty } from "@/lib/game/mapPuzzleData";
import { mapPackPlayHref, mapPuzzlePlayHref } from "@/lib/game/playLinks";
import { ZUKAN_DIFFICULTIES } from "@/lib/game/zukanQuizDifficulty";

// プロフィールのコンプリート表示用。ゲーム×レベルごとに、そのユーザーがクリアしたエリアを集める。
// データは Amplify Data(ログインしていれば誰の記録でも読める。他人のプロフィールを開けるのは
// ニックネームを設定した人だけ、という制限はプロフィールの画面側で行っている)。
//   地図パズル: GameMapPuzzleBest の全件(完成した挑戦しか記録しない)
//   地図ポットン: GameMapPackBest のうち firstClearedAt があるもの(あきらめた挑戦も記録するため)
//   図鑑クイズ: GameZukanCollection。上の難易度で登録した市区町村は下の難易度でもクリア扱いにする

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

interface AreaRow {
  difficulty: Difficulty;
  prefCode: string;
  prefName: string;
  cityCode?: string | null;
  cityName?: string | null;
  bestScore: number;
}

/** ある人のベスト記録を全部(ページを最後までたどる)。地図ポットンは完成させたものだけ */
async function fetchBestRows(game: "map-puzzle" | "map-pack", userId: string): Promise<AreaRow[]> {
  const rows: AreaRow[] = [];
  let nextToken: string | null | undefined;
  do {
    if (game === "map-puzzle") {
      const page = await data.models.GameMapPuzzleBest.list({ userId, nextToken });
      rows.push(...unwrap(page).map((b) => ({ ...b, difficulty: b.difficulty as Difficulty })));
      nextToken = page.nextToken;
    } else {
      const page = await data.models.GameMapPackBest.list({ userId, nextToken });
      rows.push(
        ...unwrap(page)
          .filter((b) => b.firstClearedAt != null)
          .map((b) => ({ ...b, difficulty: b.difficulty as Difficulty }))
      );
      nextToken = page.nextToken;
    }
  } while (nextToken);
  return rows;
}

function groupByLevel(rows: AreaRow[]): CompletionData {
  const out: CompletionData = { beginner: [], intermediate: [], advanced: [] };
  for (const r of rows) {
    out[r.difficulty].push({
      prefCode: r.prefCode,
      prefName: r.prefName,
      cityCode: r.cityCode ?? undefined,
      cityName: r.cityName ?? undefined,
      bestScore: r.bestScore,
    });
  }
  return out;
}

async function fetchZukanCompletion(userId: string): Promise<CompletionData> {
  const out: CompletionData = { beginner: [], intermediate: [], advanced: [] };
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameZukanCollection.list({ userId, nextToken });
    for (const r of unwrap(page)) {
      const area: ClearedArea = { prefCode: r.prefCode, prefName: r.prefName, cityCode: r.cityCode, cityName: r.cityName };
      // 上の難易度で登録したカードは、それより下の難易度でもクリア扱い
      const rank = ZUKAN_DIFFICULTIES.indexOf(r.bestDifficulty as (typeof ZUKAN_DIFFICULTIES)[number]);
      ZUKAN_DIFFICULTIES.forEach((d, k) => {
        if (k <= rank) out[d].push(area);
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

export async function fetchCompletion(game: CompletionGame, userId: string): Promise<CompletionData> {
  if (game === "zukan-quiz") return fetchZukanCompletion(userId);
  const rows = await fetchBestRows(game, userId);
  return groupByLevel(rows);
}
