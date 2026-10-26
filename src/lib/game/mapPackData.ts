"use client";

import type { Difficulty, RankingEntry, RankingPage } from "@/lib/game/mapPuzzleData";
import { currentUser } from "@/lib/auth";
import { areaKeyOf, data, rankingKeyOf, unwrap, type Schema } from "@/lib/amplify/data";

// 地図ポットンの挑戦結果の送信とランキング取得。Amplify Data(amplify/data/resource.ts)をブラウザから直接呼ぶ。
// 得点・ベスト記録・人ごとの合計はクライアントから書けず、記録の送信はカスタムミューテーション
// (amplify/functions/submit-map-pack-challenge)が行う。
// ランキングは地図パズルとは別集計。GameProfile の合計(地図パズルの合計)には含めない

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

type BestItem = Schema["GameMapPackBest"]["type"];
type ProgressItem = Schema["GameMapPackProgress"]["type"];

function areaOf(item: {
  difficulty: Difficulty | null;
  prefCode: string;
  prefName: string;
  cityCode?: string | null;
  cityName?: string | null;
}): MapPackArea {
  return {
    difficulty: item.difficulty as Difficulty,
    prefCode: item.prefCode,
    prefName: item.prefName,
    cityCode: item.cityCode ?? undefined,
    cityName: item.cityName ?? undefined,
  };
}

function toRanking(item: BestItem): RankingEntry {
  return {
    ...areaOf(item),
    userId: item.userId,
    nickname: item.nickname ?? null,
    bestScore: item.bestScore,
    lastPlayedAt: item.lastPlayedAt,
  };
}

async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

/** 未ログインなら null を返す(ゲストプレイ) */
export async function currentUserId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}

// score / clearBonus / isNewBest は Lambda が送られた値から計算し直すため、ここでは送らない
export async function submitMapPackChallenge(payload: MapPackSubmission): Promise<MapPackSubmitResult> {
  await requireUserId();
  const result = unwrap(
    await data.mutations.submitMapPackChallenge({
      difficulty: payload.difficulty,
      prefCode: payload.prefCode,
      prefName: payload.prefName,
      cityCode: payload.cityCode ?? null,
      cityName: payload.cityName ?? null,
      totalPieces: payload.totalPieces,
      mergePoints: payload.mergePoints,
      restackCount: payload.restackCount,
      splitCount: payload.splitCount,
      cleared: payload.cleared,
      elapsedSeconds: payload.elapsedSeconds,
    })
  );
  if (!result) throw new Error("記録を保存できませんでした");
  return { score: result.score, isNewBest: result.isNewBest };
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

/** cursor は Amplify Data の nextToken */
export async function fetchMapPackHistory(
  cursor?: string | null,
  limit = 20,
): Promise<{ items: MapPackHistoryRecord[]; nextCursor: string | null }> {
  const userId = await requireUserId();
  const page = await data.models.GameMapPackChallenge.listMapPackChallengesByUser(
    { userId },
    { sortDirection: "DESC", limit, nextToken: cursor ?? undefined }
  );
  const items: MapPackHistoryRecord[] = unwrap(page).map((item) => ({
    ...areaOf(item),
    id: item.id,
    score: item.score,
    cleared: item.cleared,
    totalPieces: item.totalPieces,
    restackCount: item.restackCount,
    elapsedSeconds: item.elapsedSeconds,
    isNewBest: item.isNewBest,
    playedAt: item.playedAt,
  }));
  return { items, nextCursor: page.nextToken ?? null };
}

/**
 * 難易度別ランキング(1人1行)。その難易度のエリアごとの自己ベストの合計点で並べ、一番点の高いエリアを
 * 代表として返す(bestScore は合計点、エリアは一番点の高いエリア)。cursor は Amplify Data の nextToken。
 * ログインして遊んだ人は全員出す(ニックネームが無ければ「未設定」と表示)
 */
export async function fetchMapPackModeRanking(
  difficulty: Difficulty,
  cursor?: string | null,
  limit = 20,
): Promise<RankingPage> {
  await requireUserId(); // 閲覧は要ログイン
  const page = await data.models.GameMapPackUserTotal.listMapPackUserTotalsByDifficulty(
    { difficulty },
    { sortDirection: "DESC", limit, nextToken: cursor ?? undefined }
  );
  const items: RankingEntry[] = unwrap(page).map((row) => {
    const top = {
      difficulty,
      prefCode: row.topPrefCode,
      prefName: row.topPrefName,
      cityCode: row.topCityCode ?? undefined,
      cityName: row.topCityName ?? undefined,
    };
    const topLabel = difficulty === "beginner" ? "全国" : top.cityName ? `${top.prefName} ${top.cityName}` : top.prefName;
    return {
      ...top,
      userId: row.userId,
      nickname: row.nickname ?? null,
      bestScore: row.totalScore,
      lastPlayedAt: row.lastPlayedAt,
      detail: `🏅 最高 ${row.topScore.toLocaleString()}点（${topLabel}）`,
      scoreCaption: `${row.areasCount}エリア合計`,
    };
  });
  return { items, nextCursor: page.nextToken ?? null };
}

/** ランキングのカードを開いたときに出す、その人のその難易度のエリア一覧(点数の高い順) */
export interface MapPackUserArea extends MapPackArea {
  bestScore: number;
  cleared: boolean;
  playCount: number;
}

export async function fetchMapPackUserAreas(userId: string, difficulty: Difficulty): Promise<MapPackUserArea[]> {
  const items: BestItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameMapPackBest.list({ userId, areaKey: { beginsWith: `${difficulty}#` }, nextToken });
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items
    .sort((a, b) => b.bestScore - a.bestScore)
    .map((item) => ({
      ...areaOf(item),
      bestScore: item.bestScore,
      cleared: item.firstClearedAt != null,
      playCount: item.playCount,
    }));
}

export async function fetchMapPackAreaRanking(
  area: { difficulty: Difficulty; prefCode: string; cityCode?: string },
  cursor?: string | null,
  limit = 20,
): Promise<RankingPage> {
  await requireUserId();
  const page = await data.models.GameMapPackBest.listMapPackBestByRankingKey(
    { rankingKey: rankingKeyOf(area) },
    { sortDirection: "DESC", limit, nextToken: cursor ?? undefined }
  );
  return { items: unwrap(page).map(toRanking), nextCursor: page.nextToken ?? null };
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

/** state(a.json)は文字列で書き、読むと文字列で返ることがあるので、どちらでも受け取れるようにする */
function parseSnapshot(state: unknown): MapPackSnapshot | null {
  try {
    let value: unknown = state;
    while (typeof value === "string") value = JSON.parse(value); // 二重に文字列化されていることがある
    const snap = value as MapPackSnapshot | null;
    return snap?.version === 1 ? snap : null;
  } catch {
    return null;
  }
}

export async function saveMapPackProgress(area: MapPackArea, snapshot: MapPackSnapshot): Promise<void> {
  const userId = await requireUserId();
  const fields = {
    userId,
    areaKey: areaKeyOf(area),
    difficulty: area.difficulty,
    prefCode: area.prefCode,
    prefName: area.prefName,
    cityCode: area.cityCode ?? null,
    cityName: area.cityName ?? null,
    state: JSON.stringify(snapshot),
    elapsedSeconds: snapshot.elapsedSec,
    savedAt: new Date().toISOString(),
  };
  const existing = unwrap(await data.models.GameMapPackProgress.get({ userId, areaKey: fields.areaKey }));
  unwrap(
    existing
      ? await data.models.GameMapPackProgress.update(fields)
      : await data.models.GameMapPackProgress.create(fields)
  );
}

/** 未ログインなら null(ゲスト扱い) */
export async function fetchMapPackProgress(area: MapPackArea): Promise<MapPackSnapshot | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const item = unwrap(await data.models.GameMapPackProgress.get({ userId, areaKey: areaKeyOf(area) }));
  return item ? parseSnapshot(item.state) : null;
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
    const items: ProgressItem[] = [];
    let nextToken: string | null | undefined;
    do {
      const page = await data.models.GameMapPackProgress.list({ userId, nextToken });
      items.push(...unwrap(page));
      nextToken = page.nextToken;
    } while (nextToken);
    for (const item of items) {
      list.push({
        area: areaOf(item),
        savedAt: new Date(item.savedAt).getTime(),
        dropped: parseSnapshot(item.state)?.dropped ?? 0,
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
  unwrap(await data.models.GameMapPackProgress.delete({ userId, areaKey: areaKeyOf(area) }));
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
