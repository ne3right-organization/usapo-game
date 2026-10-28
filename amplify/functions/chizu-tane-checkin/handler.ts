import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addSeeds,
  addWater,
  assertNotTooFast,
  dropSeed,
  grantLevelSeeds,
  locateTownDistrict,
  rememberPosition,
  requirePlayer,
  resetAfterFruits,
  takeFruit,
  type LocateArgs,
  type SeedGain,
} from "../shared/chizuTane";
import { DROPPED_SEEDS_MAX, SEEDS_PER_CHECKIN, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { DAY_MS_PRODUCTION, dayKey } from "../../../src/lib/game/chizuTane/geo";
import {
  FRUITS_WHEN_RIPE,
  MAX_RANK,
  WATER_ONSITE,
  WATER_REMOTE,
  WATER_TO_RIPE,
  growthStage,
} from "../../../src/lib/game/chizuTane/growth";

// 「1日」の長さ。1日1回の区切り(本番は24時間、それ以外は5分)
const DAY_MS = Number(process.env.CHIZU_TANE_DAY_MS ?? DAY_MS_PRODUCTION);

type CheckInResult = Schema["TaneCheckInResult"]["type"];
type Args = Partial<LocateArgs> & { areaKey?: string };

/**
 * 地図タネの、現地のチェックイン(checkInTaneBase)と、遠くからの水やり(waterTaneBaseRemotely)。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(areaKey があれば遠くからの水やり)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { areaKey } = event.arguments;
  if (typeof areaKey === "string") return waterRemotely(c, userId, areaKey);
  return checkIn(c, userId, event.arguments as LocateArgs);
};

/**
 * 現地のチェックイン。持ち主でもほかの人でも同じで、1人1日1回(dev は「1日」が短い)。まいた直後からできる。
 * - 実が残っていれば、実を1個もらう(早い者勝ち)。最後の1個なら芽に戻り、ランクが1つ上がる
 * - 実っていなければ、水をやる(現地は10)。たまったら実って、実が10個できる
 * - ほかの人のタネに初めてチェックインしたときだけ、まかれていたタネを1個もらえ、拠点にもタネが1個落ちる(3個まで。誰でも拾える)。
 *   たずねた拠点の数が増えるので、レベルが上がることもある(自分のタネは訪問の記録に残さず、レベルにも数えない)
 */
async function checkIn(c: DataClient, userId: string, args: LocateArgs): Promise<CheckInResult> {
  const now = new Date();
  const today = dayKey(now, DAY_MS);

  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const base = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (!base) throw new Error("この地区にはまだタネがありません");
  await rememberPosition(c, userId, district, now);

  const picked = TANE_ITEM_BY_ID.get(base.seedItemId);
  if (!picked) throw new Error("このタネでもらえるものがありません");
  const isOwn = base.ownerId === userId;
  const result: CheckInResult = {
    status: "already",
    townName: base.townName,
    baseTypeId: base.baseTypeId,
    itemId: picked.itemId,
    quantity: null,
    gainedItems: 0,
    firstVisit: false,
    level: null,
    leveledUp: false,
    droppedSeeds: base.droppedSeeds ?? 0,
    stage: growthStage(base),
    rank: base.rank,
    water: base.water ?? 0,
    fruits: base.fruits ?? 0,
    seedsGained: "[]",
  };

  // 1日1回(自分の拠点は拠点の行に、ほかの人の拠点は訪問の記録に、最後に来た日を持つ)
  const visit = isOwn ? null : unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  const lastOn = isOwn ? base.lastOwnerVisitOn : visit?.lastReceivedOn;
  if (lastOn === today) {
    if (visit) unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return result;
  }

  // 実が残っていれば実を1個、無ければ水をやる
  const areaName = `${base.cityName} ${base.townName}`;
  if ((base.fruits ?? 0) > 0) {
    const left = await takeFruit(base.areaKey, userId, picked.itemId, areaName);
    if (left !== null) {
      result.status = "fruit";
      result.gainedItems = 1;
      result.fruits = left;
      result.quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }))?.quantity ?? 1;
      if (left === 0) {
        const rank = Math.min(MAX_RANK, base.rank + 1);
        await resetAfterFruits(base.areaKey, rank);
        result.rank = rank;
        result.water = 0;
        result.stage = 0;
      }
    }
  }
  if (result.status === "already") {
    // 実が無かった(または先に取りきられた)ので水をやる
    const watered = await addWater(base.areaKey, WATER_ONSITE, WATER_TO_RIPE, FRUITS_WHEN_RIPE);
    result.status = watered.ripened ? "ripened" : "watered";
    result.water = watered.water ?? 0;
    result.fruits = watered.ripened ? FRUITS_WHEN_RIPE : 0;
    result.stage = growthStage({ water: result.water, fruits: result.fruits });
  }

  if (isOwn) {
    unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today }));
    return result;
  }

  // ほかの人のタネに初めて来たときだけ、タネを1個もらえ、拠点にもタネが1個落ちる
  const seedsGained: SeedGain[] = [];
  if (!visit) {
    result.firstVisit = true;
    seedsGained.push({ itemId: base.seedItemId, count: SEEDS_PER_CHECKIN, reason: "checkin" });
    await addSeeds(c, userId, base.seedItemId, SEEDS_PER_CHECKIN);
    // 落とすのは DynamoDB の条件付きの書き込み(3個未満のときだけ増やす)。同時にチェックインしても数がずれない
    for (let i = 0; i < SEEDS_PER_CHECKIN; i++) await dropSeed(base.areaKey, DROPPED_SEEDS_MAX);
    result.droppedSeeds = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey }))?.droppedSeeds ?? 0;
  }
  unwrap(
    visit
      ? await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, lastReceivedOn: today, visitCount: visit.visitCount + 1 })
      : await c.models.GameTaneVisit.create({
          userId,
          areaKey: base.areaKey,
          firstVisitedAt: now.toISOString(),
          lastReceivedOn: today,
          visitCount: 1,
        })
  );
  // 初めての拠点なら、たずねた拠点の数が増えるのでレベルが上がることがある
  const granted = await grantLevelSeeds(c, player);
  seedsGained.push(...granted.gains);
  result.level = granted.level;
  result.leveledUp = granted.gains.length > 0;
  result.seedsGained = JSON.stringify(seedsGained);
  return result;
}

/** 自分のタネに遠くから水をやる。タネごとに1日1回で、効き目は現地の10分の1。実っている間はできない */
async function waterRemotely(c: DataClient, userId: string, areaKey: string) {
  const now = new Date();
  const today = dayKey(now, DAY_MS);
  const base = unwrap(await c.models.GameTaneBase.get({ areaKey }));
  if (!base || base.ownerId !== userId) throw new Error("自分のタネにだけ、遠くから水をやれます");
  if ((base.fruits ?? 0) > 0) throw new Error("実っているので、水はいりません。現地で実をもらってください");
  if (base.lastRemoteWaterOn === today) throw new Error("遠くからの水やりは、1つのタネに1日1回です");
  unwrap(await c.models.GameTaneBase.update({ areaKey, lastRemoteWaterOn: today }));
  await addWater(areaKey, WATER_REMOTE, WATER_TO_RIPE, FRUITS_WHEN_RIPE);
  return unwrap(await c.models.GameTaneBase.get({ areaKey }));
}
