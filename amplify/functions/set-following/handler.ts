import type { AppSyncIdentityCognito } from "aws-lambda";
import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/set-following";
import { dataClient, unwrap } from "../shared/dataClient";

/**
 * フォローする(follow = true)・やめる(false)。Supabase 版の RLS と同じく、フォローできるのは
 * する側・される側ともニックネームを設定している人だけで、自分自身はフォローできない
 */
export const handler: Schema["setFollowing"]["functionHandler"] = async (event) => {
  const followerId = (event.identity as AppSyncIdentityCognito).sub;
  const { followeeId, follow } = event.arguments;
  const c = await dataClient(env);

  if (!follow) {
    // フォローしていなければ消す対象が無いだけなので、エラーにしない
    await c.models.GameFollow.delete({ followerId, followeeId });
    return false;
  }

  if (followerId === followeeId) throw new Error("自分自身はフォローできません");
  const [me, them] = await Promise.all([
    c.models.GameProfile.get({ userId: followerId }),
    c.models.GameProfile.get({ userId: followeeId }),
  ]);
  if (!unwrap(me)?.nickname) throw new Error("フォローするにはニックネームを設定してください");
  if (!unwrap(them)?.nickname) throw new Error("この人はフォローできません");

  // すでにフォロー済み(別のタブで押した等)なら結果は同じなので、そのまま返す
  if (unwrap(await c.models.GameFollow.get({ followerId, followeeId }))) return true;
  unwrap(await c.models.GameFollow.create({ followerId, followeeId, followedAt: new Date().toISOString() }));
  return true;
};
