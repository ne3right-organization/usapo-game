import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-place";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  assertNotTooFast,
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
import { REPLANT_LIMIT_SLOTS, isAbandoned } from "../../../src/lib/game/chizuTane/growth";

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

/**
 * いまいる地区にタネ(拠点)をまく。1地区に1つ、早い者勝ち。タネ待ちのまま1週間たって空き地に戻った畑にもまける。
 * 持っているタネ(もの)を1つ使い、そのものの種類の拠点を作る(梨の木のタネ → 果樹園)。種類やレベルの制限は無い。
 * ランク1から始まり、実って収穫するたびに上がる(src/lib/game/chizuTane/growth.ts)
 */
async function place(c: DataClient, userId: string, args: LocateArgs & { itemId: string }) {
  const now = new Date();
  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const existing = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (existing && !isAbandoned(existing, now, DAY_MS)) throw new Error("この地区にはもうタネがあります");
  const item = TANE_ITEM_BY_ID.get(args.itemId);
  const baseType = item ? TANE_BASE_TYPE_BY_ID.get(item.baseTypeId) : undefined;
  if (!item || !baseType) throw new Error("そのタネはまけません");
  const seed = await requireHeldSeed(c, userId, item.itemId, item.name);

  // 空き地か、空き地に戻った畑のときだけ書ける(同時にまこうとしても、先に書いた方だけが通る)
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
    abandonedBefore(now)
  );
  if (!ok) throw new Error("この地区にはもうタネがあります");

  // 空き地に戻った畑なら、前の持ち主の行に「手放した」と書く(行は消さない。開拓した地区の数とまいたタネに数え続ける)
  if (existing) {
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
  return unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
}

/**
 * タネ待ちの自分の畑に、同じ種類の畑のタネをまき直す。遠くからでもよい(位置は使わない)。ランクはそのままで、タネから育ち直す。
 * まき直しは開拓した地区の数(ガーデン)には数えないが、まいたことのあるタネ(レベルの条件)には入る
 */
async function replant(c: DataClient, userId: string, areaKey: string, itemId: string) {
  const now = new Date();
  const player = await requirePlayer(c, userId);
  const own = unwrap(await c.models.GameTaneOwnership.get({ ownerId: userId, areaKey }));
  const base = unwrap(await c.models.GameTaneBase.get({ areaKey }));
  if (!own || own.releasedAt || !base) throw new Error("自分の畑にだけ、タネをまき直せます");
  if (!base.waitingSince) throw new Error("この畑はタネ待ちではありません（実が全部収穫されると、まき直せます）");
  if (isAbandoned(base, now, DAY_MS)) throw new Error("1週間たったので、この畑は空き地に戻りました");
  const item = TANE_ITEM_BY_ID.get(itemId);
  const typeName = TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "この畑";
  if (!item || item.baseTypeId !== base.baseTypeId) throw new Error(`${typeName}にまけるのは、${typeName}のタネだけです`);
  const seed = await requireHeldSeed(c, userId, item.itemId, item.name);

  if (!(await replantBaseRow(areaKey, item.itemId, abandonedBefore(now)))) {
    throw new Error("タネをまき直せませんでした。画面を読み直してください");
  }
  unwrap(await c.models.GameTaneOwnership.update({ ownerId: userId, areaKey, seedItemId: item.itemId, pastSeedItemIds: withPastSeed(own) }));
  unwrap(await c.models.GameTaneHeldSeed.update({ userId, itemId: item.itemId, quantity: seed.quantity - 1 }));
  // 新しい種類のタネをまいたことで、レベルの条件がそろうことがある
  await grantLevelSeeds(c, player);
  return unwrap(await c.models.GameTaneBase.get({ areaKey }));
}
