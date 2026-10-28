import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap } from "../shared/dataClient";
import {
  addSeeds,
  assertNotTooFast,
  grantLevelSeeds,
  locateTownDistrict,
  rememberPosition,
  requirePlayer,
  type SeedGain,
} from "../shared/chizuTane";
import { SEEDS_FROM_OWNER_VISIT, SEEDS_FROM_VISITOR, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { jstDate } from "../../../src/lib/game/chizuTane/geo";

/**
 * いまいる地区のタネ(拠点)にチェックインする。
 * - ほかの人のタネ: 拠点ごとに1日1回(日本時間)、まかれたタネのもの(梨の木など)を1つもらえる。
 *   初めて訪ねたタネなら、そのもののタネも1個もらえる。持ち主には、そのもののタネが2個増える。
 *   初めての拠点ならレベルが上がって、新しいタネをもらえることがある
 * - 自分のタネ: 1日1回、そのもののタネが1個増える(飾るものはもらえない)
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

  const seedsGained: SeedGain[] = [];
  const result = {
    townName: base.townName,
    baseTypeId: base.baseTypeId,
    itemId: null as string | null,
    quantity: null as number | null,
    level: null as number | null,
    leveledUp: false,
  };

  if (base.ownerId === userId) {
    if (base.lastOwnerVisitOn !== today) {
      await addSeeds(c, userId, base.seedItemId, SEEDS_FROM_OWNER_VISIT);
      unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today, lastSeedAt: now.toISOString() }));
      seedsGained.push({ itemId: base.seedItemId, count: SEEDS_FROM_OWNER_VISIT, reason: "owner" });
    }
    return { ...result, status: "own", seedsGained: JSON.stringify(seedsGained) };
  }

  const visit = unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  if (visit?.lastReceivedOn === today) {
    unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return { ...result, status: "already", seedsGained: JSON.stringify(seedsGained) };
  }

  // もらえるのは、まかれたタネのもの(初期試作では拠点が育たないので、これだけ)
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

  // 初めて訪ねたタネなら、そのもののタネを分けてもらえる(人から人へ広がる)
  if (!visit) {
    await addSeeds(c, userId, base.seedItemId, 1);
    seedsGained.push({ itemId: base.seedItemId, count: 1, reason: "visit" });
  }
  // 持ち主のタネが増える(誰も来ないときに時間で増える分は、ここから数え直す)
  await addSeeds(c, base.ownerId, base.seedItemId, SEEDS_FROM_VISITOR);
  unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastSeedAt: now.toISOString() }));

  // 初めての拠点なら、たずねた拠点の数が増えるのでレベルが上がることがある
  const { level, gains } = await grantLevelSeeds(c, player);
  seedsGained.push(...gains);

  return {
    ...result,
    status: "received",
    itemId: picked.itemId,
    quantity: item?.quantity ?? 1,
    level,
    leveledUp: gains.length > 0,
    seedsGained: JSON.stringify(seedsGained),
  };
};
