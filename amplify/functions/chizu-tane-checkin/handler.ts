import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap } from "../shared/dataClient";
import { assertNotTooFast, locateTownDistrict, rememberPosition, requirePlayer } from "../shared/chizuTane";
import { PROTOTYPE_MAX_RANK, itemsUpToRank } from "../../../src/lib/game/chizuTane/courses";
import { jstDate } from "../../../src/lib/game/chizuTane/geo";

/**
 * いまいる地区のタネ(拠点)にチェックインする。他の人のタネなら、拠点ごとに1日1回(日本時間)、
 * その拠点の今のランクまでのもののうち、まだ持っていないもの(全部持っていればどれか)を1つもらえる。
 * 自分のタネにはチェックインできるが、もらえない
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

  const result = { townName: base.townName, baseTypeId: base.baseTypeId, itemId: null as string | null, quantity: null as number | null };
  if (base.ownerId === userId) return { ...result, status: "own" };

  const visit = unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  if (visit?.lastReceivedOn === today) {
    unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return { ...result, status: "already" };
  }

  // 初期試作では拠点が育たないが、ランクは拠点の行から読む(育つようになっても、ここはそのまま使える)
  const candidates = itemsUpToRank(base.baseTypeId, Math.min(base.rank, PROTOTYPE_MAX_RANK));
  if (candidates.length === 0) throw new Error("このタネでもらえるものがありません");
  const owned = await Promise.all(candidates.map((i) => c.models.GameTaneItem.get({ userId, itemId: i.itemId }).then(unwrap)));
  const notOwned = candidates.filter((_, i) => !owned[i]);
  const pool = notOwned.length > 0 ? notOwned : candidates;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const current = owned[candidates.indexOf(picked)];

  const areaName = `${base.cityName} ${base.townName}`;
  const item = unwrap(
    current
      ? await c.models.GameTaneItem.update({ userId, itemId: picked.itemId, quantity: current.quantity + 1 })
      : await c.models.GameTaneItem.create({
          userId,
          itemId: picked.itemId,
          quantity: 1,
          firstAcquiredAt: now.toISOString(),
          firstAreaName: areaName,
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
  return { ...result, status: "received", itemId: picked.itemId, quantity: item?.quantity ?? 1 };
};
