import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-player";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import { isTaneCourse, levelFor, seedsForLevel, type TaneCourse } from "../../../src/lib/game/chizuTane/courses";
import { addSeeds, countPlanted, countVisitedBases, plantedItemIds } from "../shared/chizuTane";
import {
  GARDEN_HEIGHT,
  GARDEN_WIDTH,
  countPlaced,
  isGardenDesignId,
  unlockedGardenDesigns,
  validateGardenObjects,
  type GardenDesignId,
  type GardenLayouts,
  type GardenObject,
} from "../../../src/lib/game/chizuTane/garden";

type Args = { course?: string; objects?: unknown; ownerId?: string; gardenId?: string | null };

/**
 * 地図タネの、始める(startTane)・箱庭を開く(openTaneGarden)・箱庭を保存する(saveTaneGarden)。
 * ほかの人のガーデンを見る(viewTaneGarden)も受ける。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(course があれば始める、ownerId があればほかの人のガーデンを見る、
 * objects があれば保存(gardenId のガーデン)、どれも無ければ開く)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { course, objects, ownerId } = event.arguments;

  if (course !== undefined && course !== null) return start(c, userId, course);
  if (typeof ownerId === "string") return viewGarden(c, userId, ownerId);

  const player = unwrap(await c.models.GameTanePlayer.get({ userId }));
  if (!player) throw new Error("先にコースを選んでください");
  const garden = unwrap(await c.models.GameTaneGarden.get({ userId }));
  if (!garden) throw new Error("ガーデンが見つかりません");
  const [owned, progress] = await Promise.all([listOwned(c, userId), gardenProgress(c, userId, player.course)]);

  let home = parseJson<GardenObject[]>(garden.objects);
  const layouts = parseJson<GardenLayouts | null>(garden.layouts) ?? {};
  if (objects !== undefined && objects !== null) {
    // 1つのガーデンを保存する。所持数は、ほかのガーデンに置いている分も合わせて数える
    const requested = event.arguments.gardenId ?? "home";
    if (!isGardenDesignId(requested)) throw new Error("ガーデンの指定が正しくありません");
    const gardenId: GardenDesignId = requested;
    if (!unlockedGardenDesigns(progress.plantedCount).some((d) => d.id === gardenId)) throw new Error("このガーデンはまだ使えません");
    const elsewhere = countPlaced([...(gardenId === "home" ? [] : home), ...Object.entries(layouts).flatMap(([id, objs]) => (id === gardenId ? [] : (objs ?? [])))]);
    const placed = validateGardenObjects(parseJson(objects), owned, elsewhere);
    if (gardenId === "home") {
      home = placed;
      unwrap(await c.models.GameTaneGarden.update({ userId, objects: JSON.stringify(placed) }));
    } else {
      layouts[gardenId] = placed;
      unwrap(await c.models.GameTaneGarden.update({ userId, layouts: JSON.stringify(layouts) }));
    }
  }
  return {
    width: garden.width,
    height: garden.height,
    objects: JSON.stringify(home),
    layouts: JSON.stringify(layouts),
    items: JSON.stringify([...owned].map(([itemId, quantity]) => ({ itemId, quantity }))),
    level: progress.level,
    plantedCount: progress.plantedCount,
  };
};

/** レベル(家と柵の見た目)と、まいたタネの数(使えるガーデン) */
async function gardenProgress(c: DataClient, userId: string, course: string): Promise<{ level: number; plantedCount: number }> {
  const [visited, planted, plantedCount] = await Promise.all([countVisitedBases(c, userId), plantedItemIds(c, userId), countPlanted(c, userId)]);
  return { level: levelFor(course as TaneCourse, visited, planted), plantedCount };
}

/** コースを決めて、最初のタネ(自分のコースの Lv.1 の種類のもの3つを1個ずつ)を渡し、空の箱庭を作る。もう始めていればそのまま返す */
async function start(c: DataClient, userId: string, course: string) {
  if (!isTaneCourse(course)) throw new Error("コースの指定が正しくありません");
  const existing = unwrap(await c.models.GameTanePlayer.get({ userId }));
  if (existing) return existing;

  for (const item of seedsForLevel(course, 1)) {
    if (!unwrap(await c.models.GameTaneHeldSeed.get({ userId, itemId: item.itemId }))) await addSeeds(c, userId, item.itemId, 1);
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

/**
 * ほかの人のガーデンを見る。持ち主が見る人に「農園を見せる」にしていて(GameTaneShare)、見る人が持ち主をフォローしているときだけ返す。
 * ガーデンの行は本人しか読めないので、ここで確かめてから中身を渡す
 */
async function viewGarden(c: DataClient, viewerId: string, ownerId: string) {
  if (viewerId === ownerId) throw new Error("自分のガーデンはガーデンの画面で見てください");
  const [share, follow] = await Promise.all([
    c.models.GameTaneShare.get({ ownerId, viewerId }),
    c.models.GameFollow.get({ followerId: viewerId, followeeId: ownerId }),
  ]);
  if (!unwrap(share) || !unwrap(follow)) throw new Error("この人のガーデンは見られません");
  const [garden, profile, player] = await Promise.all([
    c.models.GameTaneGarden.get({ userId: ownerId }),
    c.models.GameProfile.get({ userId: ownerId }),
    c.models.GameTanePlayer.get({ userId: ownerId }),
  ]);
  const g = unwrap(garden);
  const p = unwrap(player);
  if (!g || !p) throw new Error("この人はまだガーデンを作っていません");
  const progress = await gardenProgress(c, ownerId, p.course);
  return {
    nickname: unwrap(profile)?.nickname ?? null,
    width: g.width,
    height: g.height,
    objects: JSON.stringify(parseJson<GardenObject[]>(g.objects)),
    layouts: JSON.stringify(parseJson<GardenLayouts | null>(g.layouts) ?? {}),
    level: progress.level,
    plantedCount: progress.plantedCount,
  };
}
