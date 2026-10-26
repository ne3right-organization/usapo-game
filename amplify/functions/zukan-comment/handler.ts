import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/zukan-comment";
import { dataClient, ensureProfile, unwrap } from "../shared/dataClient";

const MAX_LENGTH = 200;

type Args = { prefCode: string; cityCode: string; body?: string };

/**
 * 図鑑カードへの「ヒントの提案」の投稿・編集(upsertZukanComment)と削除(deleteZukanComment)。
 * 投稿できるのはそのカードを持っている人だけ(Supabase 版では RLS で確かめていたもの)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const { prefCode, cityCode } = event.arguments;
  const areaKey = `${prefCode}#${cityCode}`;
  const c = await dataClient(env);

  if (event.info.fieldName === "deleteZukanComment") {
    await c.models.GameZukanComment.delete({ areaKey, userId });
    return true;
  }

  const body = (event.arguments.body ?? "").trim();
  if (body.length === 0 || [...body].length > MAX_LENGTH) throw new Error(`コメントは1〜${MAX_LENGTH}文字で入力してください`);
  const card = unwrap(await c.models.GameZukanCollection.get({ userId, areaKey }));
  if (!card) throw new Error("このカードを図鑑に登録した人だけが投稿できます");

  const { nickname } = await ensureProfile(c, userId);
  const now = new Date().toISOString();
  const existing = unwrap(await c.models.GameZukanComment.get({ areaKey, userId }));
  const saved = unwrap(
    existing
      ? await c.models.GameZukanComment.update({ areaKey, userId, nickname, body, editedAt: now })
      : await c.models.GameZukanComment.create({ areaKey, userId, nickname, body, postedAt: now, editedAt: now })
  );
  if (!saved) throw new Error("保存できませんでした");
  return saved;
};
