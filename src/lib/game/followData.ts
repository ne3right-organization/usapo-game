"use client";

import { currentUser } from "@/lib/auth";
import { data, unwrap, type Schema } from "@/lib/amplify/data";

// フォロー機能のデータアクセス(GameFollow)。フォロー関係はフォローした本人とされた本人にだけ見え
// (モデルの認可)、フォロー・解除はカスタムミューテーション(amplify/functions/set-following)が
// 「お互いにニックネーム設定済み」を確かめてから行う

export interface FollowUser {
  userId: string;
  nickname: string | null;
  /** アイコン(うさぽ農園で集めたものの itemId。無ければ null) */
  iconItemId: string | null;
  followedAt: string;
}

type FollowItem = Schema["GameFollow"]["type"];

async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

export async function isFollowing(followeeId: string): Promise<boolean> {
  const followerId = await requireUserId();
  return unwrap(await data.models.GameFollow.get({ followerId, followeeId })) != null;
}

export async function follow(followeeId: string): Promise<void> {
  await requireUserId();
  unwrap(await data.mutations.setFollowing({ followeeId, follow: true }));
}

export async function unfollow(followeeId: string): Promise<void> {
  await requireUserId();
  unwrap(await data.mutations.setFollowing({ followeeId, follow: false }));
}

/**
 * フォローしてもらうリンク(/follow/{token})の URL。開いた人は自分をフォローし、自分の農園を見られるようになる。
 * renew なら作り直して、前のリンクを使えなくする
 */
export async function fetchFollowInviteUrl(renew = false): Promise<string> {
  await requireUserId();
  const token = unwrap(await data.mutations.issueFollowInvite({ renew }));
  if (!token) throw new Error("リンクを作れませんでした");
  return `${window.location.origin}/follow/${token}`;
}

/** フォローしてもらうリンクを開いた: リンクの持ち主をフォローし、持ち主の農園を見せてもらう。持ち主を返す */
export async function acceptFollowInvite(token: string): Promise<{ userId: string; nickname: string }> {
  await requireUserId();
  const owner = unwrap(await data.mutations.acceptFollowInvite({ token }));
  if (!owner) throw new Error("リンクを開けませんでした");
  return owner;
}

/** 自分のフォロワー(kind=followers)か、自分がフォローしている人(kind=following)を全部。新しい順 */
async function listFollows(kind: "followers" | "following", userId: string): Promise<FollowItem[]> {
  const items: FollowItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page =
      kind === "followers"
        ? await data.models.GameFollow.listFollowersByUser({ followeeId: userId }, { sortDirection: "DESC", nextToken })
        : await data.models.GameFollow.listFollowingByUser({ followerId: userId }, { sortDirection: "DESC", nextToken });
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

export async function fetchFollowCounts(): Promise<{ followers: number; following: number }> {
  const userId = await requireUserId();
  const [followers, following] = await Promise.all([listFollows("followers", userId), listFollows("following", userId)]);
  return { followers: followers.length, following: following.length };
}

export async function fetchFollowList(kind: "followers" | "following"): Promise<FollowUser[]> {
  const userId = await requireUserId();
  const items = await listFollows(kind, userId);
  // 相手のニックネームはプロフィールから引く(join が無いので1人ずつ)
  return Promise.all(
    items.map(async (item) => {
      const otherId = kind === "followers" ? item.followerId : item.followeeId;
      const profile = unwrap(await data.models.GameProfile.get({ userId: otherId }));
      return { userId: otherId, nickname: profile?.nickname ?? null, iconItemId: profile?.iconItemId ?? null, followedAt: item.followedAt };
    })
  );
}
