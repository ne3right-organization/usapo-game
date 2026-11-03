import { ConditionalCheckFailedException, DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addSeeds,
  addWater,
  assertNotTooFast,
  baseOwnerId,
  claimBaseSlot,
  dropSeed,
  giveFruit,
  hasLocalFruitFrom,
  grantLevelSeeds,
  grantNextLocalSeed,
  listOfficialVisits,
  locateTownDistrict,
  rememberPosition,
  removeHarvestedBase,
  requirePlayer,
  resetAfterFruits,
  takeFruit,
  type LocateArgs,
  type SeedGain,
} from "../shared/chizuTane";
import { DROPPED_SEEDS_MAX, SEEDS_PER_CHECKIN, TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID, type TaneCourse } from "../../../src/lib/game/chizuTane/courses";
import {
  OFFICIAL_DAILY_LIMIT,
  OFFICIAL_OWNER_ID,
  OFFICIAL_PLACE,
  OFFICIAL_WATER_PER_CHECKIN,
  TANE_OFFICIAL_FIELDS,
  officialDayKey,
  officialFieldsFor,
} from "../../../src/lib/game/chizuTane/official";
import { isLocalBaseTypeId, type TaneLocalItem } from "../../../src/lib/game/chizuTane/localItems";
import { notifyUsers } from "../shared/push";
import { DAY_MS_PRODUCTION, slotKey } from "../../../src/lib/game/chizuTane/geo";
import {
  fruitsWhenRipe,
  isAbandoned,
  isWaitingReplant,
  MAX_RANK,
  WATER_ONSITE,
  WATER_REMOTE,
  WATER_TO_RIPE,
  growthStage,
} from "../../../src/lib/game/chizuTane/growth";

// 区切りの長さ。チェックイン・遠くからの水やりは1つの区切りに1回(本番は朝・昼・夜、それ以外は5分ごと)
const DAY_MS = Number(process.env.CHIZU_TANE_DAY_MS ?? DAY_MS_PRODUCTION);

type CheckInResult = Schema["TaneCheckInResult"]["type"];
type HelpField = Schema["TaneHelpField"]["type"];
type HelpResult = Schema["TaneHelpResult"]["type"];
type HelpAllResult = Schema["TaneHelpAllResult"]["type"];
type OfficialResult = Schema["TaneOfficialResult"]["type"];
type Args = Partial<LocateArgs> & { areaKey?: string; ownerId?: string; fieldId?: string; officialFieldId?: string; waterAll?: boolean };

/**
 * 地図タネの、現地のチェックイン(checkInTaneBase)・遠くからの水やり(waterTaneBaseRemotely)・
 * フォローしている人の畑の一覧(listTaneHelpFields)とその畑への手伝いの水やり(helpWaterTaneBase・まとめて helpWaterAllTaneBases)・
 * 公式の畑へのチェックイン(checkInTaneOfficialField)とそこに落ちているタネを拾う(pickUpTaneOfficialSeed)。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(areaKey があれば遠くからの水やり、ownerId と fieldId があれば手伝い、
 * waterAll ならまとめて手伝い、fieldId だけなら公式の畑、officialFieldId なら公式の畑のタネを拾う、ownerId だけなら畑の一覧)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { areaKey, ownerId, fieldId, officialFieldId, waterAll } = event.arguments;
  if (typeof areaKey === "string") return waterRemotely(c, userId, areaKey);
  if (typeof officialFieldId === "string") return pickUpOfficialSeed(c, userId, officialFieldId);
  if (typeof ownerId === "string" && typeof fieldId === "string") return helpWater(c, userId, ownerId, fieldId);
  if (typeof ownerId === "string" && waterAll) return helpWaterAll(c, userId, ownerId);
  if (typeof fieldId === "string") return checkInOfficial(c, userId, fieldId);
  if (typeof ownerId === "string") return listHelpFields(c, userId, ownerId);
  return checkIn(c, userId, event.arguments as LocateArgs);
};

/**
 * 現地のチェックイン。持ち主でもほかの人でも同じで、1人1つの時間帯(朝・昼・夜)に1回(dev は5分ごと)。まいた直後からできる。
 * - 実が残っていれば、実を1個もらう(早い者勝ち)。最後の1個ならランクが1つ上がり、タネ待ちになる(持ち主がまき直すまで育たない)。
 *   ご当地の畑はまき直せないので、最後の1個が取られたら畑を消す(すぐ空き地に戻る)
 * - タネ待ちの畑では、水も実も無い(ほかの人の初めてのチェックインなら、タネが落ちて訪問にも数える)。1週間たって空き地に戻った畑は無いのと同じ
 * - 実っていなければ、水をやる(現地は10)。たまったら実って、実ができる(ランク×10個)。実ったら、持ち主に「生産者の取り分」が1個届き、
 *   ほかの人が実らせたときは、実らせた人もそのまま1個もらう(持ち主が自分で実らせたときは取り分の1個だけ)
 * - ほかの人のタネに初めてチェックインしたときだけ、拠点にタネが1個落ちる(3個まで。直接はもらわず、拾うかどうかは選べる)。
 *   前にタネが落ちたときから畑の種類が変わっていれば(まき直し・ほかの人の畑になった)、またタネが1個落ちる(たずねた数は増えない)。
 *   たずねた拠点の数が増えるので、レベルが上がることもある(自分のタネは訪問の記録に残さず、レベルにも数えない)
 * - ご当地の畑(docs/地図タネ_ご当地タネ設計書.md の 4章)は、実が生産者とものの組みにつき1人1個(この畑の実をもうもらった人には渡さない)で、タネは落ちない。
 *   1個目の畑が実ったら持ち主に2個目のタネを、2個目の畑の実が全部収穫されたら3個目のタネを届ける
 */
async function checkIn(c: DataClient, userId: string, args: LocateArgs): Promise<CheckInResult> {
  const now = new Date();
  const today = slotKey(now, DAY_MS);

  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const base = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (!base || isAbandoned(base, now, DAY_MS)) throw new Error("この地区にはまだタネがありません");
  const waiting = isWaitingReplant(base);
  await rememberPosition(c, userId, district, now);

  const picked = TANE_ITEM_BY_ID.get(base.seedItemId);
  if (!picked) throw new Error("このタネでもらえるものがありません");
  const ownerId = await baseOwnerId(c, base.areaKey);
  const isOwn = ownerId === userId;
  const local = isLocalBaseTypeId(base.baseTypeId);
  // ご当地の畑で、持ち主に届けた次のタネ
  let localSeed: TaneLocalItem | null = null;
  const result: CheckInResult = {
    status: "already",
    townName: base.townName,
    baseTypeId: base.baseTypeId,
    itemId: picked.itemId,
    quantity: null,
    gainedItems: 0,
    firstVisit: false,
    level: null,
    leveledUp: false,
    droppedSeeds: base.droppedSeeds ?? 0,
    stage: growthStage(base),
    rank: base.rank,
    water: base.water ?? 0,
    fruits: base.fruits ?? 0,
    seedsGained: "[]",
  };

  // タネ待ちの自分の畑では、何も起きない(まき直すのはホームか、おでかけの画面から)
  if (waiting && isOwn) {
    result.status = "waiting";
    return result;
  }

  // 1つの時間帯に1回(自分の拠点は拠点の行に、ほかの人の拠点は訪問の記録に、最後に来た時間帯を持つ)。
  // 水や実を動かす前に条件付きで書くので、2台で同時にチェックインしても進むのは1回分だけ
  let visit: PastVisit | null = null;
  if (isOwn) {
    if (!(await claimBaseSlot(base.areaKey, "lastOwnerVisitOn", today))) return result;
  } else {
    const claimed = await claimVisit(userId, base.areaKey, today, base.baseTypeId, now);
    if (claimed === "already") return result;
    visit = claimed;
  }

  // 実が残っていれば実を1個、無ければ水をやる(タネ待ちなら何もしない)
  if (waiting) {
    result.status = "waiting";
  } else if ((base.fruits ?? 0) > 0) {
    // ご当地の実は生産者とものの組みにつき1人1個。この畑の実をもうもらっていれば渡さない(実はほかの人のために残る)
    const have = local && (await hasLocalFruitFrom(c, userId, ownerId, picked.itemId));
    const left = have ? null : await takeFruit({ ...base, ownerId }, userId, picked.itemId, local);
    if (have) result.status = "have";
    if (left !== null) {
      result.status = "fruit";
      result.gainedItems = 1;
      result.fruits = left;
      result.quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }))?.quantity ?? 1;
      if (left === 0 && local) {
        // 次のご当地のタネを届けてから、畑を消す
        localSeed = await grantNextLocalSeed(c, ownerId, picked.itemId, "harvested");
        await removeHarvestedBase(c, base.areaKey);
        result.water = 0;
        result.stage = 0;
      } else if (left === 0) {
        const rank = Math.min(MAX_RANK, base.rank + 1);
        await resetAfterFruits(base.areaKey, rank);
        result.rank = rank;
        result.water = 0;
        result.stage = 0;
      }
    }
  }
  if (result.status === "already") {
    // 実が無かった(または先に取りきられた)ので水をやる
    const watered = await addWater(base.areaKey, WATER_ONSITE, WATER_TO_RIPE, fruitsWhenRipe(base.rank));
    result.status = watered.ripened ? "ripened" : "watered";
    result.water = watered.water ?? 0;
    result.fruits = watered.ripened ? fruitsWhenRipe(base.rank) : 0;
    result.stage = growthStage({ water: result.water, fruits: result.fruits });
    if (watered.ripened) {
      const source = { ...base, ownerId, ripenedAt: new Date().toISOString() };
      // 実らせた人は、そのまま実を1個もらう(実らせた人が次の時間帯まで待たなくてよいように)。持ち主ならこれが生産者の取り分
      const left = await takeFruit(source, userId, picked.itemId, local);
      if (left !== null) {
        result.gainedItems = 1;
        result.fruits = left;
        result.quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }))?.quantity ?? 1;
      }
      // ほかの人が実らせたときは、持ち主にも生産者の取り分を1個届ける(遠くにまいたタネでも、人に来てもらえば実が手に入る)
      if (!isOwn) {
        const afterShare = await takeFruit(source, ownerId, picked.itemId, local);
        if (afterShare !== null) result.fruits = afterShare;
      }
      if (local) localSeed = await grantNextLocalSeed(c, ownerId, picked.itemId, "ripened");
    }
  }

  if (isOwn) {
    if (localSeed) result.seedsGained = JSON.stringify([{ itemId: localSeed.itemId, count: 1, reason: "local" }]);
    return result;
  }

  // 持ち主に知らせる(1つのタネの通知は、新しいものが古いものを置き換える)。
  // 来た人の名前は、来た人が持ち主に「農園を見せる」にしているときだけ出す(いつどこにいたかは来た人の生活圏の情報なので。それ以外は「誰か」)
  const place = `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "タネ"}`;
  const visitorName = await visitorNameFor(c, userId, ownerId);
  const who = visitorName ? `${visitorName}さん` : "誰か";
  const lastFruitTaken = result.status === "fruit" && result.fruits === 0;
  const localSeedText = localSeed ? `ご当地のタネ「${localSeed.name}」が届きました！ ` : "";
  const notice = lastFruitTaken
    ? {
        title: "実が全部収穫されました",
        body: local
          ? `${who}が${place}の最後の実を収穫しました。${localSeedText}ご当地の畑はこれで役目を終えて、なくなりました`
          : `${who}が${place}の最後の実を収穫しました。畑のランクが${result.rank}に上がりました。1日以内にタネをまき直してください（まかないと、現地に来たほかの人がタネをまけるようになります）`,
      }
    : result.status === "ripened"
      ? {
          title: "タネが実りました",
          body: `${visitorName ? `${who}が水をやって、` : ""}${place}が実りました！ 生産者の取り分として実が1個届きました（のこり${result.fruits}個）${localSeed ? `。${localSeedText}` : ""}`,
        }
      : result.status === "fruit"
        ? { title: "実が収穫されました", body: `${who}が${place}に来て、実を1個収穫しました（のこり${result.fruits}個）` }
        : result.status === "have"
          ? { title: `タネに${who}が来ました`, body: `${who}が${place}に来ました` }
          : { title: `タネに${who}が来ました`, body: `${who}が${place}に来て、水をやってくれました` };
  // タネ待ちの畑に来ただけのときは知らせない(何も変わらないので)
  if (result.status !== "waiting") await notifyUsers(c, [ownerId], { ...notice, url: "/game/chizu-tane", tag: `tane-${base.areaKey}` });

  // ほかの人のタネに初めて来たときだけ、拠点にタネが1個落ちる(直接はもらわない。要らなければ拾わずに置いていける)。
  // 前にタネが落ちたときから畑の種類が変わっていれば、またタネが1個落ちる(dropTypeId が無い行も、変わったとみなす。
  // 2026-11-02 より前の行は、前に来たのがいまの畑なら、その種類をデータで入れてある)
  const seedsGained: SeedGain[] = [];
  if (visit && !local && visit.dropTypeId !== base.baseTypeId) {
    result.typeChanged = true;
    for (let i = 0; i < SEEDS_PER_CHECKIN; i++) await dropSeed(base.areaKey, DROPPED_SEEDS_MAX);
    result.droppedSeeds = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey }))?.droppedSeeds ?? 0;
  }
  if (!visit) {
    result.firstVisit = true;
    // 落とすのは DynamoDB の条件付きの書き込み(3個未満のときだけ増やす)。同時にチェックインしても数がずれない。
    // ご当地の畑には落ちない(ご当地のタネは、決まった3つの方法でしか増えない)
    if (!local) for (let i = 0; i < SEEDS_PER_CHECKIN; i++) await dropSeed(base.areaKey, DROPPED_SEEDS_MAX);
    result.droppedSeeds = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey }))?.droppedSeeds ?? 0;
  }
  // 初めての拠点なら、たずねた拠点の数が増えるのでレベルが上がることがある
  const granted = await grantLevelSeeds(c, player);
  seedsGained.push(...granted.gains);
  result.level = granted.level;
  result.leveledUp = granted.gains.length > 0;
  result.seedsGained = JSON.stringify(seedsGained);
  return result;
}

// 訪問の記録と手伝いの記録も、「1つの時間帯に1回」の印を DynamoDB で直接、条件付きで書く(テーブル名と権限は amplify/backend.ts)
const VISIT_TABLE = process.env.CHIZU_TANE_VISIT_TABLE ?? "";
const HELP_TABLE = process.env.CHIZU_TANE_HELP_TABLE ?? "";

/** 前に来たときの訪問の記録(初めてなら null) */
interface PastVisit {
  /** 最後にタネが落ちたときの畑の種類(2026-11-02 より前の行には無い) */
  dropTypeId?: string;
}

/**
 * ほかの人の拠点の訪問の記録に、この時間帯に来たことを書く(初めてなら行を作る)。まだこの時間帯に来ていないときだけ書けるので、
 * 2台で同時にチェックインしても通るのは1回だけ。書けたら前の記録(初めてなら null)を、もう来ていれば "already" を返す
 */
async function claimVisit(userId: string, areaKey: string, slot: string, baseTypeId: string, now: Date): Promise<PastVisit | null | "already"> {
  const key = { userId: { S: userId }, areaKey: { S: areaKey } };
  const nowIso = now.toISOString();
  try {
    const res = await ddb.send(
      new UpdateItemCommand({
        TableName: VISIT_TABLE,
        Key: key,
        UpdateExpression:
          "SET lastReceivedOn = :slot, visitCount = if_not_exists(visitCount, :zero) + :one, dropTypeId = :type, " +
          "firstVisitedAt = if_not_exists(firstVisitedAt, :now), createdAt = if_not_exists(createdAt, :now), updatedAt = :now, #typename = :typename",
        ConditionExpression: "attribute_not_exists(lastReceivedOn) OR lastReceivedOn <> :slot",
        // Amplify Data のモデルの行として読めるよう、__typename も入れる
        ExpressionAttributeNames: { "#typename": "__typename" },
        ExpressionAttributeValues: {
          ":slot": { S: slot },
          ":zero": { N: "0" },
          ":one": { N: "1" },
          ":type": { S: baseTypeId },
          ":now": { S: nowIso },
          ":typename": { S: "GameTaneVisit" },
        },
        ReturnValues: "ALL_OLD",
      })
    );
    const old = res.Attributes;
    return old?.firstVisitedAt ? { dropTypeId: old.dropTypeId?.S } : null;
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // この時間帯にもう来ている。来た回数だけ数える
    await ddb.send(
      new UpdateItemCommand({
        TableName: VISIT_TABLE,
        Key: key,
        UpdateExpression: "SET visitCount = visitCount + :one, updatedAt = :now",
        ExpressionAttributeValues: { ":one": { N: "1" }, ":now": { S: nowIso } },
      })
    );
    return "already";
  }
}

/** 手伝いの水やりの記録に、この時間帯に水をやったことを書く(初めてなら行を作る)。もうこの時間帯に水をやっていれば false */
async function claimHelp(helperId: string, areaKey: string, slot: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: HELP_TABLE,
        Key: { helperId: { S: helperId }, areaKey: { S: areaKey } },
        UpdateExpression: "SET lastWaterOn = :slot, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, #typename = :typename",
        ConditionExpression: "attribute_not_exists(lastWaterOn) OR lastWaterOn <> :slot",
        ExpressionAttributeNames: { "#typename": "__typename" },
        ExpressionAttributeValues: { ":slot": { S: slot }, ":now": { S: nowIso }, ":typename": { S: "GameTaneHelp" } },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/**
 * 通知に出す来た人のニックネーム。来た人が持ち主に「農園を見せる」にしていて(GameTaneShare)、持ち主が来た人をフォローしているときだけ。
 * それ以外は null(通知では「誰か」にする)
 */
async function visitorNameFor(c: DataClient, visitorId: string, ownerId: string): Promise<string | null> {
  const [share, follow] = await Promise.all([
    c.models.GameTaneShare.get({ ownerId: visitorId, viewerId: ownerId }),
    c.models.GameFollow.get({ followerId: ownerId, followeeId: visitorId }),
  ]);
  if (!unwrap(share) || !unwrap(follow)) return null;
  return unwrap(await c.models.GameProfile.get({ userId: visitorId }))?.nickname || null;
}

/**
 * 自分のタネに遠くから水をやる。タネごとに1つの時間帯(朝・昼・夜)に1回で、効き目は現地の10分の1。実っている間はできない。
 * これで実ったら、生産者の取り分の1個が届く
 */
async function waterRemotely(c: DataClient, userId: string, areaKey: string) {
  const now = new Date();
  const today = slotKey(now, DAY_MS);
  const base = unwrap(await c.models.GameTaneBase.get({ areaKey }));
  const own = unwrap(await c.models.GameTaneOwnership.get({ ownerId: userId, areaKey }));
  if (!base || !own) throw new Error("自分のタネにだけ、遠くから水をやれます");
  if ((base.fruits ?? 0) > 0) throw new Error("実っているので、水はいりません。現地で実をもらってください");
  if (isWaitingReplant(base)) throw new Error("タネ待ちの畑には水をやれません。先にタネをまき直してください");
  // 水をやる前に条件付きで書くので、2台で同時に押しても水が入るのは1回分だけ
  if (!(await claimBaseSlot(areaKey, "lastRemoteWaterOn", today))) {
    throw new Error("遠くからの水やりは、1つのタネに朝・昼・夜それぞれ1回です");
  }
  const watered = await addWater(areaKey, WATER_REMOTE, WATER_TO_RIPE, fruitsWhenRipe(base.rank));
  if (watered.ripened) {
    const item = TANE_ITEM_BY_ID.get(base.seedItemId);
    const local = isLocalBaseTypeId(base.baseTypeId);
    if (item) await takeFruit({ ...base, ownerId: userId, ripenedAt: new Date().toISOString() }, userId, item.itemId, local);
    // ご当地の1個目の畑なら、2個目のタネが届く(画面はタネを読み直して知らせる)
    if (item && local) await grantNextLocalSeed(c, userId, item.itemId, "ripened");
  }
  return unwrap(await c.models.GameTaneBase.get({ areaKey }));
}

// ─── 手伝いの水やり(フォローしている人の畑に遠くから水をやる。2026-10-31) ─────────────────
// 見られるのは、持ち主が自分に「農園を見せる」にしていて、自分が持ち主をフォローしているときだけ(ガーデンを見るのと同じ)。
// 畑は、まいた日時(GameTaneOwnership.plantedAt)で指す。地区も出す(全国農地と見比べれば分かってしまうので隠さない。
// 見せる相手は持ち主が選んでいて、「農園を見せる」の説明にも畑の場所が分かると書いている)

type Ownership = NonNullable<Awaited<ReturnType<DataClient["models"]["GameTaneOwnership"]["get"]>>["data"]>;
type Base = NonNullable<Awaited<ReturnType<DataClient["models"]["GameTaneBase"]["get"]>>["data"]>;

async function requireHelpable(c: DataClient, helperId: string, ownerId: string): Promise<void> {
  if (helperId === ownerId) throw new Error("自分の畑には、ホームから水をやってください");
  const [share, follow] = await Promise.all([
    c.models.GameTaneShare.get({ ownerId, viewerId: helperId }),
    c.models.GameFollow.get({ followerId: helperId, followeeId: ownerId }),
  ]);
  if (!unwrap(share) || !unwrap(follow)) throw new Error("この人の畑には水をやれません");
}

/** 持ち主のいまの畑(手放した畑と、空き地に戻った畑は除く) */
async function ownerFields(c: DataClient, ownerId: string, now: Date): Promise<{ own: Ownership; base: Base }[]> {
  const owns: Ownership[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneOwnership.list({ ownerId, nextToken });
    owns.push(...unwrap(page).filter((o) => !o.releasedAt));
    nextToken = page.nextToken;
  } while (nextToken);
  const rows = await Promise.all(owns.map(async (own) => ({ own, base: unwrap(await c.models.GameTaneBase.get({ areaKey: own.areaKey })) })));
  return rows.filter((r): r is { own: Ownership; base: Base } => !!r.base && !isAbandoned(r.base, now, DAY_MS));
}

function helpFieldOf(own: Ownership, base: Base, wateredThisSlot: boolean): HelpField {
  return {
    fieldId: own.plantedAt,
    prefName: base.prefName,
    cityName: base.cityName,
    townName: base.townName,
    baseTypeId: base.baseTypeId,
    seedItemId: base.seedItemId,
    rank: base.rank,
    water: base.water ?? 0,
    fruits: base.fruits ?? 0,
    waitingSince: base.waitingSince ?? null,
    wateredThisSlot,
  };
}

async function listHelpFields(c: DataClient, helperId: string, ownerId: string): Promise<HelpField[]> {
  await requireHelpable(c, helperId, ownerId);
  const now = new Date();
  const today = slotKey(now, DAY_MS);
  const fields = await ownerFields(c, ownerId, now);
  const helps = await Promise.all(fields.map(({ base }) => c.models.GameTaneHelp.get({ helperId, areaKey: base.areaKey })));
  return fields
    .map(({ own, base }, i) => helpFieldOf(own, base, unwrap(helps[i])?.lastWaterOn === today))
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId));
}

/** 1つの畑に手伝いの水をやった結果 */
interface HelpWatered {
  field: HelpField;
  ripened: boolean;
  /** ご当地の畑が実って、持ち主に届いた次のご当地のタネ */
  localSeed: TaneLocalItem | null;
  /** 知らせに出す畑の名前(○○町の果樹園) */
  place: string;
  areaKey: string;
}

/**
 * 1つの畑に手伝いの水をやる(持ち主への知らせと、手伝った回数を足すのは呼ぶ側)。実っている・タネ待ちならエラー。
 * この時間帯にもう水をやっていれば null(水をやる前に条件付きで書くので、2台で同時に押しても水が入るのは1回分だけ)
 */
async function waterHelpField(c: DataClient, helperId: string, ownerId: string, own: Ownership, base: Base, now: Date): Promise<HelpWatered | null> {
  if ((base.fruits ?? 0) > 0) throw new Error("実っているので、水はいりません。現地で実をもらってください");
  if (isWaitingReplant(base)) throw new Error("タネ待ちの畑には水をやれません");
  if (!(await claimHelp(helperId, base.areaKey, slotKey(now, DAY_MS), now))) return null;

  const watered = await addWater(base.areaKey, WATER_REMOTE, WATER_TO_RIPE, fruitsWhenRipe(base.rank));
  const item = TANE_ITEM_BY_ID.get(base.seedItemId);
  const local = isLocalBaseTypeId(base.baseTypeId);
  let localSeed: TaneLocalItem | null = null;
  if (watered.ripened && item) {
    // 持ち主に生産者の取り分を1個届ける
    await takeFruit({ ...base, ownerId, ripenedAt: new Date().toISOString() }, ownerId, item.itemId, local);
    if (local) localSeed = await grantNextLocalSeed(c, ownerId, item.itemId, "ripened");
  }
  const next = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey })) ?? base;
  return {
    field: helpFieldOf(own, next, true),
    ripened: watered.ripened,
    localSeed,
    place: `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "タネ"}`,
    areaKey: base.areaKey,
  };
}

/** 手伝った回数を足す(Lambda が書く。足したあとの合計を返す) */
async function addHelpCount(c: DataClient, player: { userId: string; helpCount?: number | null }, n: number): Promise<number> {
  const helpCount = (player.helpCount ?? 0) + n;
  if (n > 0) unwrap(await c.models.GameTanePlayer.update({ userId: player.userId, helpCount }));
  return helpCount;
}

/**
 * 持ち主に、手伝ってもらったことを1つの知らせで伝える(まとめて水をやっても1つ)。
 * 名前は、手伝った人が持ち主に「農園を見せる」にしているときだけ
 */
async function notifyHelped(c: DataClient, helperId: string, ownerId: string, done: HelpWatered[]): Promise<void> {
  if (done.length === 0) return;
  const helperName = await visitorNameFor(c, helperId, ownerId);
  const who = helperName ? `${helperName}さん` : "誰か";
  const ripened = done.filter((d) => d.ripened);
  const localSeeds = done.flatMap((d) => (d.localSeed ? [d.localSeed.name] : []));
  const places = done.length === 1 ? done[0].place : `${done[0].place}など${done.length}か所`;
  const localText = localSeeds.length > 0 ? `。ご当地のタネ「${localSeeds.join("」「")}」が届きました！` : "";
  await notifyUsers(c, [ownerId], {
    ...(ripened.length > 0
      ? {
          title: "タネが実りました",
          body: `${who}が遠くから水をやって、${ripened.map((d) => d.place).join("・")}が実りました！ 生産者の取り分として実が${ripened.length}個届きました${
            done.length > ripened.length ? `（ほかに${done.length - ripened.length}か所にも水をやってくれました）` : ""
          }${localText}`,
        }
      : { title: "水やりを手伝ってもらいました", body: `${who}が${places}に遠くから水をやってくれました` }),
    url: "/game/chizu-tane",
    // 1か所なら畑ごと(新しい知らせが古いものを置き換える)、まとめてなら手伝った人ごと
    tag: done.length === 1 ? `tane-${done[0].areaKey}` : `tane-help-${helperId}`,
  });
}

/**
 * フォローしている人の畑に遠くから水をやる。持ち主の遠くからの水やりと同じく、1人が1つの畑に朝・昼・夜に1回で、効き目は現地の10分の1。
 * 実っている間とタネ待ちの間はできない。実ったら持ち主に生産者の取り分が1個届く(手伝った人は実をもらわない。実は現地で)。
 * 手伝った回数は HELPS_PER_VISIT 回で、たずねたタネ1か所としてレベルに数える
 */
async function helpWater(c: DataClient, helperId: string, ownerId: string, fieldId: string): Promise<HelpResult> {
  await requireHelpable(c, helperId, ownerId);
  const player = await requirePlayer(c, helperId);
  const now = new Date();
  const found = (await ownerFields(c, ownerId, now)).find((f) => f.own.plantedAt === fieldId);
  if (!found) throw new Error("この畑はもうありません。画面を読み直してください");
  const done = await waterHelpField(c, helperId, ownerId, found.own, found.base, now);
  if (!done) throw new Error("遠くからの水やりは、1つの畑に朝・昼・夜それぞれ1回です");
  const helpCount = await addHelpCount(c, player, 1);
  await notifyHelped(c, helperId, ownerId, [done]);
  const granted = await grantLevelSeeds(c, player);
  return {
    field: done.field,
    ripened: done.ripened,
    helpCount,
    level: granted.level,
    leveledUp: granted.gains.length > 0,
    seedsGained: JSON.stringify(granted.gains),
  };
}

/**
 * フォローしている人の畑のうち、水をやれる畑(実っていない・タネ待ちでない・この時間帯にまだ水をやっていない)に、まとめて水をやる。
 * 1か所ずつのときと同じ決まりで、持ち主への知らせは1つにまとめる
 */
async function helpWaterAll(c: DataClient, helperId: string, ownerId: string): Promise<HelpAllResult> {
  await requireHelpable(c, helperId, ownerId);
  const player = await requirePlayer(c, helperId);
  const now = new Date();
  const fields = await ownerFields(c, ownerId, now);
  const done: HelpWatered[] = [];
  const errors: string[] = [];
  for (const { own, base } of fields) {
    if ((base.fruits ?? 0) > 0 || isWaitingReplant(base)) continue;
    try {
      const res = await waterHelpField(c, helperId, ownerId, own, base, now);
      if (res) done.push(res);
    } catch (err) {
      errors.push(`${base.townName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const helpCount = await addHelpCount(c, player, done.length);
  await notifyHelped(c, helperId, ownerId, done);
  const granted = await grantLevelSeeds(c, player);
  return {
    fields: done.map((d) => d.field),
    watered: done.length,
    ripened: done.filter((d) => d.ripened).length,
    helpCount,
    level: granted.level,
    leveledUp: granted.gains.length > 0,
    seedsGained: JSON.stringify(granted.gains),
    errors,
  };
}

// ─── 公式の畑(2026-10-31。src/lib/game/chizuTane/official.ts) ────────────────────────────
// ほかの人の畑をたずねる練習。畑の育ちは1人ずつ別(GameTaneOfficialVisit)で、本物の畑と同じく
// 「チェックインで水をやる → 実ったら、実らせた人がそのまま実をもらう」「初めて来るとタネが1個落ちる(拾う)」。
// 二重に押されても1回分だけ進むよう、行は DynamoDB で直接、条件付きで書き換える(テーブル名と権限は amplify/backend.ts)

const OFFICIAL_VISIT_TABLE = process.env.CHIZU_TANE_OFFICIAL_VISIT_TABLE ?? "";
const ddb = new DynamoDBClient({});

/**
 * 公式の畑に遠くからチェックインする。使えるのはほかのコースの畑だけで、1つの畑に1つの時間帯(朝・昼・夜)に1回。
 * 初めての畑は1日3か所までで、たずねたタネ1か所と数え(レベルが上がることもある)、タネが1個落ちる。
 * 水をやり(OFFICIAL_WATER_PER_CHECKIN。本物の畑の現地と同じく5回で実る)、実ったら本物の畑と同じく、実らせた人がそのまま実を1個もらう
 * (それでこの畑はおしまい)。実ったまま残っている行(実ったら次のチェックインでもらう形だった 2026-10-31 の dev の行)は、チェックインで実をもらう
 */
async function checkInOfficial(c: DataClient, userId: string, fieldId: string): Promise<OfficialResult> {
  const player = await requirePlayer(c, userId);
  const field = officialFieldsFor(player.course as TaneCourse).find((f) => f.fieldId === fieldId);
  if (!field) throw new Error("この公式の畑にはチェックインできません");
  const now = new Date();
  const slot = slotKey(now, DAY_MS);
  const today = officialDayKey(now, DAY_MS);
  const visits = await listOfficialVisits(c, userId);
  const todayCount = visits.filter((v) => v.visitedOn === today).length;
  let row = visits.find((v) => v.fieldId === fieldId);
  if (row?.harvestedAt) throw new Error("この公式の畑の実は、もうもらいました");

  // 初めての畑: 行を作る(同時に2回押されても、2回目は同じ行を作れずに失敗する)
  const firstVisit = !row;
  if (!row) {
    if (todayCount >= OFFICIAL_DAILY_LIMIT) throw new Error(`新しい公式の畑に行けるのは1日${OFFICIAL_DAILY_LIMIT}か所までです。また明日どうぞ`);
    let created: (typeof visits)[number] | undefined;
    try {
      created = unwrap(
        await c.models.GameTaneOfficialVisit.create({
          userId,
          fieldId,
          visitedAt: now.toISOString(),
          visitedOn: today,
          water: 0,
          fruits: 0,
          droppedSeeds: 0,
        })
      ) ?? undefined;
    } catch {
      throw new Error("この公式の畑には、この時間帯はもう来ました");
    }
    if (!created) throw new Error("公式の畑にチェックインできませんでした");
    row = created;
  }

  const water = row.water ?? 0;
  const ripe = (row.fruits ?? 0) > 0;
  const nextWater = ripe ? water : water + OFFICIAL_WATER_PER_CHECKIN;
  const ripened = !ripe && nextWater >= WATER_TO_RIPE;
  const harvest = ripe || ripened;
  const result: OfficialResult = {
    status: ripe ? "fruit" : ripened ? "ripened" : "watered",
    itemId: field.item.itemId,
    water: nextWater,
    fruits: 0,
    droppedSeeds: (row.droppedSeeds ?? 0) + (firstVisit ? 1 : 0),
    firstVisit,
    quantity: null,
    todayCount: todayCount + (firstVisit ? 1 : 0),
    level: null,
    leveledUp: false,
    seedsGained: "[]",
  };
  const nowIso = now.toISOString();
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: OFFICIAL_VISIT_TABLE,
        Key: { userId: { S: userId }, fieldId: { S: fieldId } },
        UpdateExpression:
          "SET water = :water, fruits = :fruits, lastCheckInOn = :slot, updatedAt = :now" +
          (firstVisit ? ", droppedSeeds = :dropped" : "") +
          (harvest ? ", harvestedAt = :now" : ""),
        ConditionExpression: "attribute_exists(userId) AND (attribute_not_exists(lastCheckInOn) OR lastCheckInOn <> :slot)",
        ExpressionAttributeValues: {
          ":water": { N: String(result.water) },
          ":fruits": { N: String(result.fruits) },
          ":slot": { S: slot },
          ":now": { S: nowIso },
          ...(firstVisit ? { ":dropped": { N: String(result.droppedSeeds) } } : {}),
        },
      })
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    return { ...result, status: "already", water, fruits: row.fruits ?? 0, droppedSeeds: row.droppedSeeds ?? 0 };
  }

  if (harvest) {
    await giveFruit({ areaKey: `official#${fieldId}`, ownerId: OFFICIAL_OWNER_ID, ...OFFICIAL_PLACE }, userId, field.item.itemId);
    result.quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId: field.item.itemId }))?.quantity ?? 1;
  }
  if (firstVisit) {
    // 初めての畑は、たずねたタネの数が増えるのでレベルが上がることがある
    const granted = await grantLevelSeeds(c, player);
    result.level = granted.level;
    result.leveledUp = granted.gains.length > 0;
    result.seedsGained = JSON.stringify(granted.gains);
  }
  return result;
}

/** 公式の畑に落ちているタネを拾う(落ちているのは初めて来たときの1個だけ)。拾えた数を返す */
async function pickUpOfficialSeed(c: DataClient, userId: string, fieldId: string): Promise<number> {
  const field = TANE_OFFICIAL_FIELDS.find((f) => f.fieldId === fieldId);
  if (!field) throw new Error("この公式の畑はありません");
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: OFFICIAL_VISIT_TABLE,
        Key: { userId: { S: userId }, fieldId: { S: fieldId } },
        UpdateExpression: "SET droppedSeeds = droppedSeeds - :one, updatedAt = :now",
        ConditionExpression: "droppedSeeds >= :one",
        ExpressionAttributeValues: { ":one": { N: "1" }, ":now": { S: new Date().toISOString() } },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return 0;
    throw err;
  }
  await addSeeds(c, userId, field.item.itemId, 1);
  return 1;
}
