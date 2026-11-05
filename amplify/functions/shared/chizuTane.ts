import {
  BatchWriteItemCommand,
  ConditionalCheckFailedException,
  DeleteItemCommand,
  GetItemCommand,
  DynamoDBClient,
  PutItemCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import type { DataClient } from "./dataClient";
import { unwrap } from "./dataClient";
import { levelFor, levelVisitCount, seedsForLevel, type TaneCourse } from "../../../src/lib/game/chizuTane/courses";
import { TANE_LOCAL_ITEM_BY_ID, nextLocalItem, type TaneLocalItem } from "../../../src/lib/game/chizuTane/localItems";
import { countPlaced, type GardenLayouts, type GardenObject } from "../../../src/lib/game/chizuTane/garden";
import {
  findTownDistrict,
  isCityCode,
  isPrefCode,
  isTooFast,
  townDistrictUrl,
  type TownDistrict,
  type TownDistrictFeature,
} from "../../../src/lib/game/chizuTane/geo";

// 地図タネの Lambda(chizu-tane-place / chizu-tane-checkin)で共通に使う、地区の判定と移動の速さの確認

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";
// 本番(main)以外では速さを確かめない(開発用の位置指定で一瞬で移れるように)。resource.ts で入れる
const SKIP_SPEED_CHECK = process.env.CHIZU_TANE_SKIP_SPEED_CHECK === "1";

// 町丁の geojson は同じコンテナの中のメモリに持っておく。2020年の境界なので古くならない
const townCache = new Map<string, Promise<TownDistrictFeature[] | null>>();

function fetchTownDistricts(prefCode: string, cityCode: string): Promise<TownDistrictFeature[] | null> {
  const url = townDistrictUrl(CLOUDFRONT_URL, prefCode, cityCode);
  const hit = townCache.get(url);
  if (hit) return hit;
  const value = fetch(url).then(async (res) => {
    if (res.ok) return ((await res.json()) as { features: TownDistrictFeature[] }).features;
    if (res.status === 403 || res.status === 404) return null; // CloudFront(S3)は無いファイルに 403 を返す
    throw new Error(`fetch failed: ${url} (${res.status})`);
  });
  townCache.set(url, value);
  value.catch(() => townCache.delete(url));
  return value;
}

export interface LocateArgs {
  lng: number;
  lat: number;
  prefCode: string;
  cityCode: string;
}

/**
 * ブラウザから来た位置で地区を判定し直す。ブラウザが言う地区は信用せず、市区町村コードは探す範囲を絞るためだけに使う。
 * その市区町村のどの町丁にも入らなければ例外
 */
export async function locateTownDistrict(args: LocateArgs): Promise<TownDistrict> {
  const { lng, lat, prefCode, cityCode } = args;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !isPrefCode(prefCode) || !isCityCode(cityCode)) {
    throw new Error("位置の形が正しくありません");
  }
  const features = await fetchTownDistricts(prefCode, cityCode);
  const district = features ? findTownDistrict(features, lng, lat) : null;
  if (!district) throw new Error("この場所の地区が分かりませんでした。もう一度現在地を調べてください");
  return district;
}

type Player = NonNullable<Awaited<ReturnType<DataClient["models"]["GameTanePlayer"]["get"]>>["data"]>;

export async function requirePlayer(c: DataClient, userId: string): Promise<Player> {
  const player = unwrap(await c.models.GameTanePlayer.get({ userId }));
  if (!player) throw new Error("先にコースを選んでください");
  return player;
}

/** 直前に位置を使ったとき(チェックイン・タネをまく)から、あり得ない速さで移動していたら例外 */
export function assertNotTooFast(player: Player, district: TownDistrict, now: Date): void {
  if (SKIP_SPEED_CHECK) return;
  const from =
    player.lastLng != null && player.lastLat != null && player.lastMovedAt
      ? { lng: player.lastLng, lat: player.lastLat, at: player.lastMovedAt }
      : null;
  if (isTooFast(from, { lng: district.repLng, lat: district.repLat }, now)) {
    throw new Error("前に位置を使ったところから離れすぎています。少し時間をおいてから試してください");
  }
}

/** 最後に位置を使った地区を覚えておく(地区の代表点だけで、実際の位置は保存しない) */
export async function rememberPosition(c: DataClient, userId: string, district: TownDistrict, now: Date): Promise<void> {
  unwrap(
    await c.models.GameTanePlayer.update({
      userId,
      lastAreaKey: district.areaKey,
      lastLng: district.repLng,
      lastLat: district.repLat,
      lastMovedAt: now.toISOString(),
    })
  );
}

/**
 * レベルの計算に使う、たずねたタネの数。たずねた(もらったことのある)ほかの人の拠点の数(自分の拠点は訪問の記録に残さないので入らない)と
 * チェックインした公式の畑の数に、フォローしている人の畑への手伝いの水やりを HELPS_PER_VISIT 回で1か所として足す
 */
export async function countVisitedBases(c: DataClient, userId: string): Promise<number> {
  const helpCount = unwrap(await c.models.GameTanePlayer.get({ userId }))?.helpCount ?? 0;
  let count = 0;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneVisit.list({ userId, nextToken });
    count += unwrap(page).length;
    nextToken = page.nextToken;
  } while (nextToken);
  return levelVisitCount(count + (await countOfficialVisits(c, userId)), helpCount);
}

/** チェックインした公式の畑の数(たずねたタネの数に足す。src/lib/game/chizuTane/official.ts) */
export async function countOfficialVisits(c: DataClient, userId: string): Promise<number> {
  return (await listOfficialVisits(c, userId)).length;
}

export async function listOfficialVisits(c: DataClient, userId: string) {
  const rows: NonNullable<Awaited<ReturnType<DataClient["models"]["GameTaneOfficialVisit"]["get"]>>["data"]>[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneOfficialVisit.list({ userId, nextToken });
    rows.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return rows;
}

export interface SeedGain {
  itemId: string;
  count: number;
  reason: "level";
}

/** タネ(もの)を増やす(無ければ作る) */
export async function addSeeds(c: DataClient, userId: string, itemId: string, count: number): Promise<void> {
  const existing = unwrap(await c.models.GameTaneHeldSeed.get({ userId, itemId }));
  const lastGainedAt = new Date().toISOString();
  unwrap(
    existing
      ? await c.models.GameTaneHeldSeed.update({ userId, itemId, quantity: existing.quantity + count, lastGainedAt })
      : await c.models.GameTaneHeldSeed.create({ userId, itemId, quantity: count, lastGainedAt })
  );
}

/** 自分の拠点にまいたことのあるタネ(もの)。レベルの条件(今のレベルのタネを3つともまいたか)に使う */
export async function plantedItemIds(c: DataClient, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneOwnership.list({ ownerId: userId, nextToken });
    for (const o of unwrap(page)) {
      ids.add(o.seedItemId);
      for (const past of o.pastSeedItemIds ?? []) if (past) ids.add(past);
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return ids;
}

/** 開拓した地区の数(使えるガーデンの数に使う)。空き地に戻って手放した地区も数える。まき直しは数えない */
export async function countPlanted(c: DataClient, userId: string): Promise<number> {
  let count = 0;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneOwnership.list({ ownerId: userId, nextToken });
    count += unwrap(page).length;
    nextToken = page.nextToken;
  } while (nextToken);
  return count;
}

/** 拠点の持ち主の ID(拠点の行には持ち主を持たないので、GameTaneOwnership から引く) */
export async function baseOwnerId(c: DataClient, areaKey: string): Promise<string> {
  // 空き地に戻って手放した行(releasedAt)は除く
  const row = unwrap(await c.models.GameTaneOwnership.listTaneOwnershipByArea({ areaKey })).find((r) => !r.releasedAt);
  if (!row) throw new Error("このタネの持ち主が分かりません");
  return row.ownerId;
}

/**
 * まだタネを渡していないレベルに上がっていたら、そのレベルの種類のもの3つのタネを1個ずつ渡す。
 * 渡したタネと今のレベルを返す
 */
export async function grantLevelSeeds(
  c: DataClient,
  player: { userId: string; course: string; grantedLevel?: number | null }
): Promise<{ level: number; gains: SeedGain[] }> {
  const level = levelFor(player.course as TaneCourse, await countVisitedBases(c, player.userId), await plantedItemIds(c, player.userId));
  const granted = player.grantedLevel ?? 1;
  const gains: SeedGain[] = [];
  if (level <= granted) return { level, gains };
  for (let lv = granted + 1; lv <= level; lv++) {
    for (const item of seedsForLevel(player.course as TaneCourse, lv)) {
      await addSeeds(c, player.userId, item.itemId, 1);
      gains.push({ itemId: item.itemId, count: 1, reason: "level" });
    }
  }
  unwrap(await c.models.GameTanePlayer.update({ userId: player.userId, grantedLevel: level }));
  return { level, gains };
}

/**
 * ご当地の畑の次のタネを持ち主に1個渡す。1個目の畑が実ったとき(ripened)は2個目、2個目の畑の実が全部収穫されたとき(harvested)は3個目。
 * もらった記録(GameTaneLocalGrant)を見て、1人1都道府県に1回だけ渡す。渡したもの(渡さなかったら null)を返す
 */
export async function grantNextLocalSeed(
  c: DataClient,
  ownerId: string,
  seedItemId: string,
  event: "ripened" | "harvested"
): Promise<TaneLocalItem | null> {
  const item = TANE_LOCAL_ITEM_BY_ID.get(seedItemId);
  if (!item || item.rank !== (event === "ripened" ? 1 : 2)) return null;
  const next = nextLocalItem(item);
  if (!next) return null;
  const grant = unwrap(await c.models.GameTaneLocalGrant.get({ userId: ownerId, prefCode: item.local }));
  const field = next.rank === 2 ? "secondAt" : "thirdAt";
  if (!grant || grant[field]) return null;
  unwrap(await c.models.GameTaneLocalGrant.update({ userId: ownerId, prefCode: item.local, [field]: new Date().toISOString() }));
  await addSeeds(c, ownerId, next.itemId, 1);
  return next;
}

// ─── 落ちているタネ(DynamoDB を直接さわる) ───────────────────────────────
// Amplify Data のクライアントでは「前の値を返す」「条件付きで書く」ができず、読んでから書くまでの間に割り込まれる。
// 落ちているタネは早い者勝ちなので、ここだけ DynamoDB の1回の書き込みで行う(同じ1件への書き込みは1つずつ順に処理されるので、
// ロックが無くても2人に同じタネが渡ることは無い)。テーブル名と権限は amplify/backend.ts で渡す

const ddb = new DynamoDBClient({});
const BASE_TABLE = process.env.CHIZU_TANE_BASE_TABLE ?? "";
const HELD_SEED_TABLE = process.env.CHIZU_TANE_HELD_SEED_TABLE ?? "";
const ITEM_TABLE = process.env.CHIZU_TANE_ITEM_TABLE ?? "";
const HARVEST_TABLE = process.env.CHIZU_TANE_HARVEST_TABLE ?? "";
const LOCAL_FRUIT_TABLE = process.env.CHIZU_TANE_LOCAL_FRUIT_TABLE ?? "";

/** ご当地の実をもらった記録(GameTaneLocalFruit)のキー。生産者とものの組み */
export function localFruitSourceKey(producerId: string, itemId: string): string {
  return `${producerId}#${itemId}`;
}

/**
 * この生産者のこのご当地の実を、もうもらったか(ご当地の実は生産者とものの組みにつき1人1個)。
 * 2026-11-02 より前は「ものにつき1人1個」で記録を持っていなかったので、収穫の記録(生産者が写してある)でも見る
 */
export async function hasLocalFruitFrom(c: DataClient, userId: string, producerId: string, itemId: string): Promise<boolean> {
  if (unwrap(await c.models.GameTaneLocalFruit.get({ userId, sourceKey: localFruitSourceKey(producerId, itemId) }))) return true;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneHarvest.list({ userId, nextToken });
    if (unwrap(page).some((h) => h.itemId === itemId && h.ownerId === producerId)) return true;
    nextToken = page.nextToken;
  } while (nextToken);
  return false;
}

/**
 * 拠点に落ちているタネを count 個拾う。「拠点から count 個減らす(count 個以上落ちているときだけ)」と
 * 「拾った人のタネに count 個足す」を1つのトランザクションで行う(両方成功するか、両方なかったことになる)。
 * 足りなかった(先にほかの人が拾った)ときは false
 */
export async function takeDroppedSeeds(areaKey: string, userId: string, itemId: string, count: number): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: BASE_TABLE,
              Key: { areaKey: { S: areaKey } },
              UpdateExpression: "SET droppedSeeds = droppedSeeds - :n, updatedAt = :now",
              ConditionExpression: "droppedSeeds >= :n",
              ExpressionAttributeValues: { ":n": { N: String(count) }, ":now": { S: now } },
            },
          },
          {
            // Amplify Data のモデルの行として読めるよう、__typename・createdAt・updatedAt も入れる
            Update: {
              TableName: HELD_SEED_TABLE,
              Key: { userId: { S: userId }, itemId: { S: itemId } },
              UpdateExpression:
                "SET quantity = if_not_exists(quantity, :zero) + :n, #tn = :tn, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, lastGainedAt = :now",
              ExpressionAttributeNames: { "#tn": "__typename" },
              ExpressionAttributeValues: {
                ":n": { N: String(count) },
                ":zero": { N: "0" },
                ":tn": { S: "GameTaneHeldSeed" },
                ":now": { S: now },
              },
            },
          },
        ],
      })
    );
    return true;
  } catch (err) {
    if (err instanceof TransactionCanceledException) return false;
    throw err;
  }
}

/** 拠点にタネを1個落とす(max 個まで。すでに max 個なら何もしない)。落とせたら true */
export async function dropSeed(areaKey: string, max: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: "SET droppedSeeds = if_not_exists(droppedSeeds, :zero) + :one, updatedAt = :now",
        ConditionExpression: "attribute_exists(areaKey) AND (attribute_not_exists(droppedSeeds) OR droppedSeeds < :max)",
        ExpressionAttributeValues: {
          ":zero": { N: "0" },
          ":one": { N: "1" },
          ":max": { N: String(max) },
          ":now": { S: new Date().toISOString() },
        },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

// ─── 水やりと実(DynamoDB を直接さわる) ─────────────────────────────────
// 実っていない拠点は fruits の項目が無い(または null)。実ると fruits を FRUITS_WHEN_RIPE にして water を0に戻し、
// 実が全部取られると fruits を消してランクを上げ、タネ待ちにする。どれも条件付きの書き込みなので、同時に来ても数がずれない

const NOT_RIPE = "(attribute_not_exists(fruits) OR attribute_type(fruits, :nullType))";

export interface WaterResult {
  /** 水をやったあとのたまった水(実っていて水をやらなかったときは null) */
  water: number | null;
  /** この水で実った */
  ripened: boolean;
}

/** 水をやる(実っていないときだけ)。たまって toRipe 以上になったら実らせる */
export async function addWater(areaKey: string, amount: number, toRipe: number, fruitsWhenRipe: number): Promise<WaterResult> {
  const now = new Date().toISOString();
  let water: number;
  try {
    const res = await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: "SET water = if_not_exists(water, :zero) + :n, lastWateredAt = :now, updatedAt = :now",
        ConditionExpression: `attribute_exists(areaKey) AND ${NOT_RIPE}`,
        ExpressionAttributeValues: { ":zero": { N: "0" }, ":n": { N: String(amount) }, ":now": { S: now }, ":nullType": { S: "NULL" } },
        ReturnValues: "UPDATED_NEW",
      })
    );
    water = Number(res.Attributes?.water?.N ?? 0);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return { water: null, ripened: false };
    throw err;
  }
  if (water < toRipe) return { water, ripened: false };
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: "SET fruits = :f, water = :zero, ripenedAt = :now, updatedAt = :now",
        ConditionExpression: `water >= :ripe AND ${NOT_RIPE}`,
        ExpressionAttributeValues: {
          ":f": { N: String(fruitsWhenRipe) },
          ":zero": { N: "0" },
          ":ripe": { N: String(toRipe) },
          ":now": { S: now },
          ":nullType": { S: "NULL" },
        },
      })
    );
    return { water: 0, ripened: true };
  } catch (err) {
    // 同時に水をやったほかの人が先に実らせた
    if (err instanceof ConditionalCheckFailedException) return { water: 0, ripened: false };
    throw err;
  }
}

/**
 * 拠点の「1つの時間帯に1回」の印(持ち主のチェックイン lastOwnerVisitOn・遠くからの水やり lastRemoteWaterOn)を、
 * まだその時間帯のものでないときだけ書く。水や実を動かす前に書くので、2台で同時に押しても進むのは1回分だけ。書けなければ false
 */
export async function claimBaseSlot(areaKey: string, attr: "lastOwnerVisitOn" | "lastRemoteWaterOn", slot: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: `SET ${attr} = :slot, updatedAt = :now`,
        ConditionExpression: `attribute_exists(areaKey) AND (attribute_not_exists(${attr}) OR ${attr} <> :slot)`,
        ExpressionAttributeValues: { ":slot": { S: slot }, ":now": { S: new Date().toISOString() } },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** 実をもらう拠点(収穫の記録に写すもの) */
export interface FruitSource {
  areaKey: string;
  ownerId: string;
  prefName: string;
  cityName: string;
  townName: string;
  ripenedAt?: string | null;
}

/**
 * 実を1個もらう。「拠点の実を1個減らす(1個以上あるときだけ)」「もらった人の実(GameTaneItem)を1個増やす」
 * 「収穫の記録(GameTaneHarvest)を1行足す」を1つのトランザクションで行う。
 * once(ご当地の実)なら、この生産者のこの実をまだもらっていないときだけもらえる(生産者とものの組みにつき1人1個。GameTaneLocalFruit)。
 * もらえたら、残りの実の数を返す(先にほかの人が取りきっていた・もうもらっていたら null)
 */
export async function takeFruit(base: FruitSource, userId: string, itemId: string, once = false): Promise<number | null> {
  const { areaKey } = base;
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: BASE_TABLE,
              Key: { areaKey: { S: areaKey } },
              UpdateExpression: "SET fruits = fruits - :one, updatedAt = :now",
              ConditionExpression: "fruits >= :one",
              ExpressionAttributeValues: { ":one": { N: "1" }, ":now": { S: now } },
            },
          },
          ...fruitGainWrites(base, userId, itemId, once, now),
        ],
      })
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) return null;
    throw err;
  }
  const after = await ddb.send(new GetItemCommand({ TableName: BASE_TABLE, Key: { areaKey: { S: areaKey } }, ConsistentRead: true }));
  return Number(after.Item?.fruits?.N ?? 0);
}

/**
 * 拠点の行を使わずに実を1個渡す(公式の畑。src/lib/game/chizuTane/official.ts)。「もらった人の実を1個増やす」と「収穫の記録を1行足す」を
 * 1つのトランザクションで行う
 */
export async function giveFruit(base: FruitSource, userId: string, itemId: string): Promise<void> {
  await ddb.send(new TransactWriteItemsCommand({ TransactItems: fruitGainWrites(base, userId, itemId, false, new Date().toISOString()) }));
}

/**
 * 実を1個もらうときの書き込み(もらった人の GameTaneItem を1個増やす・GameTaneHarvest を1行足す)。
 * once なら、もらった記録(GameTaneLocalFruit)も足す(すでにあれば、トランザクションごと失敗する)
 */
function fruitGainWrites(base: FruitSource, userId: string, itemId: string, once: boolean, now: string): TransactWriteItem[] {
  const areaName = `${base.cityName} ${base.townName}`;
  return [
    {
      // Amplify Data のモデルの行として読めるよう、__typename・createdAt・updatedAt も入れる
      Update: {
        TableName: ITEM_TABLE,
        Key: { userId: { S: userId }, itemId: { S: itemId } },
        UpdateExpression:
          "SET quantity = if_not_exists(quantity, :zero) + :one, #tn = :tn, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, " +
          "firstAcquiredAt = if_not_exists(firstAcquiredAt, :now), firstAreaName = if_not_exists(firstAreaName, :area)",
        ExpressionAttributeNames: { "#tn": "__typename" },
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":zero": { N: "0" },
          ":tn": { S: "GameTaneItem" },
          ":now": { S: now },
          ":area": { S: areaName },
        },
      },
    },
    {
      Put: {
        TableName: HARVEST_TABLE,
        Item: {
          userId: { S: userId },
          harvestedAt: { S: now },
          itemId: { S: itemId },
          areaKey: { S: base.areaKey },
          prefName: { S: base.prefName },
          cityName: { S: base.cityName },
          townName: { S: base.townName },
          ...(base.ripenedAt ? { ripenedAt: { S: base.ripenedAt } } : {}),
          ownerId: { S: base.ownerId },
          __typename: { S: "GameTaneHarvest" },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: "attribute_not_exists(harvestedAt)",
      },
    },
    ...(once
      ? [
          {
            Put: {
              TableName: LOCAL_FRUIT_TABLE,
              Item: {
                userId: { S: userId },
                sourceKey: { S: localFruitSourceKey(base.ownerId, itemId) },
                __typename: { S: "GameTaneLocalFruit" },
                createdAt: { S: now },
                updatedAt: { S: now },
              },
              ConditionExpression: "attribute_not_exists(sourceKey)",
            },
          },
        ]
      : []),
  ];
}

/** 実が全部取られた拠点のランクを上げて、タネ待ちにする(1回だけ。先にほかの人が済ませていれば何もしない) */
export async function resetAfterFruits(areaKey: string, newRank: number): Promise<void> {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: "SET #rank = :rank, water = :zero, waitingSince = :now, updatedAt = :now REMOVE fruits, ripenedAt",
        ConditionExpression: "fruits = :zero",
        ExpressionAttributeNames: { "#rank": "rank" },
        ExpressionAttributeValues: { ":rank": { N: String(newRank) }, ":zero": { N: "0" }, ":now": { S: new Date().toISOString() } },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return;
    throw err;
  }
}

/**
 * ご当地の畑の実が全部取られたら、畑を消す(ご当地の畑はまき直せないので、タネ待ちにせずその場で空き地に戻す。2026-11-02)。
 * 実が0のときだけ消す。持ち主の行は消さず releasedAt を付ける(開拓した地区の数・まいたタネに数え続ける)
 */
export async function removeHarvestedBase(c: DataClient, areaKey: string): Promise<void> {
  try {
    await ddb.send(
      new DeleteItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        ConditionExpression: "fruits = :zero",
        ExpressionAttributeValues: { ":zero": { N: "0" } },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return;
    throw err;
  }
  await releaseOwnerships(c, areaKey);
}

/** 消した畑の持ち主の行に「手放した」と書く(行は消さない。開拓した地区の数・まいたタネに数え続ける) */
export async function releaseOwnerships(c: DataClient, areaKey: string): Promise<void> {
  const now = new Date().toISOString();
  for (const row of unwrap(await c.models.GameTaneOwnership.listTaneOwnershipByArea({ areaKey }))) {
    if (!row.releasedAt) unwrap(await c.models.GameTaneOwnership.update({ ownerId: row.ownerId, areaKey, releasedAt: now }));
  }
}

/**
 * 宅急便: 実っている畑の残りの実を全部、持ち主に届けて、畑を消す(空き地に戻り、ランクも無くなる。growth.ts の「畑の終わり方」)。
 * 「畑を消す(読んだときと同じ実の数・実った日時のときだけ)」と「持ち主の実を増やす」を1つのトランザクションで行い、
 * 収穫の記録(実1個に1行)はそのあとに書く(トランザクションに入れると、実が多いとき項目の数の上限を超えるため)。
 * 先にほかの人が実を取った・回収したなどで書けなければ false
 */
export async function deliverFruits(c: DataClient, base: FruitSource, itemId: string, fruits: number): Promise<boolean> {
  if (!base.ripenedAt || fruits < 1) return false;
  const start = Date.now();
  const now = new Date(start).toISOString();
  const [itemWrite, harvestWrite] = fruitGainWrites(base, base.ownerId, itemId, false, now);
  try {
    await ddb.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: BASE_TABLE,
              Key: { areaKey: { S: base.areaKey } },
              ConditionExpression: "fruits = :n AND ripenedAt = :r",
              ExpressionAttributeValues: { ":n": { N: String(fruits) }, ":r": { S: base.ripenedAt } },
            },
          },
          { Update: { ...itemWrite.Update!, ExpressionAttributeValues: { ...itemWrite.Update!.ExpressionAttributeValues, ":one": { N: String(fruits) } } } },
        ],
      })
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) return false;
    throw err;
  }
  // 収穫の記録は実1個に1行。同じ日時にならないよう、1ミリ秒ずつずらす
  const item = harvestWrite.Put!.Item!;
  const rows = Array.from({ length: fruits }, (_, i) => ({
    PutRequest: { Item: { ...item, harvestedAt: { S: new Date(start + i).toISOString() } } },
  }));
  for (let i = 0; i < rows.length; i += 25) {
    let requests: typeof rows | undefined = rows.slice(i, i + 25);
    for (let attempt = 0; requests && requests.length > 0 && attempt < 5; attempt++) {
      const res = await ddb.send(new BatchWriteItemCommand({ RequestItems: { [HARVEST_TABLE]: requests } }));
      requests = res.UnprocessedItems?.[HARVEST_TABLE] as typeof rows | undefined;
    }
  }
  await releaseOwnerships(c, base.areaKey);
  return true;
}

// ─── 畑の終わり方(定期実行の chizu-tane-sweep。src/lib/game/chizuTane/growth.ts) ─────────────────

/**
 * 期限を過ぎた畑(タネ待ちのまま1週間・腐り落ちた・枯れた)の行を消す。読んだときから書き換わっていない(updatedAt が同じ)ときだけ
 * (消す直前に水が入った・実を取られた・まき直されたなら消さない)。消せたら持ち主の行に「手放した」と書いて true
 */
export async function removeEndedBase(c: DataClient, areaKey: string, seenUpdatedAt: string): Promise<boolean> {
  try {
    await ddb.send(
      new DeleteItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        ConditionExpression: "updatedAt = :seen",
        ExpressionAttributeValues: { ":seen": { S: seenUpdatedAt } },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
  await releaseOwnerships(c, areaKey);
  return true;
}

/**
 * 前もって知らせたことの印(growth.ts の FieldNotice.key)を書く。まだその印でないときだけ書き、書けたら true(2回知らせないため)。
 * updatedAt は変えない(畑が書き換わったかの目印に使っているので)
 */
export async function markEndingNotice(areaKey: string, key: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: "SET endingNotice = :k",
        ConditionExpression: "attribute_exists(areaKey) AND (attribute_not_exists(endingNotice) OR endingNotice <> :k)",
        ExpressionAttributeValues: { ":k": { S: key } },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

// ─── タネをまく・まき直す(DynamoDB を直接さわる) ─────────────────────────

export interface NewBaseRow {
  areaKey: string;
  cityKey: string;
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
  townName: string;
  baseTypeId: string;
  seedItemId: string;
  repLng: number;
  repLat: number;
}

/**
 * 新しくタネをまいた拠点の行を書く。空き地(行が無い)か、タネ待ちのまま waitingBefore より前から待っている
 * (ほかの人もまけるようになった)ときだけ書ける。同時にまこうとしても(持ち主のまき直しとも)先に書いた方だけが通る。
 * 書けなければ false
 */
export async function putNewBase(row: NewBaseRow, waitingBefore: string): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: BASE_TABLE,
        Item: {
          areaKey: { S: row.areaKey },
          cityKey: { S: row.cityKey },
          prefCode: { S: row.prefCode },
          prefName: { S: row.prefName },
          cityCode: { S: row.cityCode },
          cityName: { S: row.cityName },
          townName: { S: row.townName },
          baseTypeId: { S: row.baseTypeId },
          seedItemId: { S: row.seedItemId },
          rank: { N: "1" },
          plantedAt: { S: now },
          repLng: { N: String(row.repLng) },
          repLat: { N: String(row.repLat) },
          water: { N: "0" },
          droppedSeeds: { N: "0" },
          // Amplify Data のモデルの行として読めるよう、__typename・createdAt・updatedAt も入れる
          __typename: { S: "GameTaneBase" },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: "attribute_not_exists(areaKey) OR (attribute_exists(waitingSince) AND waitingSince < :cutoff)",
        ExpressionAttributeValues: { ":cutoff": { S: waitingBefore } },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/**
 * タネ待ちの拠点にタネをまき直す(タネから育ち直す。畑の種類はまいたタネのものになり、ランクはそのまま)。タネ待ちのときだけ
 * (空き地に戻った畑は、定期実行の chizu-tane-sweep が行を消している)。書けなければ false
 */
export async function replantBaseRow(areaKey: string, itemId: string, baseTypeId: string): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression:
          "SET seedItemId = :item, baseTypeId = :type, water = :zero, plantedAt = :now, updatedAt = :now REMOVE waitingSince, lastRemoteWaterOn, lastOwnerVisitOn",
        ConditionExpression: "attribute_exists(waitingSince)",
        ExpressionAttributeValues: {
          ":item": { S: itemId },
          ":type": { S: baseTypeId },
          ":zero": { N: "0" },
          ":now": { S: now },
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

/** ガーデン(全部)に飾っている、その実の数(おすそ分けの棚・市場では、飾っている分は出せない) */
export async function placedInGardens(c: DataClient, userId: string, itemId: string): Promise<number> {
  const garden = unwrap(await c.models.GameTaneGarden.get({ userId }));
  if (!garden) return 0;
  const layouts = parseJson<GardenLayouts | null>(garden.layouts) ?? {};
  const all: GardenObject[] = [...parseJson<GardenObject[]>(garden.objects), ...Object.values(layouts).flatMap((objs) => objs ?? [])];
  return countPlaced(all).get(itemId) ?? 0;
}

/**
 * 手元の実を count 個減らす。ガーデンに飾っている分(keep)は残し、足りるときだけ減らす(同時に押しても、数がずれない)。
 * 減らせなければ false
 */
export async function spendFruits(userId: string, itemId: string, count: number, keep: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: ITEM_TABLE,
        Key: { userId: { S: userId }, itemId: { S: itemId } },
        UpdateExpression: "SET quantity = quantity - :n, updatedAt = :now",
        ConditionExpression: "quantity >= :need",
        ExpressionAttributeValues: { ":n": { N: String(count) }, ":need": { N: String(count + keep) }, ":now": { S: new Date().toISOString() } },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}
