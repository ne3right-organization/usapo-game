import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-place";
import { dataClient, unwrap } from "../shared/dataClient";
import { assertNotTooFast, grantLevelSeeds, locateTownDistrict, rememberPosition, requirePlayer } from "../shared/chizuTane";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";

/**
 * いまいる地区にタネ(拠点)をまく。1地区に1つ、早い者勝ち。
 * 持っているタネ(もの)を1つ使い、そのものの種類の拠点を作る(梨の木のタネ → 果樹園)。種類やレベルの制限は無い。
 * 初期試作では拠点が育たないのでランクは1
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
  const item = TANE_ITEM_BY_ID.get(event.arguments.itemId);
  const baseType = item ? TANE_BASE_TYPE_BY_ID.get(item.baseTypeId) : undefined;
  if (!item || !baseType) throw new Error("そのタネはまけません");
  const seed = unwrap(await c.models.GameTaneHeldSeed.get({ userId, itemId: item.itemId }));
  if (!seed || seed.quantity < 1) throw new Error(`「${item.name}」のタネを持っていません`);
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
    seedItemId: item.itemId,
    rank: 1,
    plantedAt: now.toISOString(),
    droppedSeeds: 0,
  });
  if (res.errors?.length || !res.data) throw new Error("この地区にはもうタネがあります");
  unwrap(await c.models.GameTaneHeldSeed.update({ userId, itemId: item.itemId, quantity: seed.quantity - 1 }));
  // 今のレベルのタネを3つともまき終えたら、たずねた数しだいでレベルが上がり、次のタネがもらえる
  await grantLevelSeeds(c, player);

  await rememberPosition(c, userId, district, now);
  return res.data;
};
