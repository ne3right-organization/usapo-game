import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";

// ゲーム間・ランキング・最近のクリア一覧から、特定のエリアのプレイ画面へ直接飛ぶためのURL。
// プレイ画面は URL でエリアを受け取ると、地図でのエリア選択を飛ばして始める

export interface PlayArea {
  difficulty: Difficulty;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

function playHref(base: string, area: PlayArea): string {
  if (area.difficulty === "beginner") return `${base}/beginner`; // 初級は全国固定
  const q = new URLSearchParams({ prefCode: area.prefCode, prefName: area.prefName });
  if (area.cityCode && area.cityName) {
    q.set("cityCode", area.cityCode);
    q.set("cityName", area.cityName);
  }
  return `${base}/${area.difficulty}?${q.toString()}`;
}

export const mapPuzzlePlayHref = (area: PlayArea) => playHref("/game/map-puzzle", area);
export const mapPackPlayHref = (area: PlayArea) => playHref("/game/map-pack", area);

/** URL のクエリからエリアを読む。中級は都道府県、上級は市区町村まで揃っていなければ null */
export function areaFromQuery(difficulty: Difficulty, q: URLSearchParams): PlayArea | null {
  const prefCode = q.get("prefCode"), prefName = q.get("prefName");
  if (!prefCode || !/^\d{2}$/.test(prefCode) || !prefName) return null;
  if (difficulty === "intermediate") return { difficulty, prefCode, prefName };
  if (difficulty !== "advanced") return null;
  const cityCode = q.get("cityCode"), cityName = q.get("cityName");
  if (!cityCode || !/^\d{3}$/.test(cityCode) || !cityName) return null;
  return { difficulty, prefCode, prefName, cityCode, cityName };
}
