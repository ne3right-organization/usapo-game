import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/set-nickname";
import { dataClient, ensureProfile, unwrap } from "../shared/dataClient";

const MAX_LENGTH = 12;

// ニックネームを変え、ランキングに出しているベスト記録(地図パズル・地図ポットン)のニックネームも書き直す
// (Supabase 版のトリガー game_profiles_propagate_nickname に当たる)
export const handler: Schema["setNickname"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const trimmed = (event.arguments.nickname ?? "").trim();
  if ([...trimmed].length > MAX_LENGTH) throw new Error(`ニックネームは${MAX_LENGTH}文字以内で入力してください`);
  const nickname = trimmed === "" ? null : trimmed;

  const c = await dataClient(env);
  await ensureProfile(c, userId);
  const profile = unwrap(await c.models.GameProfile.update({ userId, nickname }));

  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameMapPuzzleBest.list({ userId, nextToken });
    // 1件ずつ待つと記録の多い人で時間切れになるので、1ページ分はまとめて書く
    await Promise.all(
      unwrap(page).map(async (best) => unwrap(await c.models.GameMapPuzzleBest.update({ userId, areaKey: best.areaKey, nickname })))
    );
    nextToken = page.nextToken;
  } while (nextToken);

  do {
    const page = await c.models.GameMapPackBest.list({ userId, nextToken });
    await Promise.all(
      unwrap(page).map(async (best) => unwrap(await c.models.GameMapPackBest.update({ userId, areaKey: best.areaKey, nickname })))
    );
    nextToken = page.nextToken;
  } while (nextToken);

  do {
    const page = await c.models.GameMapPackUserTotal.list({ userId, nextToken });
    await Promise.all(
      unwrap(page).map(async (total) => unwrap(await c.models.GameMapPackUserTotal.update({ userId, level: total.level, nickname })))
    );
    nextToken = page.nextToken;
  } while (nextToken);

  return profile;
};
