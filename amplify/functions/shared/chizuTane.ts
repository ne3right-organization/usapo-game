import {
  ConditionalCheckFailedException,
  GetItemCommand,
  DynamoDBClient,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import type { DataClient } from "./dataClient";
import { unwrap } from "./dataClient";
import { levelFor, seedsForLevel, type TaneCourse } from "../../../src/lib/game/chizuTane/courses";
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

// 町丁の geojson は同じコンテナの中のメモリに持っておく(図鑑クイズと同じ)。2020年の境界なので古くならない
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

/** たずねた(もらったことのある)ほかの人の拠点の数。レベルの計算に使う(自分の拠点は訪問の記録に残さないので入らない) */
export async function countVisitedBases(c: DataClient, userId: string): Promise<number> {
  let count = 0;
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneVisit.list({ userId, nextToken });
    count += unwrap(page).length;
    nextToken = page.nextToken;
  } while (nextToken);
  return count;
}

export interface SeedGain {
  itemId: string;
  count: number;
  reason: "checkin" | "level";
}

/** タネ(もの)を増やす(無ければ作る) */
export async function addSeeds(c: DataClient, userId: string, itemId: string, count: number): Promise<void> {
  const existing = unwrap(await c.models.GameTaneHeldSeed.get({ userId, itemId }));
  unwrap(
    existing
      ? await c.models.GameTaneHeldSeed.update({ userId, itemId, quantity: existing.quantity + count })
      : await c.models.GameTaneHeldSeed.create({ userId, itemId, quantity: count })
  );
}

/** 自分の拠点にまいたことのあるタネ(もの)。レベルの条件(今のレベルのタネを3つともまいたか)に使う */
export async function plantedItemIds(c: DataClient, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneBase.listTaneBasesByOwner({ ownerId: userId }, { nextToken });
    for (const b of unwrap(page)) ids.add(b.seedItemId);
    nextToken = page.nextToken;
  } while (nextToken);
  return ids;
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

// ─── 落ちているタネ(DynamoDB を直接さわる) ───────────────────────────────
// Amplify Data のクライアントでは「前の値を返す」「条件付きで書く」ができず、読んでから書くまでの間に割り込まれる。
// 落ちているタネは早い者勝ちなので、ここだけ DynamoDB の1回の書き込みで行う(同じ1件への書き込みは1つずつ順に処理されるので、
// ロックが無くても2人に同じタネが渡ることは無い)。テーブル名と権限は amplify/backend.ts で渡す

const ddb = new DynamoDBClient({});
const BASE_TABLE = process.env.CHIZU_TANE_BASE_TABLE ?? "";
const HELD_SEED_TABLE = process.env.CHIZU_TANE_HELD_SEED_TABLE ?? "";
const ITEM_TABLE = process.env.CHIZU_TANE_ITEM_TABLE ?? "";
const HARVEST_TABLE = process.env.CHIZU_TANE_HARVEST_TABLE ?? "";

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
                "SET quantity = if_not_exists(quantity, :zero) + :n, #tn = :tn, createdAt = if_not_exists(createdAt, :now), updatedAt = :now",
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
// 実が全部取られると fruits を消してランクを上げる(芽に戻る)。どれも条件付きの書き込みなので、同時に来ても数がずれない

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
        UpdateExpression: "SET water = if_not_exists(water, :zero) + :n, updatedAt = :now",
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
 * もらえたら、残りの実の数を返す(先にほかの人が取りきっていたら null)
 */
export async function takeFruit(base: FruitSource, userId: string, itemId: string): Promise<number | null> {
  const { areaKey } = base;
  const areaName = `${base.cityName} ${base.townName}`;
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
                areaKey: { S: areaKey },
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

/** 実が全部取られた拠点を芽に戻し、ランクを上げる(1回だけ。先にほかの人が戻していれば何もしない) */
export async function resetAfterFruits(areaKey: string, newRank: number): Promise<void> {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: BASE_TABLE,
        Key: { areaKey: { S: areaKey } },
        UpdateExpression: "SET #rank = :rank, water = :zero, updatedAt = :now REMOVE fruits, ripenedAt",
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
