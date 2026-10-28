import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addSeeds,
  assertNotTooFast,
  dropSeed,
  grantLevelSeeds,
  locateTownDistrict,
  rememberPosition,
  requirePlayer,
  waterBase,
  type SeedGain,
} from "../shared/chizuTane";
import { DROPPED_SEEDS_MAX, SEEDS_PER_CHECKIN, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { SPROUT_MS_PRODUCTION, formatRemaining, jstDate, msUntilSprout } from "../../../src/lib/game/chizuTane/geo";
import { HARVEST_ITEMS, HARVEST_SEEDS, MAX_RANK, RIPE_STAGE, growthStage } from "../../../src/lib/game/chizuTane/growth";

// 「1日」の長さ。芽が出るまでの時間で、育ちの1段階もこの長さ(本番は24時間、それ以外は5分)
const DAY_MS = Number(process.env.CHIZU_TANE_SPROUT_MS ?? SPROUT_MS_PRODUCTION);

/** もの(梨の木など)を count 個増やす。増やしたあとに持っている数を返す */
async function addItem(c: DataClient, userId: string, itemId: string, count: number, areaName: string, now: Date): Promise<number> {
  const current = unwrap(await c.models.GameTaneItem.get({ userId, itemId }));
  const item = unwrap(
    current
      ? await c.models.GameTaneItem.update({ userId, itemId, quantity: current.quantity + count })
      : await c.models.GameTaneItem.create({ userId, itemId, quantity: count, firstAcquiredAt: now.toISOString(), firstAreaName: areaName })
  );
  return item?.quantity ?? count;
}

/**
 * いまいる地区のタネ(拠点)にチェックインする。拠点ごとに1人1日1回(日本時間)。芽が出るまで(まいてから1日)は誰もできない。
 * - ほかの人のタネ: まかれていたタネ(梨の木のタネなど)を1個もらえ、拠点にもタネが1個落ちる(3個まで。誰でも拾える)。
 *   もの(実)はもらえない。ものは自分でまいて育てたタネを収穫したときだけ手に入る(集めたもの・タネニワに飾れるもの)。
 *   拠点は1段階育つ(水やりと同じ)。初めての拠点なら、たずねた拠点の数が増えるのでレベルが上がることがある
 * - 自分のタネ: 実っていなければ水やり(1段階育つだけで、何ももらえない)。実っていれば収穫で、もの3つとタネ1個がもらえ、
 *   芽に戻ってランクが1つ上がる。自分のタネは訪問の記録に残さず、レベルにも数えない。タネも落ちない
 *   (自分で落として自分で拾えると、毎日タネが増えてしまうため)
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
  const untilSprout = msUntilSprout(base.plantedAt, now, DAY_MS);
  if (untilSprout > 0) throw new Error(`まだ芽が出ていません（${formatRemaining(untilSprout)}で芽が出ます）`);
  await rememberPosition(c, userId, district, now);

  const isOwn = base.ownerId === userId;
  const stageBefore = growthStage(base, now, DAY_MS);
  const result = {
    townName: base.townName,
    baseTypeId: base.baseTypeId,
    itemId: null as string | null,
    quantity: null as number | null,
    gainedItems: null as number | null,
    level: null as number | null,
    leveledUp: false,
    droppedSeeds: base.droppedSeeds ?? 0,
    stage: stageBefore,
    rank: base.rank,
    seedsGained: "[]",
  };

  // 1日1回(自分の拠点は拠点の行に、ほかの人の拠点は訪問の記録に、最後に来た日を持つ)
  const visit = isOwn ? null : unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  const lastOn = isOwn ? base.lastOwnerVisitOn : visit?.lastReceivedOn;
  if (lastOn === today) {
    if (visit) unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return { ...result, status: "already" };
  }

  const picked = TANE_ITEM_BY_ID.get(base.seedItemId);
  if (!picked) throw new Error("このタネでもらえるものがありません");
  const areaName = `${base.cityName} ${base.townName}`;

  if (isOwn) {
    if (stageBefore < RIPE_STAGE) {
      // 水やり: 1段階育つだけ
      await waterBase(base.areaKey);
      unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today }));
      return { ...result, status: "watered", stage: Math.min(RIPE_STAGE, stageBefore + 1) };
    }
    // 収穫: もの3つとタネ1個。芽に戻ってランクが上がる
    const quantity = await addItem(c, userId, picked.itemId, HARVEST_ITEMS, areaName, now);
    await addSeeds(c, userId, base.seedItemId, HARVEST_SEEDS);
    const rank = Math.min(MAX_RANK, base.rank + 1);
    unwrap(
      await c.models.GameTaneBase.update({
        areaKey: base.areaKey,
        lastOwnerVisitOn: today,
        growFrom: now.toISOString(),
        waterCount: 0,
        rank,
      })
    );
    const seedsGained: SeedGain[] = [{ itemId: base.seedItemId, count: HARVEST_SEEDS, reason: "harvest" }];
    return {
      ...result,
      status: "harvested",
      itemId: picked.itemId,
      quantity,
      gainedItems: HARVEST_ITEMS,
      stage: 0,
      rank,
      seedsGained: JSON.stringify(seedsGained),
    };
  }

  // ほかの人のタネ: タネ1個(ものは無し)。拠点にもタネが1個落ち、1段階育つ
  const seedsGained: SeedGain[] = [{ itemId: base.seedItemId, count: SEEDS_PER_CHECKIN, reason: "checkin" }];
  await addSeeds(c, userId, base.seedItemId, SEEDS_PER_CHECKIN);
  // 落とすのは DynamoDB の条件付きの書き込み(3個未満のときだけ増やす)。同時にチェックインしても数がずれない
  for (let i = 0; i < SEEDS_PER_CHECKIN; i++) await dropSeed(base.areaKey, DROPPED_SEEDS_MAX);
  await waterBase(base.areaKey);
  const dropped = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey }))?.droppedSeeds ?? 0;

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

  return {
    ...result,
    status: "received",
    itemId: picked.itemId,
    gainedItems: 0,
    level: granted.level,
    leveledUp: granted.gains.length > 0,
    droppedSeeds: dropped,
    stage: Math.min(RIPE_STAGE, stageBefore + 1),
    seedsGained: JSON.stringify(seedsGained),
  };
};
