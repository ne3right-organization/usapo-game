import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/claim-zukan-quiz-answer";
import { dataClient, ensureProfile, touchRecentClear, unwrap } from "../shared/dataClient";

const SESSION_TTL_MS = 30 * 60 * 1000;
const DIFFICULTY_RANK: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };

/**
 * 図鑑クイズの回答を判定する(Supabase 版の claim_zukan_quiz_answer と同じ)。
 * 出題を消して1回きりにし、正答率を数え、ログインしていて正解なら図鑑に登録する。
 * 難易度・見せたヒントは出題時にサーバーが保存したものを使う(クライアントの自己申告を信用しない)
 */
export const handler: Schema["claimZukanQuizAnswer"]["functionHandler"] = async (event) => {
  // ゲスト(Identity Pool の未認証ユーザー)は sub を持たない
  const userId = (event.identity as AppSyncIdentityCognito | null)?.sub ?? null;
  const a = event.arguments;
  const c = await dataClient(env);

  // 消せた人だけが回答できる(同じ出題を2回送ると、2回目は消す対象が無くて失敗する)
  const deleted = await c.models.GameZukanQuizSession.delete({ id: a.sessionId });
  const session = deleted.errors?.length ? null : deleted.data;
  if (!session || Date.now() - new Date(session.issuedAt).getTime() > SESSION_TTL_MS) {
    throw new Error("このクイズは期限切れか、すでに回答済みです");
  }

  const isCorrect = a.prefCode === session.prefCode && a.cityCode === session.cityCode;
  const areaKey = `${session.prefCode}#${session.cityCode}`;

  const stat = unwrap(await c.models.GameZukanMunicipalityStat.get({ areaKey }));
  const attemptCount = (stat?.attemptCount ?? 0) + 1;
  const correctCount = (stat?.correctCount ?? 0) + (isCorrect ? 1 : 0);
  unwrap(
    stat
      ? await c.models.GameZukanMunicipalityStat.update({ areaKey, attemptCount, correctCount })
      : await c.models.GameZukanMunicipalityStat.create({ areaKey, attemptCount, correctCount })
  );

  if (isCorrect && userId) {
    await ensureProfile(c, userId);
    const now = new Date().toISOString();
    const hintFields = (session.hintFields ?? []).filter((f): f is string => !!f);
    const card = unwrap(await c.models.GameZukanCollection.get({ userId, areaKey }));
    if (card) {
      const better = (DIFFICULTY_RANK[session.difficulty] ?? 0) > (DIFFICULTY_RANK[card.bestDifficulty] ?? 0);
      unwrap(
        await c.models.GameZukanCollection.update({
          userId,
          areaKey,
          correctCount: card.correctCount + 1,
          lastAcquiredAt: now,
          hintFields,
          ...(better && { bestDifficulty: session.difficulty }),
        })
      );
    } else {
      unwrap(
        await c.models.GameZukanCollection.create({
          userId,
          areaKey,
          prefCode: session.prefCode,
          prefName: session.prefName,
          cityCode: session.cityCode,
          cityName: session.cityName,
          population: session.population,
          households: session.households,
          correctCount: 1,
          bestDifficulty: session.difficulty,
          hintFields,
          firstAcquiredAt: now,
          lastAcquiredAt: now,
        })
      );
    }
    await touchRecentClear(c, {
      game: "zukan-quiz",
      areaKey,
      prefCode: session.prefCode,
      prefName: session.prefName,
      cityCode: session.cityCode,
      cityName: session.cityName,
    });
  }

  return {
    isCorrect,
    prefCode: session.prefCode,
    prefName: session.prefName,
    cityCode: session.cityCode,
    cityName: session.cityName,
    population: session.population ?? null,
    households: session.households ?? null,
    attemptCount,
    correctCount,
    difficulty: session.difficulty,
  };
};
