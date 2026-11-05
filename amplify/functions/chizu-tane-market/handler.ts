import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-market";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addSeeds,
  grantNextLocalSeed,
  hasLocalFruitFrom,
  localFruitSourceKey,
  marketLeftover,
  placedInGardens,
  requirePlayer,
  spendFruits,
  swapLocalFruits,
} from "../shared/chizuTane";
import { notifyUsers } from "../shared/push";
import { FRUITS_PER_EXCHANGE_SEED, TANE_ITEM_BY_ID, exchangeSeedFor } from "../../../src/lib/game/chizuTane/courses";
import { TANE_LOCAL_ITEM_BY_ID, TANE_LOCAL_PREFS, nextLocalItem, type TaneLocalItem } from "../../../src/lib/game/chizuTane/localItems";

// うさぽ農園の市場(2026-11-05)。
// - 実をタネと交換する(exchangeTaneFruits): 同じ実 FRUITS_PER_EXCHANGE_SEED 個を、同じコースの1つ上のレベルの種類の、同じ番号のタネ1個と
//   (みかんの木 → チューリップ。対応は courses.ts の exchangeSeedFor)。いまの環境の上限レベルの種類の実と、ご当地の実は交換できない。
//   ガーデンに飾っている分は使えない。実を減らしてからタネを足す(実は条件付きで減らすので、同時に押しても数がずれない)
// - ご当地の実の取り替え(listTaneLocalMarket・exchangeTaneLocalFruit): 市場には、実って1か月で撤去したご当地の畑の残りの実が、
//   生産者の実として並ぶ(chizu-tane-sweep)。生産者どうしで、市場にある自分の実1個と、同じ何個目(現地・お土産・記念品)のほかの人の実1個を
//   取り替える(お互いに相手の実が1個届く)。使えるのは自分が生産者の実だけ(もらった実は出せない)。生産者とものの組みにつき1人1個の決まりはそのまま。
//   市場の自分の実が全部渡ると、次のご当地のタネが届く。どこの畑の実か(生産者・地区)は生活圏の手がかりになるので、一覧には出さない
// Amplify Gen2 の関数には event.info が来ないので、引数で見分ける

type ExchangeResult = Schema["TaneExchangeResult"]["type"];
type MarketItem = Schema["TaneLocalMarketItem"]["type"];
type TradeResult = Schema["TaneLocalTradeResult"]["type"];
type Args = { itemId?: string; listLocal?: boolean; giveItemId?: string; takeItemId?: string };

export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  await requirePlayer(c, userId);
  const { itemId, listLocal, giveItemId, takeItemId } = event.arguments;
  if (typeof giveItemId === "string" && typeof takeItemId === "string") return tradeLocal(c, userId, giveItemId, takeItemId);
  if (listLocal) return listLocalMarket(c, userId);
  if (typeof itemId === "string") return exchangeFruits(c, userId, itemId);
  throw new Error("市場の使い方が正しくありません");
};

async function exchangeFruits(c: DataClient, userId: string, itemId: string): Promise<ExchangeResult> {
  const fruit = TANE_ITEM_BY_ID.get(itemId);
  const seed = exchangeSeedFor(itemId);
  if (!fruit || !seed) throw new Error("この実はタネと交換できません");
  const placed = await placedInGardens(c, userId, itemId);
  if (!(await spendFruits(userId, itemId, FRUITS_PER_EXCHANGE_SEED, placed))) {
    throw new Error(`「${fruit.name}」が${FRUITS_PER_EXCHANGE_SEED}個ありません（ガーデンに飾っている分は使えません）`);
  }
  await addSeeds(c, userId, seed.itemId, 1);

  const [owned, held] = await Promise.all([
    c.models.GameTaneItem.get({ userId, itemId }),
    c.models.GameTaneHeldSeed.get({ userId, itemId: seed.itemId }),
  ]);
  return { seedItemId: seed.itemId, fruitsLeft: unwrap(owned)?.quantity ?? 0, seedsHeld: unwrap(held)?.quantity ?? 1 };
}

// ─── ご当地の実の取り替え ─────────────────────────────────────────────

type Listing = NonNullable<Awaited<ReturnType<DataClient["models"]["GameTaneMarketLocal"]["get"]>>["data"]>;

const prefNameOf = (item: TaneLocalItem) => TANE_LOCAL_PREFS.find((p) => p.prefCode === item.local)?.prefName ?? "";

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

/** 並んでいる実の行(残りのあるもの。試作の規模なので毎回全件を読む) */
async function listListings(c: DataClient): Promise<Listing[]> {
  const rows = await listAll((nextToken) => c.models.GameTaneMarketLocal.list({ limit: 1000, nextToken }));
  return rows.filter((l) => (l.leftover ?? 0) > 0);
}

/**
 * その人が、もうもらったご当地の実(生産者#もの)。もらった記録と、記録の無い 2026-11-02 より前の分は収穫の記録で見る
 * (shared/chizuTane.ts の hasLocalFruitFrom と同じ考え方を、まとめて引く)
 */
async function receivedKeys(c: DataClient, userId: string): Promise<Set<string>> {
  const [fruits, harvests] = await Promise.all([
    listAll((nextToken) => c.models.GameTaneLocalFruit.list({ userId, nextToken })),
    listAll((nextToken) => c.models.GameTaneHarvest.list({ userId, nextToken })),
  ]);
  const keys = new Set(fruits.map((f) => f.sourceKey));
  for (const h of harvests) if (TANE_LOCAL_ITEM_BY_ID.has(h.itemId)) keys.add(localFruitSourceKey(h.ownerId, h.itemId));
  return keys;
}

/**
 * 並んでいるご当地の実を、ものごとにまとめる(生産者は出さない)。
 * blockedGives: そのものを並べている相手が全員、自分のその実をもう持っていて、取り替えに出せない自分の実(画面で、選んだ実では取り替えられないと出す)
 */
async function listLocalMarket(c: DataClient, userId: string): Promise<MarketItem[]> {
  const [listings, received] = await Promise.all([listListings(c), receivedKeys(c, userId)]);
  const byItem = new Map<string, MarketItem>();
  const partnersOf = new Map<string, string[]>(); // もの → もらえる相手
  for (const l of listings) {
    const n = l.leftover ?? 0;
    const row = byItem.get(l.itemId) ?? { itemId: l.itemId, localRank: l.localRank, mine: 0, others: 0, available: 0, blockedGives: [] };
    if (l.producerId === userId) row.mine += n;
    else {
      row.others += n;
      if (!received.has(localFruitSourceKey(l.producerId, l.itemId))) {
        row.available += n;
        partnersOf.set(l.itemId, [...(partnersOf.get(l.itemId) ?? []), l.producerId]);
      }
    }
    byItem.set(l.itemId, row);
  }

  // 相手が自分の実をもう持っているか(相手ごとに1回だけ読む)
  const gives = [...byItem.values()].filter((r) => r.mine > 0);
  if (gives.length > 0) {
    const partners = [...new Set([...partnersOf.values()].flat())];
    const keysOf = new Map(await Promise.all(partners.map(async (p) => [p, await receivedKeys(c, p)] as const)));
    for (const row of byItem.values()) {
      const ps = partnersOf.get(row.itemId) ?? [];
      if (ps.length === 0) continue;
      row.blockedGives = gives
        .filter((g) => g.localRank === row.localRank && ps.every((p) => keysOf.get(p)?.has(localFruitSourceKey(userId, g.itemId))))
        .map((g) => g.itemId);
    }
  }
  return [...byItem.values()];
}

/**
 * 市場にある自分の実1個(giveItemId)と、同じ何個目のほかの人の実1個(takeItemId)を取り替える。お互いに相手の実が1個届く。
 * 相手の生産者は選べない(残りの多い人から)。自分がその人のその実をもう持っている・相手が自分のその実をもう持っている組みは取り替えられない
 * (生産者とものの組みにつき1人1個)。取り替えで市場の実がなくなったら、その生産者に次のご当地のタネが届く
 */
async function tradeLocal(c: DataClient, userId: string, giveItemId: string, takeItemId: string): Promise<TradeResult> {
  const giveItem = TANE_LOCAL_ITEM_BY_ID.get(giveItemId);
  const takeItem = TANE_LOCAL_ITEM_BY_ID.get(takeItemId);
  if (!giveItem || !takeItem) throw new Error("ご当地の実だけ、取り替えられます");
  if (giveItem.rank !== takeItem.rank) throw new Error("取り替えられるのは、同じ何個目（現地・お土産・記念品）のご当地の実どうしです");

  const [listings, received] = await Promise.all([listListings(c), receivedKeys(c, userId)]);
  if (!listings.some((l) => l.producerId === userId && l.itemId === giveItemId)) {
    throw new Error(`市場に、あなたが育てた「${giveItem.name}」がありません（取り替えに使えるのは、自分の畑の実だけです）`);
  }
  const candidates = listings
    .filter((l) => l.itemId === takeItemId && l.producerId !== userId && !received.has(localFruitSourceKey(l.producerId, takeItemId)))
    .sort((a, b) => (b.leftover ?? 0) - (a.leftover ?? 0) || a.createdAt.localeCompare(b.createdAt));
  if (candidates.length === 0) throw new Error(`もらえる「${takeItem.name}」が市場にありません（同じ人が育てた同じ実は1人1個です）`);

  const mine = { producerId: userId, item: giveItem };
  // 相手が自分のその実をもう持っていれば、その相手とは取り替えられない。先にほかの人が取ったときも、次の相手で試す
  for (const l of candidates) {
    if (await hasLocalFruitFrom(c, l.producerId, userId, giveItemId)) continue;
    const theirs = { producerId: l.producerId, item: takeItem };
    if (!(await swapLocalFruits(mine, theirs, prefNameOf))) continue;

    const [mineLeft, theirsLeft] = await Promise.all([marketLeftover(userId, giveItemId), marketLeftover(l.producerId, takeItemId)]);
    if (theirsLeft === 0) await grantNextLocalSeed(c, l.producerId, takeItemId);
    if (mineLeft === 0) await grantNextLocalSeed(c, userId, giveItemId);
    // 相手に、取り替えで実が届いたことを知らせる(誰と取り替えたかは出さない)
    const next = theirsLeft === 0 ? nextLocalItem(takeItem) : undefined;
    await notifyUsers(c, [l.producerId], {
      title: "市場で実が取り替えられました",
      body: `市場に並んでいたあなたの「${takeItem.name}」が、「${giveItem.name}」（${prefNameOf(giveItem)}）と取り替えられて届きました${
        next ? `。並んでいた実が全部渡ったので、ご当地のタネ「${next.name}」も届きました（どこでもまけます）` : ""
      }`,
      url: "/game/chizu-tane/market",
      tag: `tane-local-${takeItemId}`,
    });
    const took = unwrap(await c.models.GameTaneItem.get({ userId, itemId: takeItemId }));
    return { takeItemId, takeQuantity: took?.quantity ?? 1, mineLeft };
  }
  throw new Error("取り替えられる相手がいませんでした（相手があなたの実をもう持っているか、先にほかの人が取り替えました）");
}
