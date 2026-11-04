import { randomBytes } from "node:crypto";
import type { AppSyncIdentityCognito, AppSyncResolverHandler } from "aws-lambda";
import { env } from "$amplify/env/set-following";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import { notifyUsers } from "../shared/push";

type Args = { followeeId?: string; follow?: boolean; renew?: boolean; token?: string };

/**
 * フォローする(follow = true)・やめる(false)。Supabase 版の RLS と同じく、フォローできるのは
 * する側・される側ともニックネームを設定している人だけで、自分自身はフォローできない。
 * フォローしてもらうリンクの発行(issueFollowInvite)と、リンクを開いたとき(acceptFollowInvite)も受ける。
 * Amplify Gen2 の関数には event.info が来ないので、引数で見分ける(token があればリンクを開いた、renew があれば発行)
 */
export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = (event.identity as AppSyncIdentityCognito).sub;
  const c = await dataClient(env);
  const { followeeId, follow, renew, token } = event.arguments;

  if (typeof token === "string") return acceptInvite(c, userId, token);
  if (typeof renew === "boolean") return issueInvite(c, userId, renew);
  if (typeof followeeId !== "string") throw new Error("フォローする相手が指定されていません");

  if (!follow) {
    // フォローしていなければ消す対象が無いだけなので、エラーにしない
    await c.models.GameFollow.delete({ followerId: userId, followeeId });
    return false;
  }
  const nickname = await checkFollowable(c, userId, followeeId);
  if (await addFollow(c, userId, followeeId)) await notifyFollowed(c, userId, followeeId, `${nickname}さんにフォローされました`);
  return true;
};

/** フォローできるか確かめて、フォローする人のニックネームを返す */
async function checkFollowable(c: DataClient, followerId: string, followeeId: string): Promise<string> {
  if (followerId === followeeId) throw new Error("自分自身はフォローできません");
  const [me, them] = await Promise.all([
    c.models.GameProfile.get({ userId: followerId }),
    c.models.GameProfile.get({ userId: followeeId }),
  ]);
  const nickname = unwrap(me)?.nickname;
  if (!nickname) throw new Error("フォローするにはニックネームを設定してください");
  if (!unwrap(them)?.nickname) throw new Error("この人はフォローできません");
  return nickname;
}

/** フォローする。すでにフォロー済み(別のタブで押した等)なら何もせず false */
async function addFollow(c: DataClient, followerId: string, followeeId: string): Promise<boolean> {
  if (unwrap(await c.models.GameFollow.get({ followerId, followeeId }))) return false;
  unwrap(await c.models.GameFollow.create({ followerId, followeeId, followedAt: new Date().toISOString() }));
  return true;
}

async function notifyFollowed(c: DataClient, followerId: string, followeeId: string, body: string): Promise<void> {
  await notifyUsers(c, [followeeId], {
    title: "フォローされました",
    body,
    url: `/profile/${followerId}`,
    tag: `follow-${followerId}`,
  });
}

/** フォローしてもらうリンクの token。無ければ作り、renew なら作り直す(前の token の行は上書きされ、使えなくなる) */
async function issueInvite(c: DataClient, ownerId: string, renew: boolean): Promise<string> {
  const existing = unwrap(await c.models.GameFollowInvite.get({ ownerId }));
  if (existing && !renew) return existing.token;
  const fields = { ownerId, token: randomBytes(16).toString("base64url"), createdAt: new Date().toISOString() };
  unwrap(existing ? await c.models.GameFollowInvite.update(fields) : await c.models.GameFollowInvite.create(fields));
  return fields.token;
}

/**
 * フォローしてもらうリンクを開いた: リンクの持ち主をフォローし、持ち主の農園を見せてもらう(GameTaneShare)。
 * すでにフォロー済み・見せてもらっている場合も、足りないほうだけ足す
 */
async function acceptInvite(c: DataClient, viewerId: string, token: string): Promise<{ userId: string; nickname: string }> {
  const invite = unwrap(await c.models.GameFollowInvite.listFollowInvitesByToken({ token }))[0];
  if (!invite) throw new Error("このリンクは使えなくなっています。もう一度リンクを送ってもらってください");
  const ownerId = invite.ownerId;
  if (ownerId === viewerId) throw new Error("これはあなた自身のリンクです。友達に送ってください");

  const nickname = await checkFollowable(c, viewerId, ownerId);
  const [shared, owner] = await Promise.all([
    c.models.GameTaneShare.get({ ownerId, viewerId }),
    c.models.GameProfile.get({ userId: ownerId }),
  ]);
  const newShare = !unwrap(shared);
  if (newShare) unwrap(await c.models.GameTaneShare.create({ ownerId, viewerId }));
  // フォローも農園を見せるのも済んでいた(同じリンクを2回開いた等)なら、知らせない
  if ((await addFollow(c, viewerId, ownerId)) || newShare) {
    await notifyFollowed(c, viewerId, ownerId, `${nickname}さんがリンクからフォローしました(農園を見せています)`);
  }
  return { userId: ownerId, nickname: unwrap(owner)?.nickname ?? "" };
}
