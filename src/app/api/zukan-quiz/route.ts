import { randomUUID } from "node:crypto";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  generateZukanQuizQuestion,
  fetchTriviaCandidates,
  fetchMunicipalityCandidatesForPrefecture,
  ALL_PREF_CODES,
  type QuizTargetCandidate,
  type ZukanQuizDifficulty,
} from "@/lib/game/zukanQuizData";

const VALID_DIFFICULTIES: ZukanQuizDifficulty[] = ["beginner", "intermediate", "advanced"];

interface RequestBody {
  difficulty?: string;
  // 同一セッション内で同じ自治体が再出題されないよう、クライアントが
  // これまでの出題済み自治体を "prefCode:cityCode" 形式で送ってくる
  excludeCityCodes?: string[];
}

// 出題生成のみを担当するRoute Handler。正答(answer)はここでDBに保存するだけで、
// レスポンスには question(シルエット座標 + 選択肢の地名 + ヒント)しか含めない。
// 出題対象はCloudFront配信のトリビアJSON(本体側 team-kokuusa-platform-frontend の
// 管理画面で登録・公開されたもの)に登録済みの自治体のみ(ヒント無しでは出題しない方針)。
// ただしむずかしいだけは例外で、ヒントを一切出さない代わりにトリビア登録の有無を問わず
// 全自治体を出題対象にする(ユーザー指示、2026-08-01)。
// game_zukan_quiz_sessions への書き込みはRLSポリシーで誰でもINSERT可(ゲストプレイ許可)、
// かつSELECT/UPDATEは一切許可していないため、ここではservice roleキー等は不要で
// 通常のanonキーで十分(書き込み専用の一時テーブルのため)。
//
// difficulty・実際に見せたヒント項目(hint_fields)はここでセッション行に保存し、
// claim_zukan_quiz_answer がそこから読む(クライアントの自己申告を信用しないため)。
export async function POST(request: Request) {
  const body: RequestBody = await request.json().catch(() => ({}));
  const excludeKeys = new Set(body.excludeCityCodes ?? []);

  const difficulty = VALID_DIFFICULTIES.includes(body.difficulty as ZukanQuizDifficulty)
    ? (body.difficulty as ZukanQuizDifficulty)
    : "intermediate";

  // むずかしいはヒントを出さない代わりにトリビア登録の有無を問わず全自治体から出題する。
  // ただし47都道府県ぶんを毎回まとめて取得すると重いため、都道府県を1つランダムに選んで
  // その中から出題する(選んだ都道府県が全て出題済みで候補が空になった場合のみ選び直す)
  let candidates: QuizTargetCandidate[] = [];
  if (difficulty === "advanced") {
    const triedPrefs = new Set<string>();
    while (candidates.length === 0 && triedPrefs.size < ALL_PREF_CODES.length) {
      const remaining = ALL_PREF_CODES.filter((c) => !triedPrefs.has(c));
      const prefCode = remaining[Math.floor(Math.random() * remaining.length)];
      triedPrefs.add(prefCode);
      const prefCandidates = await fetchMunicipalityCandidatesForPrefecture(prefCode);
      candidates = prefCandidates.filter((c) => !excludeKeys.has(`${c.prefCode}:${c.cityCode}`));
    }
  } else {
    const allCandidates = await fetchTriviaCandidates();
    candidates = allCandidates.filter((c) => !excludeKeys.has(`${c.prefCode}:${c.cityCode}`));
  }

  if (candidates.length === 0) {
    return NextResponse.json({ error: "出題できる問題がなくなりました" }, { status: 502 });
  }

  let generated;
  try {
    generated = await generateZukanQuizQuestion(candidates, difficulty);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "問題の生成に失敗しました" },
      { status: 502 }
    );
  }

  const { question, answer } = generated;
  const sessionId = randomUUID();
  const hintFields = Object.entries(question.trivia)
    .filter(([, value]) => value != null)
    .map(([key]) => key);

  const supabase = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error } = await supabase.from("game_zukan_quiz_sessions").insert({
    id: sessionId,
    pref_code: answer.prefCode,
    city_code: answer.cityCode,
    pref_name: answer.prefName,
    city_name: answer.cityName,
    population: answer.population,
    households: answer.households,
    difficulty,
    hint_fields: hintFields,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    sessionId,
    difficulty,
    silhouette: question.silhouette,
    choices: question.choices,
    trivia: question.trivia,
    population: question.population,
    households: question.households,
  });
}
