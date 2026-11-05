import type { AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-admin";
import { dataClient, unwrap } from "../shared/dataClient";
import { TANE_LOCAL_ITEM_BY_ID, isLocalBaseTypeId } from "../../../src/lib/game/chizuTane/localItems";

// 管理画面の「ご当地の実の状況」(/admin/chizu-tane/local。adminTaneLocalStatus)と「遊んでいる人と畑」(/admin/chizu-tane/fields。adminTaneFieldStatus)。
// 「ご当地の実の状況」は、ご当地の畑・市場に並んでいる実・ご当地のタネをもらった記録・ご当地の実を持っている人の数を
// まとめて返す。利用者のデータ(ニックネーム・畑の地区)を含むので、スキーマで Cognito の admin グループの人だけが呼べるようにしている。
// 試作の規模なので毎回全件を読む

async function listAll<T>(fetchPage: (nextToken: string | null | undefined) => Promise<{ data: T[]; nextToken?: string | null; errors?: readonly { message: string }[] }>) {
  const rows: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await fetchPage(nextToken);
    rows.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return rows;
}

export const handler: AppSyncResolverHandler<{ fields?: boolean }, string> = async (event) => {
  if (event.arguments.fields) return fieldStatus();
  const c = await dataClient(env);
  const [bases, ownerships, listings, grants, items, profiles] = await Promise.all([
    listAll((nextToken) => c.models.GameTaneBase.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneOwnership.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneMarketLocal.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneLocalGrant.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneItem.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameProfile.list({ limit: 1000, nextToken })),
  ]);
  const nicknames = new Map(profiles.map((p) => [p.userId, p.nickname ?? ""]));
  const ownerOf = new Map(ownerships.filter((o) => !o.releasedAt).map((o) => [o.areaKey, o.ownerId]));
  const user = (id: string | undefined) => ({ userId: id ?? "", nickname: (id && nicknames.get(id)) || "" });

  const fields = bases
    .filter((b) => isLocalBaseTypeId(b.baseTypeId))
    .map((b) => ({
      areaKey: b.areaKey,
      place: `${b.prefName} ${b.cityName} ${b.townName}`,
      itemId: b.seedItemId,
      owner: user(ownerOf.get(b.areaKey)),
      plantedAt: b.plantedAt,
      water: b.water ?? 0,
      fruits: b.fruits ?? 0,
      ripenedAt: b.ripenedAt ?? null,
      lastWateredAt: b.lastWateredAt ?? null,
    }));
  const market = listings.map((l) => ({ itemId: l.itemId, localRank: l.localRank, producer: user(l.producerId), leftover: l.leftover ?? 0, updatedAt: l.updatedAt }));
  const localGrants = grants.map((g) => ({
    user: user(g.userId),
    prefCode: g.prefCode,
    course: g.course,
    firstAt: g.firstAt,
    secondAt: g.secondAt ?? null,
    thirdAt: g.thirdAt ?? null,
  }));
  // ご当地の実ごとの、持っている人(数が0でも、一度手に入れた人)と、いま持っている数の合計
  const holders = new Map<string, { itemId: string; collectors: number; quantity: number }>();
  for (const i of items) {
    if (!TANE_LOCAL_ITEM_BY_ID.has(i.itemId)) continue;
    const row = holders.get(i.itemId) ?? { itemId: i.itemId, collectors: 0, quantity: 0 };
    row.collectors++;
    row.quantity += i.quantity;
    holders.set(i.itemId, row);
  }
  return JSON.stringify({ fields, market, grants: localGrants, holders: [...holders.values()], generatedAt: new Date().toISOString() });
};

/**
 * 遊んでいる人と畑(ゲームが進んでいるかの確認用)。遊んでいる人ごとのレベル・たずねた数・手伝った数・収穫した数と、
 * いまある畑(普通の畑もご当地の畑も)を持ち主つきで返す。まとめ方と、次に起きること(枯れる・宅急便など)の計算は画面で行う
 */
async function fieldStatus(): Promise<string> {
  const c = await dataClient(env);
  const [players, bases, ownerships, visits, officialVisits, harvests, profiles] = await Promise.all([
    listAll((nextToken) => c.models.GameTanePlayer.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneBase.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneOwnership.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneVisit.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneOfficialVisit.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameTaneHarvest.list({ limit: 1000, nextToken })),
    listAll((nextToken) => c.models.GameProfile.list({ limit: 1000, nextToken })),
  ]);
  const nicknames = new Map(profiles.map((p) => [p.userId, p.nickname ?? ""]));
  const ownerOf = new Map(ownerships.filter((o) => !o.releasedAt).map((o) => [o.areaKey, o.ownerId]));
  const countBy = (ids: string[]) => ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>());
  const visitCount = countBy(visits.map((v) => v.userId));
  const officialCount = countBy(officialVisits.map((v) => v.userId));
  const harvestCount = countBy(harvests.map((h) => h.userId));
  // 開拓した地区(手放した畑も含む)
  const openedCount = countBy(ownerships.map((o) => o.ownerId));

  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    players: players.map((p) => ({
      userId: p.userId,
      nickname: nicknames.get(p.userId) ?? "",
      course: p.course,
      level: p.grantedLevel ?? 1,
      visits: visitCount.get(p.userId) ?? 0,
      official: officialCount.get(p.userId) ?? 0,
      helps: p.helpCount ?? 0,
      harvests: harvestCount.get(p.userId) ?? 0,
      opened: openedCount.get(p.userId) ?? 0,
      lastMovedAt: p.lastMovedAt ?? null,
      startedAt: p.createdAt,
    })),
    fields: bases.map((b) => ({
      areaKey: b.areaKey,
      ownerId: ownerOf.get(b.areaKey) ?? "",
      place: `${b.prefName} ${b.cityName} ${b.townName}`,
      baseTypeId: b.baseTypeId,
      seedItemId: b.seedItemId,
      rank: b.rank,
      water: b.water ?? 0,
      fruits: b.fruits ?? 0,
      plantedAt: b.plantedAt,
      ripenedAt: b.ripenedAt ?? null,
      waitingSince: b.waitingSince ?? null,
      lastWateredAt: b.lastWateredAt ?? null,
    })),
  });
}
