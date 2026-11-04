import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-market";
import { dataClient, unwrap } from "../shared/dataClient";
import { addSeeds, placedInGardens, requirePlayer, spendFruits } from "../shared/chizuTane";
import { FRUITS_PER_EXCHANGE_SEED, TANE_ITEM_BY_ID, exchangeSeedFor } from "../../../src/lib/game/chizuTane/courses";

// うさぽ農園の市場(2026-11-05)。同じ実 FRUITS_PER_EXCHANGE_SEED 個を、同じコースの1つ上のレベルの種類の、同じ番号のタネ1個と交換する
// (みかんの木 → チューリップ。対応は courses.ts の exchangeSeedFor)。いまの環境の上限レベルの種類の実と、ご当地の実は交換できない。
// ガーデンに飾っている分は使えない。実を減らしてからタネを足す(実は条件付きで減らすので、同時に押しても数がずれない)

type ExchangeResult = Schema["TaneExchangeResult"]["type"];
type Args = { itemId: string };

export const handler: AppSyncResolverHandler<Args, ExchangeResult> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { itemId } = event.arguments;
  await requirePlayer(c, userId);

  const fruit = TANE_ITEM_BY_ID.get(itemId);
  const seed = exchangeSeedFor(itemId);
  if (!fruit || !seed) throw new Error("この実はタネと交換できません");
  const placed = await placedInGardens(c, userId, itemId);
  if (!(await spendFruits(userId, itemId, FRUITS_PER_EXCHANGE_SEED, placed))) {
    throw new Error(`「${fruit.name}」が${FRUITS_PER_EXCHANGE_SEED}個ありません（ガーデンに飾っている分は使えません）`);
  }
  await addSeeds(c, userId, seed.itemId, 1);

  const [owned, held] = await Promise.all([
    c.models.GameTaneItem.get({ userId, itemId }),
    c.models.GameTaneHeldSeed.get({ userId, itemId: seed.itemId }),
  ]);
  return { seedItemId: seed.itemId, fruitsLeft: unwrap(owned)?.quantity ?? 0, seedsHeld: unwrap(held)?.quantity ?? 1 };
};
