import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-seeds";
import { dataClient, unwrap } from "../shared/dataClient";
import { addSeeds } from "../shared/chizuTane";
import { IDLE_SEED_DAYS } from "../../../src/lib/game/chizuTane/courses";

const PERIOD_MS = IDLE_SEED_DAYS * 24 * 3_600_000;

/**
 * 自分のタネのうち、最後にタネが増えてから(訪ねられた・持ち主が訪ねた・前に時間で増えた)3日以上たったものから、
 * 3日ごとに1個ずつタネを受け取る(上限なし)。トップを開いたときに呼ばれる
 */
export const handler: Schema["collectTaneSeeds"]["functionHandler"] = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const now = Date.now();
  const gains: { itemId: string; count: number; townName: string }[] = [];

  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneBase.listTaneBasesByOwner({ ownerId: userId }, { nextToken });
    for (const base of unwrap(page)) {
      const since = new Date(base.lastSeedAt ?? base.plantedAt).getTime();
      const periods = Math.floor((now - since) / PERIOD_MS);
      if (periods < 1) continue;
      await addSeeds(c, userId, base.seedItemId, periods);
      // 端数の時間は次に持ち越す
      unwrap(await c.models.GameTaneBase.update({ areaKey: base.areaKey, lastSeedAt: new Date(since + periods * PERIOD_MS).toISOString() }));
      gains.push({ itemId: base.seedItemId, count: periods, townName: base.townName });
    }
    nextToken = page.nextToken;
  } while (nextToken);

  return JSON.stringify(gains);
};
