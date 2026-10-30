import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-seeds";
import { dataClient, unwrap } from "../shared/dataClient";
import { assertNotTooFast, locateTownDistrict, rememberPosition, requirePlayer, takeDroppedSeeds } from "../shared/chizuTane";
import { DROPPED_SEEDS_MAX } from "../../../src/lib/game/chizuTane/courses";

/**
 * いまいる地区のタネ(拠点)に落ちているタネを、選んだ数だけ拾う。誰でも(持ち主でもほかの人でも、自分が落とした分も)
 * 早い者勝ちで拾える。拾えた数を返す(先にほかの人が拾って足りなければ0)
 */
export const handler: Schema["pickUpTaneSeeds"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const now = new Date();
  const count = event.arguments.count;
  if (!Number.isInteger(count) || count < 1 || count > DROPPED_SEEDS_MAX) throw new Error("拾う数の指定が正しくありません");

  const district = await locateTownDistrict(event.arguments);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const base = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (!base) throw new Error("この地区にはまだタネがありません");
  await rememberPosition(c, userId, district, now);

  // 拠点から減らすのと自分のタネに足すのは1つのトランザクション(同時に拾っても数がずれず、途中で消えることも無い)
  return (await takeDroppedSeeds(base.areaKey, userId, base.seedItemId, count)) ? count : 0;
};
