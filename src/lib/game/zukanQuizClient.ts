"use client";

import type { GeoJsonGeometry, ZukanQuizDifficulty } from "@/lib/game/zukanQuizData";
import { currentUser } from "@/lib/auth";
import { data, guestOrUserAuthMode, unwrap, type Schema } from "@/lib/amplify/data";

export type { GeoJsonGeometry, ZukanQuizDifficulty };

// このファイルは mapPuzzleData.ts のクイズ版に相当する。
// 出題(startZukanQuiz)と回答の判定(claimZukanQuizAnswer)は Lambda のカスタムミューテーションで、
// 正答はサーバーにだけ置く(クライアントの「正解でした」という自己申告は一切信用しない)。
// 未ログインでも遊べるよう、ログインしていなければ Identity Pool のゲストとして呼ぶ

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

export interface ZukanQuizChoice {
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
}

export interface ZukanQuizTrivia {
  industry: string | null;
  specialty: string | null;
  historicalEvent: string | null;
  touristSpot: string | null;
  notablePerson: string | null;
  festival: string | null;
  natureFeature: string | null;
  localCuisine: string | null;
}

export interface ZukanQuizQuestion {
  sessionId: string;
  difficulty: ZukanQuizDifficulty;
  silhouette: GeoJsonGeometry;
  choices: ZukanQuizChoice[];
  trivia: ZukanQuizTrivia;
  population: number;
  households: number;
}

/** a.json の項目は文字列で返ることがあるので、どちらでも受け取れるようにする */
function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

// excludeCityCodes: 同一セッション内で既に出題した自治体("prefCode:cityCode")。再出題を避ける
export async function startZukanQuiz(
  difficulty: ZukanQuizDifficulty,
  excludeCityCodes: string[] = []
): Promise<ZukanQuizQuestion> {
  const q = unwrap(
    await data.mutations.startZukanQuiz({ difficulty, excludeCityCodes }, { authMode: await guestOrUserAuthMode() })
  );
  if (!q) throw new Error("問題の取得に失敗しました");
  return {
    sessionId: q.sessionId,
    difficulty: q.difficulty as ZukanQuizDifficulty,
    silhouette: parseJson<GeoJsonGeometry>(q.silhouette),
    choices: parseJson<ZukanQuizChoice[]>(q.choices),
    trivia: parseJson<ZukanQuizTrivia>(q.trivia),
    population: q.population,
    households: q.households,
  };
}

export interface ZukanQuizAnswerResult {
  isCorrect: boolean;
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
  population: number | null;
  households: number | null;
  attemptCount: number;
  correctCount: number;
  difficulty: ZukanQuizDifficulty;
}

export async function submitZukanQuizAnswer(
  sessionId: string,
  prefCode: string,
  cityCode: string
): Promise<ZukanQuizAnswerResult> {
  const row = unwrap(
    await data.mutations.claimZukanQuizAnswer({ sessionId, prefCode, cityCode }, { authMode: await guestOrUserAuthMode() })
  );
  if (!row) throw new Error("回答結果を取得できませんでした");
  return {
    isCorrect: row.isCorrect,
    prefCode: row.prefCode,
    prefName: row.prefName,
    cityCode: row.cityCode,
    cityName: row.cityName,
    population: row.population ?? null,
    households: row.households ?? null,
    attemptCount: row.attemptCount,
    correctCount: row.correctCount,
    difficulty: row.difficulty as ZukanQuizDifficulty,
  };
}

async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

// ─── トップページ: 最近図鑑に登録された自治体 ───────────────────────────────────────
//
// 誰が獲得したかは一切特定せず、自治体名+最終登録時刻のみを GameRecentClear(game = zukan-quiz)から
// 取得する(回答の Lambda が更新する。未ログインでも読める)。むずかしいはトリビア登録の
// 有無を問わず出題されるため、ここに出た自治体をきっかけにトリビア登録を促す狙い

export interface RecentZukanRegistration {
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
  lastAcquiredAt: string;
}

export async function fetchRecentZukanRegistrations(limit = 8): Promise<RecentZukanRegistration[]> {
  const page = await data.models.GameRecentClear.listRecentClearsByGame(
    { game: "zukan-quiz" },
    { sortDirection: "DESC", limit, authMode: await guestOrUserAuthMode() }
  );
  return unwrap(page).map((item) => ({
    prefCode: item.prefCode,
    prefName: item.prefName,
    cityCode: item.cityCode ?? "",
    cityName: item.cityName ?? "",
    lastAcquiredAt: item.lastClearedAt,
  }));
}

// ─── 図鑑 ──────────────────────────────────────────────────────────────────────

export interface ZukanCollectionEntry {
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
  population: number | null;
  households: number | null;
  correctCount: number;
  bestDifficulty: ZukanQuizDifficulty;
  hintFields: string[];
  firstAcquiredAt: string;
  lastAcquiredAt: string;
}

type CollectionItem = Schema["GameZukanCollection"]["type"];

function toCollectionEntry(item: CollectionItem): ZukanCollectionEntry {
  return {
    prefCode: item.prefCode,
    prefName: item.prefName,
    cityCode: item.cityCode,
    cityName: item.cityName,
    population: item.population ?? null,
    households: item.households ?? null,
    correctCount: item.correctCount,
    bestDifficulty: item.bestDifficulty as ZukanQuizDifficulty,
    hintFields: (item.hintFields ?? []).filter((f): f is string => !!f),
    firstAcquiredAt: item.firstAcquiredAt,
    lastAcquiredAt: item.lastAcquiredAt,
  };
}

// userIdを省略すると自分の図鑑を返す(未ログインなら空配列。ゲストは図鑑を持たないため)。
// userIdを指定した場合は他ユーザーの図鑑
export async function fetchZukanCollections(userId?: string): Promise<ZukanCollectionEntry[]> {
  const me = await currentUser();
  if (!me) return [];
  const targetId = userId ?? me.id;
  const items: CollectionItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameZukanCollection.listZukanCollectionsByUser(
      { userId: targetId },
      { sortDirection: "DESC", nextToken }
    );
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items.map(toCollectionEntry);
}

export async function fetchZukanCollectionEntry(
  userId: string,
  prefCode: string,
  cityCode: string
): Promise<ZukanCollectionEntry | null> {
  const item = unwrap(await data.models.GameZukanCollection.get({ userId, areaKey: `${prefCode}#${cityCode}` }));
  return item ? toCollectionEntry(item) : null;
}

// ─── カード詳細用: シルエット・トリビアをCloudFrontから直接取得 ───────────────────
//
// 図鑑カードには出題時のジオメトリを保存していないため、カード詳細画面を開いた時に
// 既存の出題APIと同じCloudFrontのgeojson/トリビアJSONをクライアントから直接fetchする
// (どちらも公開データで、CORS許可ドメインにこのアプリのオリジンが設定済み)

interface CloudFrontMunicipalityFeature {
  type: "Feature";
  properties: { prefCode: string; prefName: string; cityCode: string; cityName: string };
  geometry: GeoJsonGeometry;
}

export async function fetchMunicipalityGeometry(
  prefCode: string,
  cityCode: string
): Promise<GeoJsonGeometry | null> {
  const geometries = await fetchMunicipalityGeometriesByPref(prefCode);
  return geometries.get(cityCode) ?? null;
}

// 図鑑グリッドでは同じ都道府県のカードを何枚もまとめて表示するため、
// 1都道府県分のgeojsonを1回のfetchで取得してcityCode単位のMapにしてから使い回す
export async function fetchMunicipalityGeometriesByPref(prefCode: string): Promise<Map<string, GeoJsonGeometry>> {
  const res = await fetch(`${CLOUDFRONT_URL}/geojson/municipality/2020/${prefCode}.geojson`);
  if (!res.ok) return new Map();
  const data: { features: CloudFrontMunicipalityFeature[] } = await res.json();
  return new Map(data.features.map((f) => [f.properties.cityCode, f.geometry]));
}

export function zukanGeometryKey(prefCode: string, cityCode: string): string {
  return `${prefCode}:${cityCode}`;
}

// 図鑑カード一覧(自分/他ユーザーどちらも)のミニシルエット表示用。
// 対象カードが属する都道府県分だけgeojsonをまとめて取得する
export async function fetchGeometriesForCollections(
  collections: ZukanCollectionEntry[]
): Promise<Map<string, GeoJsonGeometry>> {
  const prefCodes = Array.from(new Set(collections.map((c) => c.prefCode)));
  const geometries = new Map<string, GeoJsonGeometry>();
  await Promise.all(
    prefCodes.map(async (prefCode) => {
      const byCity = await fetchMunicipalityGeometriesByPref(prefCode);
      for (const [cityCode, geometry] of byCity) {
        geometries.set(zukanGeometryKey(prefCode, cityCode), geometry);
      }
    })
  );
  return geometries;
}

interface CloudFrontTriviaMunicipality extends ZukanQuizTrivia {
  cityCode: string;
  cityName: string;
}

export async function fetchMunicipalityTrivia(
  prefCode: string,
  cityCode: string
): Promise<ZukanQuizTrivia | null> {
  const res = await fetch(`${CLOUDFRONT_URL}/municipality-trivia/${prefCode}.json`);
  if (!res.ok) return null;
  const data: { municipalities: CloudFrontTriviaMunicipality[] } = await res.json();
  const municipality = data.municipalities?.find((m) => m.cityCode === cityCode);
  return municipality ?? null;
}

// ─── カードへのコメント(出題ヒントにしてほしいトリビアの提案) ───────────────────────
//
// 「コメント」という機能名だが、意図は自由な雑談ではなく「このカードのクイズで
// 出題時のヒントにしてほしいトリビア」の提案。採用判断・実際のヒントへの反映は
// 本体側(team-kokuusa-platform-frontend)のトリビア管理画面での人力キュレーション
// 前提で、ここではあくまで投稿を貯める場(自動でヒントに反映されるわけではない)。
// そのカードを獲得済みのユーザーのみ投稿可(RLSで強制、クリア数に応じた簡易的な
// スパム対策)。1ユーザー1カードにつき1件で編集・削除は本人のみ。閲覧はログインユーザーなら誰でも可

export interface ZukanCollectionComment {
  userId: string;
  nickname: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

type CommentItem = Schema["GameZukanComment"]["type"];

function toComment(item: CommentItem): ZukanCollectionComment {
  return {
    userId: item.userId,
    nickname: item.nickname ?? null,
    body: item.body,
    createdAt: item.postedAt,
    updatedAt: item.editedAt,
  };
}

export async function fetchZukanCollectionComments(
  prefCode: string,
  cityCode: string
): Promise<ZukanCollectionComment[]> {
  const items: CommentItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameZukanComment.listZukanCommentsByArea(
      { areaKey: `${prefCode}#${cityCode}` },
      { sortDirection: "DESC", nextToken }
    );
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items.map(toComment);
}

// カードを持っているかの確認は Lambda(zukan-comment)が行う
export async function upsertZukanCollectionComment(
  prefCode: string,
  cityCode: string,
  body: string
): Promise<ZukanCollectionComment> {
  await requireUserId();
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new Error("コメントは1〜200文字で入力してください");
  }
  const item = unwrap(await data.mutations.upsertZukanComment({ prefCode, cityCode, body: trimmed }));
  if (!item) throw new Error("保存できませんでした");
  return toComment(item as CommentItem);
}

export async function deleteZukanCollectionComment(prefCode: string, cityCode: string): Promise<void> {
  await requireUserId();
  unwrap(await data.mutations.deleteZukanComment({ prefCode, cityCode }));
}
