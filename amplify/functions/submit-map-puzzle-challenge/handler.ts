import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/submit-map-puzzle-challenge";
import { areaKeysOf, dataClient, ensureProfile, unwrap } from "../shared/dataClient";

const MAX_PIECES = 10000;
const MAX_COMMENT_LENGTH = 200;

/**
 * 地図パズルの挑戦を記録する。Supabase 版のトリガー(game_challenges_before_insert / after_insert)と同じく、
 * 得点はここで計算し直し(クライアントの自己申告を信用しない)、自己ベスト・中断データ・プロフィールの合計もまとめて更新する
 */
export const handler: Schema["submitMapPuzzleChallenge"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const a = event.arguments;
  const cityCode = a.cityCode || null;
  if (a.difficulty === "advanced" && !cityCode) throw new Error("上級は市区町村の指定が必要です");
  for (const [name, v, max] of [
    ["totalPieces", a.totalPieces, MAX_PIECES],
    ["missCount", a.missCount, 100000],
    ["elapsedSeconds", a.elapsedSeconds, 864000],
  ] as const) {
    if (!Number.isInteger(v) || v < (name === "totalPieces" ? 1 : 0) || v > max) throw new Error(`${name} が不正です`);
  }

  // 得点の式はクライアント(MapPuzzleGame.tsx)と同じ。変えるときは両方そろえる
  const baseScore = a.totalPieces * 10;
  const timeBonus = Math.max(0, a.totalPieces * 5 - Math.floor(a.elapsedSeconds / 10));
  const missPenalty = a.missCount * 5;
  const score = Math.max(0, baseScore + timeBonus - missPenalty);

  const { areaKey, rankingKey } = areaKeysOf({ difficulty: a.difficulty, prefCode: a.prefCode, cityCode });
  const now = new Date().toISOString();

  const c = await dataClient(env);
  const profile = await ensureProfile(c, userId);
  const best = unwrap(await c.models.GameMapPuzzleBest.get({ userId, areaKey }));
  const isNewBest = !best || score > best.bestScore;

  const challenge = unwrap(
    await c.models.GameMapPuzzleChallenge.create({
      userId,
      nickname: profile.nickname,
      difficulty: a.difficulty,
      prefCode: a.prefCode,
      prefName: a.prefName,
      cityCode,
      cityName: a.cityName || null,
      totalPieces: a.totalPieces,
      missCount: a.missCount,
      elapsedSeconds: a.elapsedSeconds,
      baseScore,
      timeBonus,
      missPenalty,
      score,
      isNewBest,
      comment: a.comment?.trim().slice(0, MAX_COMMENT_LENGTH) || null,
      playedAt: now,
    })
  );
  if (!challenge) throw new Error("記録を保存できませんでした");

  if (!best) {
    unwrap(
      await c.models.GameMapPuzzleBest.create({
        userId,
        areaKey,
        rankingKey,
        nickname: profile.nickname,
        difficulty: a.difficulty,
        prefCode: a.prefCode,
        prefName: a.prefName,
        cityCode,
        cityName: a.cityName || null,
        bestScore: score,
        bestChallengeId: challenge.id,
        playCount: 1,
        firstPlayedAt: now,
        lastPlayedAt: now,
      })
    );
  } else {
    unwrap(
      await c.models.GameMapPuzzleBest.update({
        userId,
        areaKey,
        nickname: profile.nickname,
        playCount: best.playCount + 1,
        lastPlayedAt: now,
        ...(isNewBest && { bestScore: score, bestChallengeId: challenge.id, prefName: a.prefName, cityName: a.cityName || null }),
      })
    );
  }

  // クリアしたエリアの中断データは要らない(無ければ何もしない)
  await c.models.GameMapPuzzleProgress.delete({ userId, areaKey });

  // プロフィールの合計は、規模が小さいので毎回ベスト記録を全部足し直す(Supabase 版と同じ)
  let totalScore = 0;
  let areasPlayedCount = 0;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameMapPuzzleBest.list({ userId, nextToken });
    for (const b of unwrap(page)) {
      totalScore += b.bestScore;
      areasPlayedCount++;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  unwrap(await c.models.GameProfile.update({ userId, totalScore, areasPlayedCount }));

  return challenge;
};
