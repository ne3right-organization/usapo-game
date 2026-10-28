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
import { PROTOTYPE_MAX_RANK, SEEDS_FROM_OWNER_VISIT, SEEDS_FROM_VISITOR, itemsUpToRank } from "../../../src/lib/game/chizuTane/courses";
import { jstDate } from "../../../src/lib/game/chizuTane/geo";

/**
 * いまいる地区のタネ(拠点)にチェックインする。
 * - ほかの人のタネ: 拠点ごとに1日1回(日本時間)、その拠点の今のランクまでのもののうち、まだ持っていないもの
 *   (全部持っていればどれか)を1つもらえる。初めて訪ねたタネなら、その種類のタネも1個もらえる。
 *   持ち主には、その種類のタネが2個増える。初めての拠点ならレベルが上がって、新しいタネをもらえることがある
 * - 自分のタネ: 1日1回、その種類のタネが1個増える(飾るものはもらえない)
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
      await addSeeds(c, userId, base.baseTypeId, SEEDS_FROM_OWNER_VISIT);
      unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today, lastSeedAt: now.toISOString() }));
      seedsGained.push({ baseTypeId: base.baseTypeId, count: SEEDS_FROM_OWNER_VISIT, reason: "owner" });
    }
    return { ...result, status: "own", seedsGained: JSON.stringify(seedsGained) };
  }

  const visit = unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  if (visit?.lastReceivedOn === today) {
    unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return { ...result, status: "already", seedsGained: JSON.stringify(seedsGained) };
  }

  // 初期試作では拠点が育たないが、ランクは拠点の行から読む(育つようになっても、ここはそのまま使える)
  const candidates = itemsUpToRank(base.baseTypeId, Math.min(base.rank, PROTOTYPE_MAX_RANK));
  if (candidates.length === 0) throw new Error("このタネでもらえるものがありません");
  const owned = await Promise.all(candidates.map((i) => c.models.GameTaneItem.get({ userId, itemId: i.itemId }).then(unwrap)));
  const notOwned = candidates.filter((_, i) => !owned[i]);
  const pool = notOwned.length > 0 ? notOwned : candidates;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const current = owned[candidates.indexOf(picked)];

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

  // 初めて訪ねたタネなら、その種類のタネを分けてもらえる(人から人へ広がる)
  if (!visit) {
    await addSeeds(c, userId, base.baseTypeId, 1);
    seedsGained.push({ baseTypeId: base.baseTypeId, count: 1, reason: "visit" });
  }
  // 持ち主のタネが増える(誰も来ないときに時間で増える分は、ここから数え直す)
  await addSeeds(c, base.ownerId, base.baseTypeId, SEEDS_FROM_VISITOR);
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
