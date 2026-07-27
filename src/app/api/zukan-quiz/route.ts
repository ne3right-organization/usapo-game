import { randomUUID } from "node:crypto";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { generateZukanQuizQuestion, fetchTriviaCandidates, type QuizTargetCandidate } from "@/lib/game/zukanQuizData";

interface RequestBody {
  // 同一セッション内で同じ自治体が再出題されないよう、クライアントが
  // これまでの出題済み自治体を "prefCode:cityCode" 形式で送ってくる
  excludeCityCodes?: string[];
}

// 出題生成のみを担当するRoute Handler。正答(answer)はここでDBに保存するだけで、
// レスポンスには question(シルエット座標 + 選択肢の地名 + ヒント)しか含めない。
// 出題対象はCloudFront配信のトリビアJSON(本体側 team-kokuusa-platform-frontend の
// 管理画面で登録・公開されたもの)に登録済みの自治体のみ(ヒント無しでは出題しない方針)。
// game_zukan_quiz_sessions への書き込みはRLSポリシーで誰でもINSERT可(ゲストプレイ許可)、
// かつSELECT/UPDATEは一切許可していないため、ここではservice roleキー等は不要で
// 通常のanonキーで十分(書き込み専用の一時テーブルのため)。
export async function POST(request: Request) {
  const body: RequestBody = await request.json().catch(() => ({}));
  const excludeKeys = new Set(body.excludeCityCodes ?? []);

  const allCandidates: QuizTargetCandidate[] = await fetchTriviaCandidates();
  const candidates = allCandidates.filter((c) => !excludeKeys.has(`${c.prefCode}:${c.cityCode}`));

  if (candidates.length === 0) {
    return NextResponse.json({ error: "出題できる問題がなくなりました" }, { status: 502 });
  }

  let generated;
  try {
    generated = await generateZukanQuizQuestion(candidates);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "問題の生成に失敗しました" },
      { status: 502 }
    );
  }

  const { question, answer } = generated;
  const sessionId = randomUUID();

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
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    sessionId,
    silhouette: question.silhouette,
    choices: question.choices,
    trivia: question.trivia,
    population: question.population,
    households: question.households,
  });
}
