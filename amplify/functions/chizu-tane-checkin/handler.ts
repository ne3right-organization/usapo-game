import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap } from "../shared/dataClient";
import {
  addSeeds,
  assertNotTooFast,
  dropSeed,
  grantLevelSeeds,
  locateTownDistrict,
  rememberPosition,
  requirePlayer,
  type SeedGain,
} from "../shared/chizuTane";
import { DROPPED_SEEDS_MAX, SEEDS_PER_CHECKIN, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { jstDate } from "../../../src/lib/game/chizuTane/geo";

/**
 * いまいる地区のタネ(拠点)にチェックインする。自分の拠点でもほかの人の拠点でも同じルールで、拠点ごとに1日1回(日本時間)、
 * まかれたタネのもの(梨の木など)と、そのもののタネを1個もらえ、拠点にもタネが1個落ちる(3個まで。誰でも拾える)。
 * ほかの人の拠点に初めてチェックインしたときは、たずねた拠点の数が増えるので、レベルが上がって新しいタネをもらえることがある
 * (自分の拠点は訪問の記録に残さず、レベルにも数えない)
 */
export const handler: Schema["checkInTaneBase"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const now = new Date();
  const today = jstDate(now);

  const district = await locateTownDistrict(event.arguments);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const base = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (!base) throw new Error("この地区にはまだタネがありません");
  await rememberPosition(c, userId, district, now);

  const isOwn = base.ownerId === userId;
  const result = {
    townName: base.townName,
    baseTypeId: base.baseTypeId,
    itemId: null as string | null,
    quantity: null as number | null,
    level: null as number | null,
    leveledUp: false,
    droppedSeeds: base.droppedSeeds ?? 0,
  };

  // 1日1回(自分の拠点は拠点の行に、ほかの人の拠点は訪問の記録に、最後にもらった日を持つ)
  const visit = isOwn ? null : unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  const lastOn = isOwn ? base.lastOwnerVisitOn : visit?.lastReceivedOn;
  if (lastOn === today) {
    if (visit) unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return { ...result, status: "already", seedsGained: "[]" };
  }

  const picked = TANE_ITEM_BY_ID.get(base.seedItemId);
  if (!picked) throw new Error("このタネでもらえるものがありません");
  const current = unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }));
  const item = unwrap(
    current
      ? await c.models.GameTaneItem.update({ userId, itemId: picked.itemId, quantity: current.quantity + 1 })
      : await c.models.GameTaneItem.create({
          userId,
          itemId: picked.itemId,
          quantity: 1,
          firstAcquiredAt: now.toISOString(),
          firstAreaName: `${base.cityName} ${base.townName}`,
        })
  );

  // タネを1個もらい、拠点にも1個落ちる(3個まで)
  const seedsGained: SeedGain[] = [{ itemId: base.seedItemId, count: SEEDS_PER_CHECKIN, reason: "checkin" }];
  await addSeeds(c, userId, base.seedItemId, SEEDS_PER_CHECKIN);
  // 落とすのは DynamoDB の条件付きの書き込み(3個未満のときだけ増やす)。同時にチェックインしても数がずれない
  for (let i = 0; i < SEEDS_PER_CHECKIN; i++) await dropSeed(base.areaKey, DROPPED_SEEDS_MAX);
  if (isOwn) unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today }));
  const dropped = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey }))?.droppedSeeds ?? 0;

  let level: number | null = null;
  let leveledUp = false;
  if (!isOwn) {
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
    level = granted.level;
    leveledUp = granted.gains.length > 0;
    seedsGained.push(...granted.gains);
  }

  return {
    ...result,
    status: "received",
    itemId: picked.itemId,
    quantity: item?.quantity ?? 1,
    level,
    leveledUp,
    droppedSeeds: dropped,
    seedsGained: JSON.stringify(seedsGained),
  };
};
