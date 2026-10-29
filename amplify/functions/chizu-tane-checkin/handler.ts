import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addWater,
  assertNotTooFast,
  baseOwnerId,
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
import { DROPPED_SEEDS_MAX, SEEDS_PER_CHECKIN, TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { notifyUsers } from "../shared/push";
import { DAY_MS_PRODUCTION, slotKey } from "../../../src/lib/game/chizuTane/geo";
import {
  fruitsWhenRipe,
  MAX_RANK,
  WATER_ONSITE,
  WATER_REMOTE,
  WATER_TO_RIPE,
  growthStage,
} from "../../../src/lib/game/chizuTane/growth";

// 区切りの長さ。チェックイン・遠くからの水やりは1つの区切りに1回(本番は朝・昼・夜、それ以外は5分ごと)
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
 * 現地のチェックイン。持ち主でもほかの人でも同じで、1人1つの時間帯(朝・昼・夜)に1回(dev は5分ごと)。まいた直後からできる。
 * - 実が残っていれば、実を1個もらう(早い者勝ち)。最後の1個なら芽に戻り、ランクが1つ上がる
 * - 実っていなければ、水をやる(現地は10)。たまったら実って、実ができる(ランク×10個。実らせた人は、そのまま1個もらう)
 * - ほかの人のタネに初めてチェックインしたときだけ、拠点にタネが1個落ちる(3個まで。直接はもらわず、拾うかどうかは選べる)。
 *   たずねた拠点の数が増えるので、レベルが上がることもある(自分のタネは訪問の記録に残さず、レベルにも数えない)
 */
async function checkIn(c: DataClient, userId: string, args: LocateArgs): Promise<CheckInResult> {
  const now = new Date();
  const today = slotKey(now, DAY_MS);

  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const base = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (!base) throw new Error("この地区にはまだタネがありません");
  await rememberPosition(c, userId, district, now);

  const picked = TANE_ITEM_BY_ID.get(base.seedItemId);
  if (!picked) throw new Error("このタネでもらえるものがありません");
  const ownerId = await baseOwnerId(c, base.areaKey);
  const isOwn = ownerId === userId;
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

  // 1つの時間帯に1回(自分の拠点は拠点の行に、ほかの人の拠点は訪問の記録に、最後に来た時間帯を持つ)
  const visit = isOwn ? null : unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  const lastOn = isOwn ? base.lastOwnerVisitOn : visit?.lastReceivedOn;
  if (lastOn === today) {
    if (visit) unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return result;
  }

  // 実が残っていれば実を1個、無ければ水をやる
  if ((base.fruits ?? 0) > 0) {
    const left = await takeFruit({ ...base, ownerId }, userId, picked.itemId);
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
    const watered = await addWater(base.areaKey, WATER_ONSITE, WATER_TO_RIPE, fruitsWhenRipe(base.rank));
    result.status = watered.ripened ? "ripened" : "watered";
    result.water = watered.water ?? 0;
    result.fruits = watered.ripened ? fruitsWhenRipe(base.rank) : 0;
    result.stage = growthStage({ water: result.water, fruits: result.fruits });
    // 自分の水で実らせたら、そのまま実を1個もらう(実らせた人が次の日まで待たなくてよいように)
    if (watered.ripened) {
      const left = await takeFruit({ ...base, ownerId, ripenedAt: new Date().toISOString() }, userId, picked.itemId);
      if (left !== null) {
        result.gainedItems = 1;
        result.fruits = left;
        result.quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }))?.quantity ?? 1;
      }
    }
  }

  if (isOwn) {
    unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today }));
    return result;
  }

  // 持ち主に知らせる(実ったときは「実った」だけ。1つのタネの通知は、新しいものが古いものを置き換える)
  const place = `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "タネ"}`;
  const notice =
    result.status === "ripened"
      ? { title: "タネが実りました", body: `${place}が実りました！ 実が${result.fruits}個なっています` }
      : result.status === "fruit"
        ? { title: "実が収穫されました", body: `誰かが${place}に来て、実を1個収穫しました（のこり${result.fruits}個）` }
        : { title: "タネに誰かが来ました", body: `誰かが${place}に来て、水をやってくれました` };
  await notifyUsers(c, [ownerId], { ...notice, url: "/game/chizu-tane", tag: `tane-${base.areaKey}` });

  // ほかの人のタネに初めて来たときだけ、拠点にタネが1個落ちる(直接はもらわない。要らなければ拾わずに置いていける)
  const seedsGained: SeedGain[] = [];
  if (!visit) {
    result.firstVisit = true;
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

/** 自分のタネに遠くから水をやる。タネごとに1つの時間帯(朝・昼・夜)に1回で、効き目は現地の10分の1。実っている間はできない */
async function waterRemotely(c: DataClient, userId: string, areaKey: string) {
  const now = new Date();
  const today = slotKey(now, DAY_MS);
  const base = unwrap(await c.models.GameTaneBase.get({ areaKey }));
  const own = unwrap(await c.models.GameTaneOwnership.get({ ownerId: userId, areaKey }));
  if (!base || !own) throw new Error("自分のタネにだけ、遠くから水をやれます");
  if ((base.fruits ?? 0) > 0) throw new Error("実っているので、水はいりません。現地で実をもらってください");
  if (base.lastRemoteWaterOn === today) throw new Error("遠くからの水やりは、1つのタネに朝・昼・夜それぞれ1回です");
  unwrap(await c.models.GameTaneBase.update({ areaKey, lastRemoteWaterOn: today }));
  await addWater(areaKey, WATER_REMOTE, WATER_TO_RIPE, fruitsWhenRipe(base.rank));
  return unwrap(await c.models.GameTaneBase.get({ areaKey }));
}
