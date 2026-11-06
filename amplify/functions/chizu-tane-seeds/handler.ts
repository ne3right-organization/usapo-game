import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-seeds";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import {
  addSeeds,
  assertNotTooFast,
  claimGachaDay,
  countVisitedBases,
  giveFruit,
  locateTownDistrict,
  plantedItemIds,
  releaseGachaDay,
  rememberPosition,
  requirePlayer,
  takeDroppedSeeds,
  type LocateArgs,
} from "../shared/chizuTane";
import { DROPPED_SEEDS_MAX, levelFor, type TaneCourse } from "../../../src/lib/game/chizuTane/courses";
import { GACHA_OWNER_ID, GACHA_PLACE, drawGacha, gachaDayKey } from "../../../src/lib/game/chizuTane/gacha";
import { DAY_MS_PRODUCTION } from "../../../src/lib/game/chizuTane/geo";
import { LOCAL_SEED_MIN_LEVEL, localItemFor } from "../../../src/lib/game/chizuTane/localItems";

// 区切りの長さ(本番は朝・昼・夜の8時間、それ以外は5分)。毎日のガチャは、本番は日本時間の日付、それ以外はこの区切りで1回
const DAY_MS = Number(process.env.CHIZU_TANE_DAY_MS ?? DAY_MS_PRODUCTION);

type Args = Partial<LocateArgs> & { count?: number; gacha?: boolean };

/**
 * 地図タネの、落ちているタネを拾う(pickUpTaneSeeds)と、1個目のご当地のタネをもらう(claimLocalTaneSeed)と、毎日のガチャ(drawTaneGacha)。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(gacha があればガチャ、count があれば拾う)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { count, gacha } = event.arguments;
  if (gacha === true) return draw(c, userId);
  if (count !== undefined && count !== null) return pickUp(c, userId, event.arguments as LocateArgs, count);
  return claimLocal(c, userId, event.arguments as LocateArgs);
};

/**
 * いまいる地区のタネ(拠点)に落ちているタネを、選んだ数だけ拾う。誰でも(持ち主でもほかの人でも、自分が落とした分も)
 * 早い者勝ちで拾える。拾えた数を返す(先にほかの人が拾って足りなければ0)
 */
async function pickUp(c: DataClient, userId: string, args: LocateArgs, count: number): Promise<number> {
  const now = new Date();
  if (!Number.isInteger(count) || count < 1 || count > DROPPED_SEEDS_MAX) throw new Error("拾う数の指定が正しくありません");

  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);

  const base = unwrap(await c.models.GameTaneBase.get({ areaKey: district.areaKey }));
  if (!base) throw new Error("この地区にはまだタネがありません");
  await rememberPosition(c, userId, district, now);

  // 拠点から減らすのと自分のタネに足すのは1つのトランザクション(同時に拾っても数がずれず、途中で消えることも無い)
  return (await takeDroppedSeeds(base.areaKey, userId, base.seedItemId, count)) ? count : 0;
}

/**
 * いまいる都道府県の1個目のご当地のタネ(自分のコースのもの)を1個もらう。Lv.3 以上で、1人1都道府県に1回だけ。
 * その都道府県にほかの人の畑が無くてもよい。もらったタネの itemId を返す(docs/地図タネ_ご当地タネ設計書.md の 3章)
 */
async function claimLocal(c: DataClient, userId: string, args: LocateArgs): Promise<string> {
  const now = new Date();
  const district = await locateTownDistrict(args);
  const player = await requirePlayer(c, userId);
  assertNotTooFast(player, district, now);
  if ((player.grantedLevel ?? 1) < LOCAL_SEED_MIN_LEVEL) throw new Error(`ご当地のタネは Lv.${LOCAL_SEED_MIN_LEVEL} からもらえます`);
  const course = player.course as TaneCourse;
  const item = localItemFor(district.prefCode, course, 1);
  if (!item) throw new Error(`${district.prefName}のご当地のタネは、まだ用意していません`);
  await rememberPosition(c, userId, district, now);

  if (unwrap(await c.models.GameTaneLocalGrant.get({ userId, prefCode: district.prefCode }))) {
    throw new Error(`${district.prefName}のご当地のタネは、もうもらいました`);
  }
  // 行を作るのは「無いときだけ」なので、同時に押しても2回は渡らない(2回目は作れずに失敗する)
  unwrap(await c.models.GameTaneLocalGrant.create({ userId, prefCode: district.prefCode, course, firstAt: now.toISOString() }));
  await addSeeds(c, userId, item.itemId, 1);
  return item.itemId;
}

/**
 * 毎日のガチャを引く(src/lib/game/chizuTane/gacha.ts)。1日1回で、タネか実が1つ出る(まれになぞのタネ)。
 * 引いた印を先に条件付きで書くので、2台で同時に押しても1回分だけ。渡せなかったら印を消して、もう一度引けるようにする
 */
async function draw(c: DataClient, userId: string) {
  const player = await requirePlayer(c, userId);
  const now = new Date();
  const dayKey = gachaDayKey(now, DAY_MS);
  if (!(await claimGachaDay(userId, dayKey))) throw new Error("今日のガチャはもう引きました。また明日引けます");
  const [visited, planted] = await Promise.all([countVisitedBases(c, userId), plantedItemIds(c, userId)]);
  const prize = drawGacha(levelFor(player.course as TaneCourse, visited, planted));
  try {
    if (prize.kind === "seed") await addSeeds(c, userId, prize.item.itemId, 1);
    else await giveFruit({ areaKey: `gacha#${dayKey}`, ownerId: GACHA_OWNER_ID, ...GACHA_PLACE }, userId, prize.item.itemId);
  } catch (err) {
    await releaseGachaDay(userId, dayKey);
    throw err;
  }
  return { kind: prize.kind, itemId: prize.item.itemId, mystery: prize.mystery, dayKey };
}
