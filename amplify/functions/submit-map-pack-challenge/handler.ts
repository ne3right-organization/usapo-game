import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/submit-map-pack-challenge";
import { areaKeysOf, dataClient, ensureProfile, unwrap, type DataClient } from "../shared/dataClient";

// 得点の式はクライアント(MapPackGame.tsx)と同じ。変えるときは両方そろえる
const RESTACK_PENALTY = 50;
const SPLIT_PENALTY = 200;
const CLEAR_BONUS = 1000;
const TIME_BONUS_SEC = 300;
const TIME_BONUS_PER_SEC = 5;
const MERGE_POINT = 10;
const MAX_PIECES = 10000;

/**
 * 地図ポットンの挑戦を記録する。Supabase 版のトリガー(game_map_pack_challenges_before_insert / after_insert)と同じく、
 * 得点はここで計算し直し、自己ベスト・中断データ・人ごとの合計をまとめて更新する。
 * 物理演算はクライアントで動くので元の値(合体の点・回数・完成したか)は自己申告になる。ありえない値だけ弾く
 */
export const handler: Schema["submitMapPackChallenge"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const a = event.arguments;
  const cityCode = a.cityCode || null;
  if (a.difficulty === "advanced" && !cityCode) throw new Error("上級は市区町村の指定が必要です");
  const n = a.totalPieces;
  if (!Number.isInteger(n) || n < 2 || n > MAX_PIECES) throw new Error("totalPieces が不正です");
  // 合体1回ごとに「合体後のピース数×10点」。全ピースを1つのかたまりに足し続けた場合が上限
  const maxMerge = MERGE_POINT * ((n * (n + 1)) / 2 - 1);
  if (!Number.isInteger(a.mergePoints) || a.mergePoints < 0 || a.mergePoints % MERGE_POINT !== 0 || a.mergePoints > maxMerge) {
    throw new Error("mergePoints が不正です");
  }
  for (const [name, v] of [["restackCount", a.restackCount], ["splitCount", a.splitCount], ["elapsedSeconds", a.elapsedSeconds]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${name} が不正です`);
  }

  const clearBonus = a.cleared ? CLEAR_BONUS + Math.max(0, TIME_BONUS_SEC - a.elapsedSeconds) * TIME_BONUS_PER_SEC : 0;
  const score = Math.max(0, a.mergePoints - a.restackCount * RESTACK_PENALTY - a.splitCount * SPLIT_PENALTY) + clearBonus;

  const { areaKey, rankingKey } = areaKeysOf({ difficulty: a.difficulty, prefCode: a.prefCode, cityCode });
  const now = new Date().toISOString();

  const c = await dataClient(env);
  const { nickname } = await ensureProfile(c, userId);
  const best = unwrap(await c.models.GameMapPackBest.get({ userId, areaKey }));
  const isNewBest = !best || score > best.bestScore;

  const challenge = unwrap(
    await c.models.GameMapPackChallenge.create({
      userId,
      nickname,
      difficulty: a.difficulty,
      prefCode: a.prefCode,
      prefName: a.prefName,
      cityCode,
      cityName: a.cityName || null,
      totalPieces: n,
      mergePoints: a.mergePoints,
      restackCount: a.restackCount,
      splitCount: a.splitCount,
      cleared: a.cleared,
      elapsedSeconds: a.elapsedSeconds,
      clearBonus,
      score,
      isNewBest,
      playedAt: now,
    })
  );
  if (!challenge) throw new Error("記録を保存できませんでした");

  if (!best) {
    unwrap(
      await c.models.GameMapPackBest.create({
        userId,
        areaKey,
        rankingKey,
        nickname,
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
        firstClearedAt: a.cleared ? now : null,
      })
    );
  } else {
    unwrap(
      await c.models.GameMapPackBest.update({
        userId,
        areaKey,
        nickname,
        playCount: best.playCount + 1,
        lastPlayedAt: now,
        // 完成した挑戦がベスト更新にならなくても、初めての完成なら日時を入れる
        ...(!best.firstClearedAt && a.cleared && { firstClearedAt: now }),
        ...(isNewBest && { bestScore: score, bestChallengeId: challenge.id, prefName: a.prefName, cityName: a.cityName || null }),
      })
    );
  }

  // 終わったゲームは再開の対象にしない(あきらめた場合も同じ)
  await c.models.GameMapPackProgress.delete({ userId, areaKey });

  await refreshUserTotal(c, userId, a.difficulty, nickname);

  return { score, isNewBest };
};

/** その人のその難易度のベスト記録を全部足し直し、一番点の高いエリアも選び直す */
async function refreshUserTotal(
  c: DataClient,
  userId: string,
  difficulty: Schema["GameDifficulty"]["type"],
  nickname: string | null
) {
  let totalScore = 0;
  let areasCount = 0;
  let lastPlayedAt = "";
  let top: { prefCode: string; prefName: string; cityCode?: string | null; cityName?: string | null; bestScore: number; lastPlayedAt: string } | null = null;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameMapPackBest.list({ userId, areaKey: { beginsWith: `${difficulty}#` }, nextToken });
    for (const b of unwrap(page)) {
      totalScore += b.bestScore;
      areasCount++;
      if (b.lastPlayedAt > lastPlayedAt) lastPlayedAt = b.lastPlayedAt;
      if (!top || b.bestScore > top.bestScore || (b.bestScore === top.bestScore && b.lastPlayedAt > top.lastPlayedAt)) top = b;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  if (!top) return;

  const fields = {
    userId,
    difficulty,
    nickname,
    totalScore,
    areasCount,
    topPrefCode: top.prefCode,
    topPrefName: top.prefName,
    topCityCode: top.cityCode ?? null,
    topCityName: top.cityName ?? null,
    topScore: top.bestScore,
    lastPlayedAt,
  };
  const existing = unwrap(await c.models.GameMapPackUserTotal.get({ userId, difficulty }));
  unwrap(existing ? await c.models.GameMapPackUserTotal.update(fields) : await c.models.GameMapPackUserTotal.create(fields));
}
