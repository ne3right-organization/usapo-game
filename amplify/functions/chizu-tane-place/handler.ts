import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-place";
import { dataClient, unwrap } from "../shared/dataClient";
import { assertNotTooFast, locateTownDistrict, rememberPosition, requirePlayer } from "../shared/chizuTane";
import { TANE_BASE_TYPE_BY_ID } from "../../../src/lib/game/chizuTane/courses";

/**
 * いまいる地区にタネ(拠点)をまく。1地区に1つ、早い者勝ち。
 * 持っているタネを1つ使う(種類やレベルの制限は無い)。初期試作では拠点が育たないのでランクは1
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
  const baseType = TANE_BASE_TYPE_BY_ID.get(event.arguments.baseTypeId);
  if (!baseType) throw new Error("そのタネはまけません");
  const seed = unwrap(await c.models.GameTaneSeed.get({ userId, baseTypeId: baseType.id }));
  if (!seed || seed.quantity < 1) throw new Error(`「${baseType.name}」のタネを持っていません`);
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
    lastSeedAt: now.toISOString(),
  });
  if (res.errors?.length || !res.data) throw new Error("この地区にはもうタネがあります");
  unwrap(await c.models.GameTaneSeed.update({ userId, baseTypeId: baseType.id, quantity: seed.quantity - 1 }));

  await rememberPosition(c, userId, district, now);
  return res.data;
};
