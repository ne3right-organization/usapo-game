"use client";

import { createClient } from "@/lib/supabase/client";
import type { GeoJsonGeometry, ZukanQuizDifficulty } from "@/lib/game/zukanQuizData";

export type { GeoJsonGeometry, ZukanQuizDifficulty };

// このファイルは mapPuzzleData.ts のクイズ版に相当する。
// 出題生成(/api/zukan-quiz)だけはサーバー側で正答を隠しつつ組み立てる必要があるためAPI Route経由、
// 回答判定はDBのclaim_zukan_quiz_answer関数(security definer)をRPCで直接呼ぶ
// (地図パズルのスコア計算がトリガーで行われているのと同じ考え方: クライアントの
// 「正解でした」という自己申告は一切信用しない)。

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

// excludeCityCodes: 同一セッション内で既に出題した自治体("prefCode:cityCode")。
// 再出題を避けるためRoute Handler側の候補から除外してもらう
export async function startZukanQuiz(
  difficulty: ZukanQuizDifficulty,
  excludeCityCodes: string[] = []
): Promise<ZukanQuizQuestion> {
  const res = await fetch("/api/zukan-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ difficulty, excludeCityCodes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "問題の取得に失敗しました");
  }
  return res.json();
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

interface ClaimAnswerRow {
  is_correct: boolean;
  pref_code: string;
  pref_name: string;
  city_code: string;
  city_name: string;
  population: number | null;
  households: number | null;
  attempt_count: number;
  correct_count: number;
  difficulty: ZukanQuizDifficulty;
}

export async function submitZukanQuizAnswer(
  sessionId: string,
  prefCode: string,
  cityCode: string
): Promise<ZukanQuizAnswerResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("claim_zukan_quiz_answer", {
    p_session_id: sessionId,
    p_answer_pref_code: prefCode,
    p_answer_city_code: cityCode,
  });
  if (error) throw new Error(error.message);

  const row = (data as ClaimAnswerRow[] | null)?.[0];
  if (!row) throw new Error("回答結果を取得できませんでした");

  return {
    isCorrect: row.is_correct,
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code,
    cityName: row.city_name,
    population: row.population,
    households: row.households,
    attemptCount: row.attempt_count,
    correctCount: row.correct_count,
    difficulty: row.difficulty,
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

interface CollectionRow {
  pref_code: string;
  pref_name: string;
  city_code: string;
  city_name: string;
  population: number | null;
  households: number | null;
  correct_count: number;
  best_difficulty: ZukanQuizDifficulty;
  hint_fields: string[];
  first_acquired_at: string;
  last_acquired_at: string;
}

function rowToCollectionEntry(row: CollectionRow): ZukanCollectionEntry {
  return {
    prefCode: row.pref_code,
    prefName: row.pref_name,
    cityCode: row.city_code,
    cityName: row.city_name,
    population: row.population,
    households: row.households,
    correctCount: row.correct_count,
    bestDifficulty: row.best_difficulty,
    hintFields: row.hint_fields ?? [],
    firstAcquiredAt: row.first_acquired_at,
    lastAcquiredAt: row.last_acquired_at,
  };
}

// userIdを省略すると自分の図鑑を返す(未ログインなら空配列。ゲストは図鑑を持たないため)。
// userIdを指定した場合は他ユーザーの図鑑(nickname公開済みならRLSで閲覧可、
// 非公開または存在しなければ単に空配列になる)
export async function fetchZukanCollections(userId?: string): Promise<ZukanCollectionEntry[]> {
  const supabase = createClient();
  let targetId = userId;
  if (!targetId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    targetId = user.id;
  }

  const { data, error } = await supabase
    .from("game_zukan_collections")
    .select("*")
    .eq("user_id", targetId)
    .order("last_acquired_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCollectionEntry);
}

export async function fetchZukanCollectionEntry(
  userId: string,
  prefCode: string,
  cityCode: string
): Promise<ZukanCollectionEntry | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("game_zukan_collections")
    .select("*")
    .eq("user_id", userId)
    .eq("pref_code", prefCode)
    .eq("city_code", cityCode)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? rowToCollectionEntry(data) : null;
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

interface CommentRow {
  user_id: string;
  nickname: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

function rowToComment(row: CommentRow): ZukanCollectionComment {
  return {
    userId: row.user_id,
    nickname: row.nickname,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchZukanCollectionComments(
  prefCode: string,
  cityCode: string
): Promise<ZukanCollectionComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("game_zukan_collection_comments")
    .select("*")
    .eq("pref_code", prefCode)
    .eq("city_code", cityCode)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToComment);
}

export async function upsertZukanCollectionComment(
  prefCode: string,
  cityCode: string,
  body: string
): Promise<ZukanCollectionComment> {
  const supabase = createClient();
  const userId = await requireUserId();
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new Error("コメントは1〜200文字で入力してください");
  }

  const { data: profile } = await supabase
    .from("game_profiles")
    .select("nickname")
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("game_zukan_collection_comments")
    .upsert(
      {
        user_id: userId,
        pref_code: prefCode,
        city_code: cityCode,
        nickname: profile?.nickname ?? null,
        body: trimmed,
      },
      { onConflict: "user_id,pref_code,city_code" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rowToComment(data);
}

export async function deleteZukanCollectionComment(prefCode: string, cityCode: string): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId();

  const { error } = await supabase
    .from("game_zukan_collection_comments")
    .delete()
    .eq("user_id", userId)
    .eq("pref_code", prefCode)
    .eq("city_code", cityCode);

  if (error) throw new Error(error.message);
}
