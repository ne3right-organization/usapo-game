import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/chizu-tane-stats";
import { dataClient, unwrap } from "../shared/dataClient";
import { TANE_COURSES } from "../../../src/lib/game/chizuTane/courses";

/**
 * コースごとの、遊んでいる人数(始めた人の数)。プレイヤーの行は本人しか読めないので、Lambda で数えて数だけ返す。
 * 試作の規模なので毎回全件を数える。遊ぶ人が増えたら、始めたときに数を足しておく形にする
 */
export const handler: Schema["taneCourseCounts"]["functionHandler"] = async () => {
  const c = await dataClient(env);
  const counts = new Map<string, number>(TANE_COURSES.map((course) => [course.id, 0]));
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTanePlayer.list({ nextToken, limit: 1000, selectionSet: ["course"] });
    for (const p of unwrap(page)) counts.set(p.course, (counts.get(p.course) ?? 0) + 1);
    nextToken = page.nextToken;
  } while (nextToken);
  return [...counts].map(([course, players]) => ({ course, players }));
};
