import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-place";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  assertNotTooFast,
  baseOwnerId,
  grantLevelSeeds,
  locateTownDistrict,
  putNewBase,
  rememberPosition,
  replantBaseRow,
  requirePlayer,
  type LocateArgs,
} from "../shared/chizuTane";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { DAY_MS_PRODUCTION } from "../../../src/lib/game/chizuTane/geo";
import { REPLANT_LIMIT_SLOTS, isAbandoned, openToOthersAt } from "../../../src/lib/game/chizuTane/growth";
import { notifyUsers } from "../shared/push";
import { TANE_LOCAL_ITEM_BY_ID, TANE_LOCAL_PREFS, isLocalBaseTypeId } from "../../../src/lib/game/chizuTane/localItems";

// 区切りの長さ(本番は朝・昼・夜の8時間、それ以外は5分)。タネ待ちの畑が空き地に戻るまでは REPLANT_LIMIT_SLOTS 区切り
const DAY_MS = Number(process.env.CHIZU_TANE_DAY_MS ?? DAY_MS_PRODUCTION);

type Args = Partial<LocateArgs> & { itemId: string; areaKey?: string };

/**
 * 地図タネで、いまいる地区にタネ(拠点)をまく(placeTaneBase)と、タネ待ちの自分の畑にまき直す(replantTaneBase)。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(areaKey があればまき直し)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { areaKey, itemId } = event.arguments;
  if (typeof areaKey === "string") return replant(c, userId, areaKey, itemId);
  return place(c, userId, event.arguments as LocateArgs & { itemId: string });
};

/** 空き地に戻ったとみなす境目(これより前からタネ待ちの畑は空き地) */
function abandonedBefore(now: Date): string {
  return new Date(now.getTime() - REPLANT_LIMIT_SLOTS * DAY_MS).toISOString();
}

async function requireHeldSeed(c: DataClient, userId: string, itemId: string, name: string) {
  const seed = unwrap(await c.models.GameTaneHeldSeed.get({ userId, itemId }));
  if (!seed || seed.quantity < 1) throw new Error(`「${name}」のタネを持っていません`);
  return seed;
}

/** 前にまいたタネの一覧に、いままいていたタネを足したもの */
function withPastSeed(own: { seedItemId: string; pastSeedItemIds?: (string | null)[] | null }): string[] {
  return [...new Set([...(own.pastSeedItemIds ?? []).filter((x): x is string => !!x), own.seedItemId])];
}

/** 日時を「11月2日 14:30」の形に(日本時間) */
function jstLabel(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * いまいる地区にタネ(拠点)をまく。1地区に1つ、早い者勝ち。タネ待ちのまま1週間たって空き地に戻った畑にもまける。
 * タネ待ちの畑は、持ち主がまき直さないまま1日たつと、現地に来たほかの人もまけて、まいた人の畑になる
 * (growth.ts の OWNER_PRIORITY_SLOTS。前の持ち主は手放したことになり、通知で知らせる)。
 * 持っているタネ(もの)を1つ使い、そのものの種類の拠点を作る(梨の木のタネ → 果樹園)。種類やレベルの制限は無い。
 * ランク1から始まり、実って収穫するたびに上がる(src/lib/game/chizuTane/growth.ts)。
 * 1個目のご当地のタネは、その都道府県でしかまけない(旅の記念。docs/地図タネ_ご当地タネ設計書.md の 3章)
 */
async function place(c: DataClient, userId: string, args: LocateArgs & { itemId: string }) {
  const now = new Date();
  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const found = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  // 空き地に戻った畑は、無いのと同じ
  const existing = found && !isAbandoned(found, now, DAY_MS) ? found : null;
  // タネ待ちの畑に、ほかの人として(持ち主から取って)まくときの前の持ち主
  let previousOwnerId: string | null = null;
  // ほかの人もまけるようになった境目(これより前からタネ待ちの畑にまける)
  let waitingBefore = abandonedBefore(now);
  if (existing) {
    if (!existing.waitingSince) throw new Error("この地区にはもうタネがあります");
    previousOwnerId = await baseOwnerId(c, existing.areaKey);
    if (previousOwnerId === userId) throw new Error("自分の畑は、ホームかこの画面の「タネをまき直す」からまき直してください");
    const openAt = openToOthersAt(existing, DAY_MS)!;
    if (openAt.getTime() > now.getTime()) {
      throw new Error(`持ち主がまき直すのを待っています。${jstLabel(openAt)}から、あなたのタネもまけるようになります`);
    }
    waitingBefore = openAt.toISOString();
  }
  const item = TANE_ITEM_BY_ID.get(args.itemId);
  const baseType = item ? TANE_BASE_TYPE_BY_ID.get(item.baseTypeId) : undefined;
  if (!item || !baseType) throw new Error("そのタネはまけません");
  const local = TANE_LOCAL_ITEM_BY_ID.get(item.itemId);
  if (local && local.rank === 1 && local.local !== district.prefCode) {
    const prefName = TANE_LOCAL_PREFS.find((p) => p.prefCode === local.local)?.prefName ?? "その都道府県";
    throw new Error(`「${item.name}」のタネは、${prefName}でしかまけません`);
  }
  // ご当地のタネは空き地にだけまける(ほかの人のタネ待ちの畑を取るのには使えない)
  if (local && existing) throw new Error("ご当地のタネは、空き地にだけまけます");
  const seed = await requireHeldSeed(c, userId, item.itemId, item.name);

  // 空き地か、空き地に戻った畑か、ほかの人もまけるようになったタネ待ちの畑のときだけ書ける
  // (同時にまこうとしても、持ち主のまき直しとも、先に書いた方だけが通る)
  const ok = await putNewBase(
    {
      areaKey: district.areaKey,
      cityKey: `${district.prefCode}${district.cityCode}`,
      prefCode: district.prefCode,
      prefName: district.prefName,
      cityCode: district.cityCode,
      cityName: district.cityName,
      townName: district.townName,
      baseTypeId: baseType.id,
      seedItemId: item.itemId,
      repLng: district.repLng,
      repLat: district.repLat,
    },
    // ちょうど境目の時刻でも通るよう、1ミリ秒あとにする
    new Date(Date.parse(waitingBefore) + 1).toISOString()
  );
  if (!ok) throw new Error("この地区にはもうタネがあります（先にまき直されたかもしれません）");

  // 前にまかれていた畑(空き地に戻った・タネ待ちの)なら、前の持ち主の行に「手放した」と書く
  // (行は消さない。開拓した地区の数とまいたタネに数え続ける)
  if (found) {
    for (const row of unwrap(await c.models.GameTaneOwnership.listTaneOwnershipByArea({ areaKey: district.areaKey }))) {
      if (!row.releasedAt && row.ownerId !== userId) {
        unwrap(await c.models.GameTaneOwnership.update({ ownerId: row.ownerId, areaKey: row.areaKey, releasedAt: now.toISOString() }));
      }
    }
  }
  // 持ち主は、本人しか読めない別の行に持つ(拠点の行は誰でも読めるので持ち主を書かない)。
  // 前に自分が開拓して手放した地区なら、その行を使い直す(開拓した地区の数は増えない)
  const mine = unwrap(await c.models.GameTaneOwnership.get({ ownerId: userId, areaKey: district.areaKey }));
  unwrap(
    mine
      ? await c.models.GameTaneOwnership.update({
          ownerId: userId,
          areaKey: district.areaKey,
          seedItemId: item.itemId,
          pastSeedItemIds: withPastSeed(mine),
          plantedAt: now.toISOString(),
          releasedAt: null,
        })
      : await c.models.GameTaneOwnership.create({ ownerId: userId, areaKey: district.areaKey, seedItemId: item.itemId, plantedAt: now.toISOString() })
  );
  unwrap(await c.models.GameTaneHeldSeed.update({ userId, itemId: item.itemId, quantity: seed.quantity - 1 }));
  // 今のレベルのタネを3つともまき終えたら、たずねた数しだいでレベルが上がり、次のタネがもらえる
  await grantLevelSeeds(c, player);

  await rememberPosition(c, userId, district, now);

  // タネ待ちの畑をほかの人が取ったら、前の持ち主に知らせる(まいた人の名前は出さない)
  if (existing && previousOwnerId) {
    const place = `${existing.townName}の${TANE_BASE_TYPE_BY_ID.get(existing.baseTypeId)?.name ?? "畑"}`;
    await notifyUsers(c, [previousOwnerId], {
      title: "畑がほかの人の畑になりました",
      body: `タネ待ちのまままき直さなかった${place}に、現地に来た人がタネをまきました`,
      url: "/game/chizu-tane",
      tag: `tane-${existing.areaKey}`,
    });
  }
  return unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
}

/**
 * タネ待ちの自分の畑に、タネをまき直す。遠くからでもよい(位置は使わない)。ランクはそのままで、タネから育ち直す。
 * どのタネでもよく(2026-11-02 までは同じ種類の畑のタネだけ)、畑はまいたタネの種類になる。ご当地のタネは空き地にだけまける。
 * まき直しは開拓した地区の数(ガーデン)には数えないが、まいたことのあるタネ(レベルの条件)には入る
 */
async function replant(c: DataClient, userId: string, areaKey: string, itemId: string) {
  const now = new Date();
  const player = await requirePlayer(c, userId);
  const own = unwrap(await c.models.GameTaneOwnership.get({ ownerId: userId, areaKey }));
  const base = unwrap(await c.models.GameTaneBase.get({ areaKey }));
  if (own?.releasedAt) throw new Error("この畑は、ほかの人のタネがまかれて、その人の畑になりました");
  if (!own || !base) throw new Error("自分の畑にだけ、タネをまき直せます");
  if (!base.waitingSince) throw new Error("この畑はタネ待ちではありません（実が全部収穫されると、まき直せます）");
  if (isLocalBaseTypeId(base.baseTypeId)) throw new Error("ご当地の畑はまき直せません（1回かぎりの畑です）");
  if (isAbandoned(base, now, DAY_MS)) throw new Error("1週間たったので、この畑は空き地に戻りました");
  const item = TANE_ITEM_BY_ID.get(itemId);
  if (!item || !TANE_BASE_TYPE_BY_ID.has(item.baseTypeId)) throw new Error("そのタネはまけません");
  if (TANE_LOCAL_ITEM_BY_ID.has(item.itemId)) throw new Error("ご当地のタネは、空き地にだけまけます");
  const seed = await requireHeldSeed(c, userId, item.itemId, item.name);

  if (!(await replantBaseRow(areaKey, item.itemId, item.baseTypeId, abandonedBefore(now)))) {
    throw new Error("タネをまき直せませんでした。画面を読み直してください");
  }
  unwrap(await c.models.GameTaneOwnership.update({ ownerId: userId, areaKey, seedItemId: item.itemId, pastSeedItemIds: withPastSeed(own) }));
  unwrap(await c.models.GameTaneHeldSeed.update({ userId, itemId: item.itemId, quantity: seed.quantity - 1 }));
  // 新しい種類のタネをまいたことで、レベルの条件がそろうことがある
  await grantLevelSeeds(c, player);
  return unwrap(await c.models.GameTaneBase.get({ areaKey }));
}
