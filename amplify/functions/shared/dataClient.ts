import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource";

type FunctionEnv = Parameters<typeof getAmplifyDataClientConfig>[0];

export type DataClient = ReturnType<typeof generateClient<Schema>>;

let client: DataClient | null = null;

/** Lambda から Amplify Data を IAM で読み書きするクライアント(スキーマの allow.resource で権限を付けている) */
export async function dataClient(env: FunctionEnv): Promise<DataClient> {
  if (client) return client;
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
  Amplify.configure(resourceConfig, libraryOptions);
  client = generateClient<Schema>();
  return client;
}

/** Amplify Data の結果を、エラーなら例外にして中身だけ返す */
export function unwrap<R extends { data: unknown; errors?: readonly { message: string }[] }>(res: R): R["data"] {
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
  return res.data;
}

/**
 * 難易度×エリアのキー(中断データ・ベスト記録の主キーの一部)と、エリア別ランキングのキー(上級だけ市区町村まで含める)。
 * 画面側の src/lib/amplify/data.ts と同じ形
 */
export function areaKeysOf(area: { difficulty: string; prefCode: string; cityCode?: string | null }) {
  const city = area.cityCode ?? "";
  return {
    areaKey: `${area.difficulty}#${area.prefCode}#${city}`,
    rankingKey: area.difficulty === "advanced" ? `${area.difficulty}#${area.prefCode}#${city}` : `${area.difficulty}#${area.prefCode}`,
  };
}

/** 各ゲームのトップに出す「最近クリアされたエリア」を更新する(誰がクリアしたかは持たない) */
export async function touchRecentClear(
  c: DataClient,
  clear: {
    game: "map-puzzle" | "map-pack" | "zukan-quiz";
    areaKey: string;
    difficulty?: string | null;
    prefCode: string;
    prefName: string;
    cityCode?: string | null;
    cityName?: string | null;
  }
) {
  const fields = { ...clear, lastClearedAt: new Date().toISOString() };
  const existing = unwrap(await c.models.GameRecentClear.get({ game: clear.game, areaKey: clear.areaKey }));
  unwrap(existing ? await c.models.GameRecentClear.update(fields) : await c.models.GameRecentClear.create(fields));
}

/** プロフィールが無ければ作る(初回ログインのトリガーより前からいる人や、トリガーが失敗した場合の保険) */
export async function ensureProfile(c: DataClient, userId: string): Promise<{ nickname: string | null }> {
  const existing = unwrap(await c.models.GameProfile.get({ userId }));
  if (existing) return { nickname: existing.nickname ?? null };
  unwrap(await c.models.GameProfile.create({ userId, totalScore: 0, areasPlayedCount: 0 }));
  return { nickname: null };
}
