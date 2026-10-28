// 地図タネの箱庭(画面では「タネニワ」)の配置データと、その検証。画面と Lambda の両方から使う
import { TANE_ITEM_BY_ID } from "./courses";

/** 箱庭の広さ(マス)。仮の値 */
export const GARDEN_WIDTH = 10;
export const GARDEN_HEIGHT = 10;

/**
 * 箱庭に置いた1個。画像は持たず、アイテムIDとマスの位置だけ(画像を差し替えても配置データはそのまま)。
 * 1マスに1個まで。重なり順は奥(x+y が小さい)から描けば決まるので持たない
 */
export interface GardenObject {
  objectId: string;
  itemId: string;
  x: number;
  y: number;
}

/** アイテムごとに、いくつ箱庭に置いているか */
export function countPlaced(objects: readonly GardenObject[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(o.itemId, (counts.get(o.itemId) ?? 0) + 1);
  return counts;
}

const MAX_OBJECT_ID_LENGTH = 64;

/**
 * クライアントから来た配置を確かめて、余計な項目を落としたものを返す。おかしければ例外。
 * 存在するアイテムか・マスの範囲内か・1マス1個か・所持数を超えていないか
 */
export function validateGardenObjects(input: unknown, owned: ReadonlyMap<string, number>): GardenObject[] {
  if (!Array.isArray(input)) throw new Error("配置データの形が正しくありません");
  if (input.length > GARDEN_WIDTH * GARDEN_HEIGHT) throw new Error("置けるのは1マスに1個までです");

  const cells = new Set<string>();
  const objectIds = new Set<string>();
  const result: GardenObject[] = [];
  for (const raw of input) {
    const o = raw as Partial<GardenObject> | null;
    if (!o || typeof o.objectId !== "string" || o.objectId === "" || o.objectId.length > MAX_OBJECT_ID_LENGTH || objectIds.has(o.objectId)) {
      throw new Error("配置データの形が正しくありません");
    }
    objectIds.add(o.objectId);

    const item = typeof o.itemId === "string" ? TANE_ITEM_BY_ID.get(o.itemId) : undefined;
    if (!item) throw new Error("存在しないものが含まれています");

    const x = o.x as number;
    const y = o.y as number;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GARDEN_WIDTH || y >= GARDEN_HEIGHT) {
      throw new Error("タネニワの外に置かれています");
    }
    const cell = `${x},${y}`;
    if (cells.has(cell)) throw new Error("1つのマスに置けるのは1個までです");
    cells.add(cell);

    result.push({ objectId: o.objectId, itemId: item.itemId, x, y });
  }

  for (const [itemId, count] of countPlaced(result)) {
    if (count > (owned.get(itemId) ?? 0)) {
      throw new Error(`「${TANE_ITEM_BY_ID.get(itemId)?.name ?? itemId}」を持っている数より多く置いています`);
    }
  }
  return result;
}
