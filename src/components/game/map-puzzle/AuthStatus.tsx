"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";

// 元実装(team-kokuusa-platform-frontend)の NicknameBadge 相当。
// ログイン状態も合わせて出し分ける(未ログイン: ログインへの導線 / ログイン済み: ニックネーム+ログアウト)
export default function AuthStatus() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "signed-out" }
    | { status: "signed-in"; nickname: string | null }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (cancelled) return;
      if (!user) {
        setState({ status: "signed-out" });
        return;
      }
      try {
        const profile = await fetchGameProfile();
        if (!cancelled) setState({ status: "signed-in", nickname: profile?.nickname ?? null });
      } catch {
        if (!cancelled) setState({ status: "signed-in", nickname: null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  };

  if (state.status === "loading") {
    return <div className="h-5" />;
  }

  if (state.status === "signed-out") {
    return (
      <Link
        href="/login"
        className="inline-flex items-center gap-1 text-sm text-[#78716c] underline underline-offset-2"
      >
        ログイン
      </Link>
    );
  }

  return (
    <div className="inline-flex items-center gap-3 text-sm">
      <Link href="/game/map-puzzle/nickname" className="text-[#78716c] underline underline-offset-2">
        {state.nickname ? `👤 ${state.nickname}` : "名前をつける"}
      </Link>
      <button
        type="button"
        onClick={handleSignOut}
        className="text-[#a8937a] underline underline-offset-2"
      >
        ログアウト
      </button>
    </div>
  );
}
