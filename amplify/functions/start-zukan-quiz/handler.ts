import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/start-zukan-quiz";
import { dataClient, unwrap } from "../shared/dataClient";
import {
  ALL_PREF_CODES,
  fetchMunicipalityCandidatesForPrefecture,
  fetchTriviaCandidates,
  generateZukanQuizQuestion,
  type QuizTargetCandidate,
  type ZukanQuizDifficulty,
} from "../../../src/lib/game/zukanQuizGenerator";

const VALID_DIFFICULTIES: ZukanQuizDifficulty[] = ["beginner", "intermediate", "advanced"];
const SESSION_TTL_SECONDS = 30 * 60; // 回答の期限(Supabase 版と同じ30分)

/**
 * 図鑑クイズを1問出す。正答はここで GameZukanQuizSession に保存するだけで、返すのは
 * シルエット・選択肢の地名・ヒントだけ(Supabase 版の Route Handler /api/zukan-quiz と同じ)。
 * 出題対象はトリビア登録済みの自治体のみ。ただしむずかしいだけはヒントを出さない代わりに全自治体から出す
 */
export const handler: Schema["startZukanQuiz"]["functionHandler"] = async (event) => {
  const excludeKeys = new Set((event.arguments.excludeCityCodes ?? []).filter((k): k is string => !!k));
  const difficulty = VALID_DIFFICULTIES.includes(event.arguments.difficulty as ZukanQuizDifficulty)
    ? (event.arguments.difficulty as ZukanQuizDifficulty)
    : "intermediate";

  // むずかしいは47都道府県ぶんを毎回まとめて取ると重いので、都道府県を1つランダムに選んでその中から出す
  // (選んだ都道府県が全部出題済みで候補が空になった場合だけ選び直す)
  let candidates: QuizTargetCandidate[] = [];
  if (difficulty === "advanced") {
    const tried = new Set<string>();
    while (candidates.length === 0 && tried.size < ALL_PREF_CODES.length) {
      const remaining = ALL_PREF_CODES.filter((code) => !tried.has(code));
      const prefCode = remaining[Math.floor(Math.random() * remaining.length)];
      tried.add(prefCode);
      const prefCandidates = await fetchMunicipalityCandidatesForPrefecture(prefCode);
      candidates = prefCandidates.filter((cand) => !excludeKeys.has(`${cand.prefCode}:${cand.cityCode}`));
    }
  } else {
    candidates = (await fetchTriviaCandidates()).filter((cand) => !excludeKeys.has(`${cand.prefCode}:${cand.cityCode}`));
  }
  if (candidates.length === 0) throw new Error("出題できる問題がなくなりました");

  const { question, answer } = await generateZukanQuizQuestion(candidates, difficulty);
  const hintFields = Object.entries(question.trivia)
    .filter(([, value]) => value != null)
    .map(([key]) => key);

  const c = await dataClient(env);
  const session = unwrap(
    await c.models.GameZukanQuizSession.create({
      prefCode: answer.prefCode,
      prefName: answer.prefName,
      cityCode: answer.cityCode,
      cityName: answer.cityName,
      population: answer.population,
      households: answer.households,
      difficulty,
      hintFields,
      issuedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    })
  );
  if (!session) throw new Error("問題を保存できませんでした");

  return {
    sessionId: session.id,
    difficulty,
    silhouette: JSON.stringify(question.silhouette),
    choices: JSON.stringify(question.choices),
    trivia: JSON.stringify(question.trivia),
    population: question.population,
    households: question.households,
  };
};
