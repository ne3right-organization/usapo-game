"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";
import { fetchFollowCounts, follow, isFollowing, unfollow } from "@/lib/game/followData";

/** 他の人のプロフィールに出すフォローボタン。フォローするには自分もニックネームの設定が要る(RLSで強制) */
export function FollowButton({ targetUserId }: { targetUserId: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "no-nickname" } | { status: "ready"; following: boolean } | { status: "error"; message: string }
  >({ status: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchGameProfile(), isFollowing(targetUserId)])
      .then(([me, following]) => {
        if (cancelled) return;
        setState(me?.nickname ? { status: "ready", following } : { status: "no-nickname" });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  if (state.status === "loading") return null;
  if (state.status === "error") return <span className="text-xs text-red-600">{state.message}</span>;
  if (state.status === "no-nickname") {
    return (
      <Link href="/nickname" className="text-xs text-[#78716c] underline underline-offset-2 text-right">
        フォローするには
        <br />
        ニックネームを設定
      </Link>
    );
  }

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state.following) await unfollow(targetUserId);
      else await follow(targetUserId);
      setState({ status: "ready", following: !state.following });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 ${
        state.following ? "bg-white text-teal-700 border border-teal-300" : "bg-teal-700 text-white"
      }`}
    >
      {state.following ? "フォロー中" : "フォローする"}
    </button>
  );
}

/** 自分のプロフィールに出すフォロワー数・フォロー数(一覧へのリンク) */
export function FollowSummary() {
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFollowCounts()
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch(() => {
        // 数が取れなくてもプロフィール自体は見られるので、何も出さない
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!counts) return null;
  return (
    <div className="flex gap-4 text-sm">
      <Link href="/profile/follows?tab=followers" className="text-[#78716c] hover:text-[#3c2a14]">
        <span className="font-bold text-[#3c2a14]">{counts.followers}</span> フォロワー
      </Link>
      <Link href="/profile/follows?tab=following" className="text-[#78716c] hover:text-[#3c2a14]">
        <span className="font-bold text-[#3c2a14]">{counts.following}</span> フォロー中
      </Link>
    </div>
  );
}
