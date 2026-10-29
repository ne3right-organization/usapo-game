// 地図タネの箱庭(画面では「ガーデン」)の配置データと、その検証。画面と Lambda の両方から使う
import { TANE_ITEM_BY_ID } from "./courses";

// ─── ガーデンのデザインと家の段階 ───────────────────────────────────────────
// ガーデンは、まいたタネの数に応じて別のデザインのものが増える(はじめは「おうちの庭」だけ)。
// 家と柵は、ユーザーのレベルに応じて立派になる(小屋 → 家 → 2階建て → お屋敷)。どのガーデンも同じ家と柵。
// 見た目の一覧は管理画面 /admin/chizu-tane/gardens、条件の一覧は /admin/chizu-tane/levels

export type GardenDesignId = "home" | "flower" | "seaside" | "forest";

export interface GardenDesign {
  id: GardenDesignId;
  name: string;
  emoji: string;
  /** このデザインのガーデンが増える、まいたタネの数 */
  unlockPlanted: number;
}

export const GARDEN_DESIGNS: GardenDesign[] = [
  { id: "home", name: "おうちの庭", emoji: "🏡", unlockPlanted: 0 },
  { id: "flower", name: "花の丘", emoji: "🌸", unlockPlanted: 10 },
  { id: "seaside", name: "海辺の庭", emoji: "🏖️", unlockPlanted: 30 },
  { id: "forest", name: "森の庭", emoji: "🌲", unlockPlanted: 60 },
];

export const GARDEN_DESIGN_BY_ID = new Map(GARDEN_DESIGNS.map((d) => [d.id, d]));

export function isGardenDesignId(value: unknown): value is GardenDesignId {
  return typeof value === "string" && GARDEN_DESIGN_BY_ID.has(value as GardenDesignId);
}

/** まいたタネの数で使えるガーデン */
export function unlockedGardenDesigns(plantedCount: number): GardenDesign[] {
  return GARDEN_DESIGNS.filter((d) => plantedCount >= d.unlockPlanted);
}

export type HouseTierId = "hut" | "house" | "twostory" | "mansion";

export interface HouseTier {
  id: HouseTierId;
  name: string;
  /** この家になるレベル */
  minLevel: number;
}

export const HOUSE_TIERS: HouseTier[] = [
  { id: "hut", name: "小屋", minLevel: 1 },
  { id: "house", name: "家", minLevel: 3 },
  { id: "twostory", name: "2階建て", minLevel: 5 },
  { id: "mansion", name: "お屋敷", minLevel: 8 },
];

/** そのレベルの家と柵 */
export function houseTierFor(level: number): HouseTier {
  return [...HOUSE_TIERS].reverse().find((t) => level >= t.minLevel) ?? HOUSE_TIERS[0];
}

/** ガーデンごとの配置。おうちの庭は GameTaneGarden.objects、ほかは GameTaneGarden.layouts に持つ */
export type GardenLayouts = Partial<Record<GardenDesignId, GardenObject[]>>;

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
 * 存在するアイテムか・マスの範囲内か・1マス1個か・所持数を超えていないか(ほかのガーデンに置いている分 placedElsewhere も合わせて数える)
 */
export function validateGardenObjects(
  input: unknown,
  owned: ReadonlyMap<string, number>,
  placedElsewhere: ReadonlyMap<string, number> = new Map()
): GardenObject[] {
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
      throw new Error("ガーデンの外に置かれています");
    }
    const cell = `${x},${y}`;
    if (cells.has(cell)) throw new Error("1つのマスに置けるのは1個までです");
    cells.add(cell);

    result.push({ objectId: o.objectId, itemId: item.itemId, x, y });
  }

  for (const [itemId, count] of countPlaced(result)) {
    if (count + (placedElsewhere.get(itemId) ?? 0) > (owned.get(itemId) ?? 0)) {
      throw new Error(`「${TANE_ITEM_BY_ID.get(itemId)?.name ?? itemId}」を持っている数より多く置いています`);
    }
  }
  return result;
}
