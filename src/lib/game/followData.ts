"use client";

import { createClient } from "@/lib/supabase/client";

// フォロー機能のデータアクセス(テーブルは supabase/migrations/20261023000001_follows.sql)。
// RLS で「フォローした本人とされた本人にだけ見える」「フォロー・解除は本人だけ」を強制しているので、
// クライアントから直接読み書きする

export interface FollowUser {
  userId: string;
  nickname: string | null;
  followedAt: string;
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

export async function isFollowing(followeeId: string): Promise<boolean> {
  const supabase = createClient();
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("game_follows")
    .select("followee_id")
    .eq("follower_id", userId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

export async function follow(followeeId: string): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId();
  const { error } = await supabase.from("game_follows").insert({ follower_id: userId, followee_id: followeeId });
  // 23505: すでにフォロー済み(別のタブで押した等)。結果は同じなのでエラーにしない
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function unfollow(followeeId: string): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId();
  const { error } = await supabase
    .from("game_follows")
    .delete()
    .eq("follower_id", userId)
    .eq("followee_id", followeeId);
  if (error) throw new Error(error.message);
}

export async function fetchFollowCounts(): Promise<{ followers: number; following: number }> {
  const supabase = createClient();
  const userId = await requireUserId();
  const [followers, following] = await Promise.all([
    supabase.from("game_follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    supabase.from("game_follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  if (followers.error) throw new Error(followers.error.message);
  if (following.error) throw new Error(following.error.message);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

/** 自分のフォロワー(kind=followers)か、自分がフォローしている人(kind=following)の一覧。新しい順 */
export async function fetchFollowList(kind: "followers" | "following"): Promise<FollowUser[]> {
  const supabase = createClient();
  const userId = await requireUserId();
  // 相手のニックネームを外部キー経由で一緒に引く。ニックネームを消した人は game_profiles のRLSで見えず null になる
  const query =
    kind === "followers"
      ? supabase
          .from("game_follows")
          .select("user_id:follower_id, created_at, profile:game_profiles!game_follows_follower_id_fkey(nickname)")
          .eq("followee_id", userId)
      : supabase
          .from("game_follows")
          .select("user_id:followee_id, created_at, profile:game_profiles!game_follows_followee_id_fkey(nickname)")
          .eq("follower_id", userId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { user_id: string; created_at: string; profile: { nickname: string | null } | null }[]).map(
    (row) => ({ userId: row.user_id, nickname: row.profile?.nickname ?? null, followedAt: row.created_at }),
  );
}
