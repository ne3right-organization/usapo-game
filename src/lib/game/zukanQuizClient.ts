"use client";

import { createClient } from "@/lib/supabase/client";
import type { GeoJsonGeometry } from "@/lib/game/zukanQuizData";

export type { GeoJsonGeometry };

// このファイルは mapPuzzleData.ts のクイズ版に相当する。
// 出題生成(/api/zukan-quiz)だけはサーバー側で正答を隠しつつ組み立てる必要があるためAPI Route経由、
// 回答判定はDBのclaim_zukan_quiz_answer関数(security definer)をRPCで直接呼ぶ
// (地図パズルのスコア計算がトリガーで行われているのと同じ考え方: クライアントの
// 「正解でした」という自己申告は一切信用しない)。

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
  silhouette: GeoJsonGeometry;
  choices: ZukanQuizChoice[];
  trivia: ZukanQuizTrivia;
  population: number;
  households: number;
}

// excludeCityCodes: 同一セッション内で既に出題した自治体("prefCode:cityCode")。
// 再出題を避けるためRoute Handler側の候補から除外してもらう
export async function startZukanQuiz(excludeCityCodes: string[] = []): Promise<ZukanQuizQuestion> {
  const res = await fetch("/api/zukan-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ excludeCityCodes }),
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
  };
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
    firstAcquiredAt: row.first_acquired_at,
    lastAcquiredAt: row.last_acquired_at,
  };
}

// 未ログインの場合は空配列を返す(ゲストは図鑑を持たないため)。
// ranking系と違い、図鑑は自分のものしか見られない仕様のため permission denied を
// クライアントに露出させる必要がなく、素直に「ログインしていなければ空」として扱う
export async function fetchZukanCollections(): Promise<ZukanCollectionEntry[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("game_zukan_collections")
    .select("*")
    .eq("user_id", user.id)
    .order("last_acquired_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCollectionEntry);
}

// ─── 都道府県別コンプリート率(分母) ─────────────────────────────────────────────

export interface PrefectureMunicipalityCount {
  prefCode: string;
  prefName: string;
  total: number;
}

export async function fetchPrefectureMunicipalityCounts(): Promise<PrefectureMunicipalityCount[]> {
  const res = await fetch("/api/zukan-quiz/prefectures");
  if (!res.ok) throw new Error("都道府県データの取得に失敗しました");
  return res.json();
}
