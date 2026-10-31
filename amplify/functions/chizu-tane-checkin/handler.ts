import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-checkin";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addSeeds,
  addWater,
  assertNotTooFast,
  baseOwnerId,
  dropSeed,
  giveFruit,
  grantLevelSeeds,
  grantNextLocalSeed,
  listOfficialVisits,
  locateTownDistrict,
  rememberPosition,
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
type OfficialResult = Schema["TaneOfficialResult"]["type"];
type Args = Partial<LocateArgs> & { areaKey?: string; ownerId?: string; fieldId?: string };

/**
 * 地図タネの、現地のチェックイン(checkInTaneBase)・遠くからの水やり(waterTaneBaseRemotely)・
 * フォローしている人の畑の一覧(listTaneHelpFields)とその畑への手伝いの水やり(helpWaterTaneBase)・公式の畑へのチェックイン(checkInTaneOfficialField)。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(areaKey があれば遠くからの水やり、ownerId と fieldId があれば手伝い、
 * fieldId だけなら公式の畑、ownerId だけなら畑の一覧)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { areaKey, ownerId, fieldId } = event.arguments;
  if (typeof areaKey === "string") return waterRemotely(c, userId, areaKey);
  if (typeof ownerId === "string" && typeof fieldId === "string") return helpWater(c, userId, ownerId, fieldId);
  if (typeof fieldId === "string") return checkInOfficial(c, userId, fieldId);
  if (typeof ownerId === "string") return listHelpFields(c, userId, ownerId);
  return checkIn(c, userId, event.arguments as LocateArgs);
};

/**
 * 現地のチェックイン。持ち主でもほかの人でも同じで、1人1つの時間帯(朝・昼・夜)に1回(dev は5分ごと)。まいた直後からできる。
 * - 実が残っていれば、実を1個もらう(早い者勝ち)。最後の1個ならランクが1つ上がり、タネ待ちになる(持ち主がまき直すまで育たない)
 * - タネ待ちの畑では、水も実も無い(ほかの人の初めてのチェックインなら、タネが落ちて訪問にも数える)。1週間たって空き地に戻った畑は無いのと同じ
 * - 実っていなければ、水をやる(現地は10)。たまったら実って、実ができる(ランク×10個)。実ったら、持ち主に「生産者の取り分」が1個届き、
 *   ほかの人が実らせたときは、実らせた人もそのまま1個もらう(持ち主が自分で実らせたときは取り分の1個だけ)
 * - ほかの人のタネに初めてチェックインしたときだけ、拠点にタネが1個落ちる(3個まで。直接はもらわず、拾うかどうかは選べる)。
 *   たずねた拠点の数が増えるので、レベルが上がることもある(自分のタネは訪問の記録に残さず、レベルにも数えない)
 * - ご当地の畑(docs/地図タネ_ご当地タネ設計書.md の 4章)は、実が1つの品につき1人1個(もう持っている人には渡さない)で、タネは落ちない。
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

  // 1つの時間帯に1回(自分の拠点は拠点の行に、ほかの人の拠点は訪問の記録に、最後に来た時間帯を持つ)
  const visit = isOwn ? null : unwrap(await c.models.GameTaneVisit.get({ userId, areaKey: base.areaKey }));
  const lastOn = isOwn ? base.lastOwnerVisitOn : visit?.lastReceivedOn;
  if (lastOn === today) {
    if (visit) unwrap(await c.models.GameTaneVisit.update({ userId, areaKey: base.areaKey, visitCount: visit.visitCount + 1 }));
    return result;
  }

  // 実が残っていれば実を1個、無ければ水をやる(タネ待ちなら何もしない)
  if (waiting) {
    result.status = "waiting";
  } else if ((base.fruits ?? 0) > 0) {
    // ご当地の実は1つの品につき1人1個。もう持っていれば渡さない(実はほかの人のために残る)
    const have = local && !!unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }));
    const left = have ? null : await takeFruit({ ...base, ownerId }, userId, picked.itemId, local);
    if (have) result.status = "have";
    if (left !== null) {
      result.status = "fruit";
      result.gainedItems = 1;
      result.fruits = left;
      result.quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId: picked.itemId }))?.quantity ?? 1;
      if (left === 0) {
        const rank = Math.min(MAX_RANK, base.rank + 1);
        await resetAfterFruits(base.areaKey, rank);
        result.rank = rank;
        result.water = 0;
        result.stage = 0;
        if (local) localSeed = await grantNextLocalSeed(c, ownerId, picked.itemId, "harvested");
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
    unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastOwnerVisitOn: today }));
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
          ? `${who}が${place}の最後の実を収穫しました。${localSeedText}ご当地の畑はまき直せないので、1週間で空き地に戻ります`
          : `${who}が${place}の最後の実を収穫しました。畑のランクが${result.rank}に上がりました。1週間以内にタネをまき直してください（まかないと空き地に戻ります）`,
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

  // ほかの人のタネに初めて来たときだけ、拠点にタネが1個落ちる(直接はもらわない。要らなければ拾わずに置いていける)
  const seedsGained: SeedGain[] = [];
  if (!visit) {
    result.firstVisit = true;
    // 落とすのは DynamoDB の条件付きの書き込み(3個未満のときだけ増やす)。同時にチェックインしても数がずれない。
    // ご当地の畑には落ちない(ご当地のタネは、決まった3つの方法でしか増えない)
    if (!local) for (let i = 0; i < SEEDS_PER_CHECKIN; i++) await dropSeed(base.areaKey, DROPPED_SEEDS_MAX);
    result.droppedSeeds = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey }))?.droppedSeeds ?? 0;
  }
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
  result.level = granted.level;
  result.leveledUp = granted.gains.length > 0;
  result.seedsGained = JSON.stringify(seedsGained);
  return result;
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
  if (base.lastRemoteWaterOn === today) throw new Error("遠くからの水やりは、1つのタネに朝・昼・夜それぞれ1回です");
  unwrap(await c.models.GameTaneBase.update({ areaKey, lastRemoteWaterOn: today }));
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

/**
 * フォローしている人の畑に遠くから水をやる。持ち主の遠くからの水やりと同じく、1人が1つの畑に朝・昼・夜に1回で、効き目は現地の10分の1。
 * 実っている間とタネ待ちの間はできない。実ったら持ち主に生産者の取り分が1個届く(手伝った人は実をもらわない。実は現地で)。
 * 手伝った回数は HELPS_PER_VISIT 回で、たずねたタネ1か所としてレベルに数える
 */
async function helpWater(c: DataClient, helperId: string, ownerId: string, fieldId: string): Promise<HelpResult> {
  await requireHelpable(c, helperId, ownerId);
  const player = await requirePlayer(c, helperId);
  const now = new Date();
  const today = slotKey(now, DAY_MS);
  const found = (await ownerFields(c, ownerId, now)).find((f) => f.own.plantedAt === fieldId);
  if (!found) throw new Error("この畑はもうありません。画面を読み直してください");
  const { own, base } = found;
  if ((base.fruits ?? 0) > 0) throw new Error("実っているので、水はいりません。現地で実をもらってください");
  if (isWaitingReplant(base)) throw new Error("タネ待ちの畑には水をやれません");
  const help = unwrap(await c.models.GameTaneHelp.get({ helperId, areaKey: base.areaKey }));
  if (help?.lastWaterOn === today) throw new Error("遠くからの水やりは、1つの畑に朝・昼・夜それぞれ1回です");
  unwrap(
    help
      ? await c.models.GameTaneHelp.update({ helperId, areaKey: base.areaKey, lastWaterOn: today })
      : await c.models.GameTaneHelp.create({ helperId, areaKey: base.areaKey, lastWaterOn: today })
  );
  const helpCount = (player.helpCount ?? 0) + 1;
  unwrap(await c.models.GameTanePlayer.update({ userId: helperId, helpCount }));

  const watered = await addWater(base.areaKey, WATER_REMOTE, WATER_TO_RIPE, fruitsWhenRipe(base.rank));
  const item = TANE_ITEM_BY_ID.get(base.seedItemId);
  const local = isLocalBaseTypeId(base.baseTypeId);
  let localSeed: TaneLocalItem | null = null;
  if (watered.ripened && item) {
    // 持ち主に生産者の取り分を1個届ける
    await takeFruit({ ...base, ownerId, ripenedAt: new Date().toISOString() }, ownerId, item.itemId, local);
    if (local) localSeed = await grantNextLocalSeed(c, ownerId, item.itemId, "ripened");
  }

  // 持ち主に知らせる(名前は、手伝った人が持ち主に「農園を見せる」にしているときだけ)
  const place = `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "タネ"}`;
  const helperName = await visitorNameFor(c, helperId, ownerId);
  const who = helperName ? `${helperName}さん` : "誰か";
  await notifyUsers(c, [ownerId], {
    ...(watered.ripened
      ? {
          title: "タネが実りました",
          body: `${who}が遠くから水をやって、${place}が実りました！ 生産者の取り分として実が1個届きました${localSeed ? `。ご当地のタネ「${localSeed.name}」が届きました！` : ""}`,
        }
      : { title: "水やりを手伝ってもらいました", body: `${who}が${place}に遠くから水をやってくれました` }),
    url: "/game/chizu-tane",
    tag: `tane-${base.areaKey}`,
  });

  const granted = await grantLevelSeeds(c, player);
  const next = unwrap(await c.models.GameTaneBase.get({ areaKey: base.areaKey })) ?? base;
  return {
    field: helpFieldOf(own, next, true),
    ripened: watered.ripened,
    helpCount,
    level: granted.level,
    leveledUp: granted.gains.length > 0,
    seedsGained: JSON.stringify(granted.gains),
  };
}

// ─── 公式の畑(2026-10-31。src/lib/game/chizuTane/official.ts) ────────────────────────────

/**
 * 公式の畑に遠くからチェックインして、実とそのタネを1個ずつもらう(タネはほかのコースのものでも、おでかけでまける)。使えるのはほかのコースの畑だけで、1人1か所に1回、新しい公式の畑は1日3か所まで。
 * チェックインした公式の畑はたずねたタネ1か所と数えるので、レベルが上がることもある
 */
async function checkInOfficial(c: DataClient, userId: string, fieldId: string): Promise<OfficialResult> {
  const player = await requirePlayer(c, userId);
  const field = officialFieldsFor(player.course as TaneCourse).find((f) => f.fieldId === fieldId);
  if (!field) throw new Error("この公式の畑にはチェックインできません");
  const now = new Date();
  const today = officialDayKey(now, DAY_MS);
  const visits = await listOfficialVisits(c, userId);
  if (visits.some((v) => v.fieldId === fieldId)) throw new Error("この公式の畑にはもうチェックインしました");
  const todayCount = visits.filter((v) => v.visitedOn === today).length;
  if (todayCount >= OFFICIAL_DAILY_LIMIT) throw new Error(`公式の畑は1日${OFFICIAL_DAILY_LIMIT}か所までです。また明日どうぞ`);

  // 先に記録を作る(同時に2回押されても、2回目は同じ行を作れずに失敗するので、実を2個渡さない)
  try {
    unwrap(await c.models.GameTaneOfficialVisit.create({ userId, fieldId, visitedAt: now.toISOString(), visitedOn: today }));
  } catch {
    throw new Error("この公式の畑にはもうチェックインしました");
  }
  const itemId = field.item.itemId;
  await giveFruit({ areaKey: `official#${fieldId}`, ownerId: OFFICIAL_OWNER_ID, ...OFFICIAL_PLACE }, userId, itemId);
  await addSeeds(c, userId, itemId, 1);
  const quantity = unwrap(await c.models.GameTaneItem.get({ userId, itemId }))?.quantity ?? 1;
  const granted = await grantLevelSeeds(c, player);
  const seedsGained: SeedGain[] = [{ itemId, count: 1, reason: "official" }, ...granted.gains];
  return {
    itemId,
    quantity,
    todayCount: todayCount + 1,
    level: granted.level,
    leveledUp: granted.gains.length > 0,
    seedsGained: JSON.stringify(seedsGained),
  };
}
