import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-player";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import { isTaneCourse, seedsForLevel } from "../../../src/lib/game/chizuTane/courses";
import { addSeeds } from "../shared/chizuTane";
import { GARDEN_HEIGHT, GARDEN_WIDTH, validateGardenObjects, type GardenObject } from "../../../src/lib/game/chizuTane/garden";

type Args = { course?: string; objects?: unknown };

/**
 * 地図タネの、始める(startTane)・箱庭を開く(openTaneGarden)・箱庭を保存する(saveTaneGarden)。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(course があれば始める、objects があれば保存、どちらも無ければ開く)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { course, objects } = event.arguments;

  if (course !== undefined && course !== null) return start(c, userId, course);

  const player = unwrap(await c.models.GameTanePlayer.get({ userId }));
  if (!player) throw new Error("先にコースを選んでください");
  const garden = unwrap(await c.models.GameTaneGarden.get({ userId }));
  if (!garden) throw new Error("タネニワが見つかりません");
  const owned = await listOwned(c, userId);

  let placed: GardenObject[];
  if (objects === undefined || objects === null) {
    placed = parseJson<GardenObject[]>(garden.objects);
  } else {
    placed = validateGardenObjects(parseJson(objects), owned);
    unwrap(await c.models.GameTaneGarden.update({ userId, objects: JSON.stringify(placed) }));
  }
  return {
    width: garden.width,
    height: garden.height,
    objects: JSON.stringify(placed),
    items: JSON.stringify([...owned].map(([itemId, quantity]) => ({ itemId, quantity }))),
  };
};

/** コースを決めて、最初のタネ(自分のコースの Lv.1 の3種類を1個ずつ)を渡し、空の箱庭を作る。もう始めていればそのまま返す */
async function start(c: DataClient, userId: string, course: string) {
  if (!isTaneCourse(course)) throw new Error("コースの指定が正しくありません");
  const existing = unwrap(await c.models.GameTanePlayer.get({ userId }));
  if (existing) return existing;

  for (const t of seedsForLevel(course, 1)) {
    if (!unwrap(await c.models.GameTaneSeed.get({ userId, baseTypeId: t.id }))) await addSeeds(c, userId, t.id, 1);
  }
  if (!unwrap(await c.models.GameTaneGarden.get({ userId }))) {
    unwrap(await c.models.GameTaneGarden.create({ userId, width: GARDEN_WIDTH, height: GARDEN_HEIGHT, objects: "[]" }));
  }
  const player = unwrap(await c.models.GameTanePlayer.create({ userId, course, grantedLevel: 1 }));
  if (!player) throw new Error("始められませんでした");
  return player;
}

async function listOwned(c: DataClient, userId: string): Promise<Map<string, number>> {
  const owned = new Map<string, number>();
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneItem.list({ userId, nextToken });
    for (const item of unwrap(page)) owned.set(item.itemId, item.quantity);
    nextToken = page.nextToken;
  } while (nextToken);
  return owned;
}

/** a.json の値は二重に文字列化されて返ることがあるので、文字列である限り戻し続ける */
function parseJson<T = unknown>(value: unknown): T {
  let v = value;
  while (typeof v === "string") v = JSON.parse(v);
  return v as T;
}
