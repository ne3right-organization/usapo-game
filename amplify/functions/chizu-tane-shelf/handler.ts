import { ConditionalCheckFailedException, DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-shelf";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import { addSeeds, requirePlayer } from "../shared/chizuTane";
import { notifyUsers } from "../shared/push";
import { TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { TANE_LOCAL_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/localItems";
import { DAY_MS_PRODUCTION, jstDate, slotKey } from "../../../src/lib/game/chizuTane/geo";
import { countPlaced, type GardenLayouts, type GardenObject } from "../../../src/lib/game/chizuTane/garden";

// おすそ分けの棚(2026-10-31)。持ち主が余ったタネや実を手元から棚に出しておき、持ち主が「農園を見せる」にしたフォロワー
// (ガーデンを見られる人と同じ)が、遠くから1人1日1個持っていく。持ち主はいちいち渡さなくてよい。
// - 棚に出すと手元から減る。実は、ガーデンに飾っている分は出せない。ご当地のタネは出せない(決まった3つの方法でしか増えない)
// - ご当地の実は、もう持っている人はもらえない(1つの品につき1人1個)
// - もらった実の産地は、持ち主がその実を最後に収穫した畑のものを引き継ぐ(集めたものに「谷塚一丁目のりんご」と出る)

const DAY_MS = Number(process.env.CHIZU_TANE_DAY_MS ?? DAY_MS_PRODUCTION);
const SHELF_TABLE = process.env.CHIZU_TANE_SHELF_TABLE ?? "";
const ddb = new DynamoDBClient({});

type ShelfView = Schema["TaneShelfView"]["type"];
type Kind = "seed" | "fruit";
type Args = { ownerId?: string | null; kind?: string; itemId?: string; count?: number };

export const handler: AppSyncResolverHandler<Args, ShelfView> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { ownerId, kind, itemId, count } = event.arguments;
  if (typeof kind === "string" && typeof itemId === "string") {
    if (!isKind(kind)) throw new Error("棚に出せるのはタネか実です");
    if (typeof ownerId === "string") return take(c, userId, ownerId, kind, itemId);
    if (typeof count === "number") return stock(c, userId, kind, itemId, count);
  }
  if (typeof ownerId === "string" && ownerId !== userId) {
    await requireViewable(c, userId, ownerId);
    return { items: JSON.stringify(await shelfItems(c, ownerId, true)), takenToday: await takenToday(c, userId, ownerId) };
  }
  return { items: JSON.stringify(await shelfItems(c, userId, false)), takenToday: false };
};

function isKind(value: string): value is Kind {
  return value === "seed" || value === "fruit";
}

/** 「1日1個」の区切り(本番は日本時間の日付。それ以外は試しやすいように、チェックインと同じ短い区切り) */
function dayKey(now: Date): string {
  return DAY_MS === DAY_MS_PRODUCTION ? jstDate(now) : slotKey(now, DAY_MS);
}

/** 持ち主が見る人に「農園を見せる」にしていて、見る人が持ち主をフォローしているか(ガーデンを見るのと同じ) */
async function requireViewable(c: DataClient, viewerId: string, ownerId: string): Promise<void> {
  const [share, follow] = await Promise.all([
    c.models.GameTaneShare.get({ ownerId, viewerId }),
    c.models.GameFollow.get({ followerId: viewerId, followeeId: ownerId }),
  ]);
  if (!unwrap(share) || !unwrap(follow)) throw new Error("この人の棚は見られません");
}

async function shelfItems(c: DataClient, ownerId: string, onlyStocked: boolean) {
  const rows: { kind: string; itemId: string; quantity: number }[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneShelf.list({ ownerId, nextToken });
    for (const r of unwrap(page)) if (!onlyStocked || r.quantity > 0) rows.push({ kind: r.kind, itemId: r.itemId, quantity: r.quantity });
    nextToken = page.nextToken;
  } while (nextToken);
  return rows;
}

async function takenToday(c: DataClient, takerId: string, ownerId: string): Promise<boolean> {
  return unwrap(await c.models.GameTaneShelfTake.get({ takerId, ownerId }))?.lastTakenOn === dayKey(new Date());
}

/**
 * 棚の数を delta だけ変える。減らすときは、残りが足りるときだけ(同時にもらおうとしても、先に書いた方だけが通る)。
 * 変えられなければ false
 */
async function changeShelf(ownerId: string, kind: Kind, itemId: string, delta: number): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: SHELF_TABLE,
        Key: { ownerId: { S: ownerId }, shelfKey: { S: `${kind}#${itemId}` } },
        // Amplify Data のモデルの行として読めるよう、__typename・createdAt・updatedAt も入れる
        UpdateExpression:
          "SET quantity = if_not_exists(quantity, :zero) + :delta, kind = :kind, itemId = :item, #tn = :tn, " +
          "createdAt = if_not_exists(createdAt, :now), updatedAt = :now",
        ...(delta < 0 ? { ConditionExpression: "quantity >= :need" } : {}),
        ExpressionAttributeNames: { "#tn": "__typename" },
        ExpressionAttributeValues: {
          ":zero": { N: "0" },
          ":delta": { N: String(delta) },
          ":kind": { S: kind },
          ":item": { S: itemId },
          ":tn": { S: "GameTaneShelf" },
          ":now": { S: now },
          ...(delta < 0 ? { ":need": { N: String(-delta) } } : {}),
        },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** a.json の値は二重に文字列化されて返ることがあるので、文字列である限り戻し続ける */
function parseJson<T = unknown>(value: unknown): T {
  let v = value;
  while (typeof v === "string") v = JSON.parse(v);
  return v as T;
}

/** ガーデン(全部)に飾っている、その実の数 */
async function placedInGardens(c: DataClient, userId: string, itemId: string): Promise<number> {
  const garden = unwrap(await c.models.GameTaneGarden.get({ userId }));
  if (!garden) return 0;
  const layouts = parseJson<GardenLayouts | null>(garden.layouts) ?? {};
  const all: GardenObject[] = [...parseJson<GardenObject[]>(garden.objects), ...Object.values(layouts).flatMap((objs) => objs ?? [])];
  return countPlaced(all).get(itemId) ?? 0;
}

/** 実を1個足す(無ければ作る) */
async function addFruit(c: DataClient, userId: string, itemId: string, delta: number, areaName: string | null): Promise<void> {
  const item = unwrap(await c.models.GameTaneItem.get({ userId, itemId }));
  unwrap(
    item
      ? await c.models.GameTaneItem.update({ userId, itemId, quantity: item.quantity + delta })
      : await c.models.GameTaneItem.create({ userId, itemId, quantity: delta, firstAcquiredAt: new Date().toISOString(), firstAreaName: areaName })
  );
}

/** 自分の棚に、手元のタネ・実を出す(count > 0)・手元に戻す(count < 0) */
async function stock(c: DataClient, userId: string, kind: Kind, itemId: string, count: number): Promise<ShelfView> {
  if (!Number.isInteger(count) || count === 0 || Math.abs(count) > 100) throw new Error("数の指定が正しくありません");
  await requirePlayer(c, userId);
  const item = TANE_ITEM_BY_ID.get(itemId);
  if (!item) throw new Error("そのものは棚に出せません");
  if (kind === "seed" && TANE_LOCAL_ITEM_BY_ID.has(itemId)) throw new Error("ご当地のタネは棚に出せません");

  if (count > 0) {
    // 手元から減らしてから棚に足す
    if (kind === "seed") {
      const held = unwrap(await c.models.GameTaneHeldSeed.get({ userId, itemId }));
      if (!held || held.quantity < count) throw new Error(`「${item.name}」のタネが足りません`);
      unwrap(await c.models.GameTaneHeldSeed.update({ userId, itemId, quantity: held.quantity - count }));
    } else {
      const owned = unwrap(await c.models.GameTaneItem.get({ userId, itemId }));
      const spare = (owned?.quantity ?? 0) - (await placedInGardens(c, userId, itemId));
      if (!owned || spare < count) throw new Error(`「${item.name}」が足りません（ガーデンに飾っている分は出せません）`);
      unwrap(await c.models.GameTaneItem.update({ userId, itemId, quantity: owned.quantity - count }));
    }
    await changeShelf(userId, kind, itemId, count);
  } else {
    // 棚から減らせたら(先にもらわれていなければ)、手元に戻す
    if (!(await changeShelf(userId, kind, itemId, count))) throw new Error("棚にその数がありません（先にもらわれたかもしれません）");
    if (kind === "seed") await addSeeds(c, userId, itemId, -count);
    else await addFruit(c, userId, itemId, -count, null);
  }
  return { items: JSON.stringify(await shelfItems(c, userId, false)), takenToday: false };
}

/** ほかの人の棚から1個もらう(1人が1つの棚から1日1個、早い者勝ち) */
async function take(c: DataClient, takerId: string, ownerId: string, kind: Kind, itemId: string): Promise<ShelfView> {
  if (takerId === ownerId) throw new Error("自分の棚からはもらえません（戻すことはできます）");
  await requireViewable(c, takerId, ownerId);
  await requirePlayer(c, takerId);
  const item = TANE_ITEM_BY_ID.get(itemId);
  if (!item) throw new Error("そのものはもらえません");
  const today = dayKey(new Date());
  const last = unwrap(await c.models.GameTaneShelfTake.get({ takerId, ownerId }));
  if (last?.lastTakenOn === today) throw new Error("この人の棚からは、1日1個までです");
  if (kind === "fruit" && TANE_LOCAL_ITEM_BY_ID.has(itemId) && unwrap(await c.models.GameTaneItem.get({ userId: takerId, itemId }))) {
    throw new Error("ご当地の実は1つの品につき1人1個です（もう持っています）");
  }
  if (!(await changeShelf(ownerId, kind, itemId, -1))) throw new Error("先にほかの人がもらっていきました");
  unwrap(
    last
      ? await c.models.GameTaneShelfTake.update({ takerId, ownerId, lastTakenOn: today })
      : await c.models.GameTaneShelfTake.create({ takerId, ownerId, lastTakenOn: today })
  );

  if (kind === "seed") {
    await addSeeds(c, takerId, itemId, 1);
  } else {
    // 産地は、持ち主がその実を最後に収穫した畑のもの(生産者もその畑の持ち主)
    const origin = await latestHarvest(c, ownerId, itemId);
    await addFruit(c, takerId, itemId, 1, origin ? `${origin.cityName} ${origin.townName}` : null);
    if (origin) {
      unwrap(
        await c.models.GameTaneHarvest.create({
          userId: takerId,
          harvestedAt: new Date().toISOString(),
          itemId,
          areaKey: origin.areaKey,
          prefName: origin.prefName,
          cityName: origin.cityName,
          townName: origin.townName,
          ripenedAt: origin.ripenedAt,
          ownerId: origin.ownerId,
        })
      );
    }
  }

  // 持ち主に知らせる(名前は、もらった人が持ち主に「農園を見せる」にしていて、持ち主がもらった人をフォローしているときだけ)
  const takerName = await takerNameFor(c, takerId, ownerId);
  const what = kind === "seed" ? `「${item.name}」のタネ` : `「${item.name}」`;
  await notifyUsers(c, [ownerId], {
    title: "おすそ分けの棚からもらわれました",
    body: `${takerName ? `${takerName}さん` : "誰か"}が、おすそ分けの棚から${what}を1個もらっていきました`,
    url: "/game/chizu-tane/garden",
    tag: `tane-shelf-${ownerId}`,
  });

  return { items: JSON.stringify(await shelfItems(c, ownerId, true)), takenToday: true };
}

async function latestHarvest(c: DataClient, userId: string, itemId: string) {
  let latest: NonNullable<Awaited<ReturnType<DataClient["models"]["GameTaneHarvest"]["get"]>>["data"]> | null = null;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneHarvest.list({ userId, nextToken });
    for (const h of unwrap(page)) if (h.itemId === itemId && (!latest || h.harvestedAt > latest.harvestedAt)) latest = h;
    nextToken = page.nextToken;
  } while (nextToken);
  return latest;
}

async function takerNameFor(c: DataClient, takerId: string, ownerId: string): Promise<string | null> {
  const [share, follow] = await Promise.all([
    c.models.GameTaneShare.get({ ownerId: takerId, viewerId: ownerId }),
    c.models.GameFollow.get({ followerId: ownerId, followeeId: takerId }),
  ]);
  if (!unwrap(share) || !unwrap(follow)) return null;
  return unwrap(await c.models.GameProfile.get({ userId: takerId }))?.nickname || null;
}
