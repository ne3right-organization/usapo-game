import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-place";
import { dataClient, unwrap } from "../shared/dataClient";
import { assertNotTooFast, locateTownDistrict, rememberPosition, requirePlayer } from "../shared/chizuTane";
import { firstBaseType } from "../../../src/lib/game/chizuTane/courses";

/**
 * いまいる地区にタネ(拠点)をまく。1地区に1つ、早い者勝ち。
 * 初期試作ではレベルが無いので、種類は自分のコースの1種類目、ランクは1(docs/地図タネ_初期試作設計書.md の 4章)
 */
export const handler: Schema["placeTaneBase"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const now = new Date();

  const district = await locateTownDistrict(event.arguments);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  if (unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }))) {
    throw new Error("この地区にはもうタネがあります");
  }
  const baseType = firstBaseType(player.course as Parameters<typeof firstBaseType>[0]);
  // 同時にまこうとしたときは、Amplify Data の create が主キーの重複で失敗するので、先に書いた方だけが通る
  const res = await c.models.GameTaneBase.create({
    areaKey: district.areaKey,
    ownerId: userId,
    cityKey: `${district.prefCode}${district.cityCode}`,
    prefCode: district.prefCode,
    prefName: district.prefName,
    cityCode: district.cityCode,
    cityName: district.cityName,
    townName: district.townName,
    baseTypeId: baseType.id,
    rank: 1,
    plantedAt: now.toISOString(),
  });
  if (res.errors?.length || !res.data) throw new Error("この地区にはもうタネがあります");

  await rememberPosition(c, userId, district, now);
  return res.data;
};
