"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentUser, signOutUser } from "@/lib/auth";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";
import { disablePush } from "@/lib/push/client";

// サイト共通ヘッダー(SiteHeader)の右に出す、ログインの状態。元実装(team-kokuusa-platform-frontend)の NicknameBadge 相当。
// 未ログイン: ログインへの導線 / ログイン済み: ニックネーム(設定画面へ)+ログアウト
export default function AuthStatus() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "signed-out" }
    | { status: "signed-in"; nickname: string | null }
  >({ status: "loading" });
  // ヘッダーはページを移っても作り直されないので、ログインした直後・ニックネームを変えた直後にも合うよう、ページを移るたびに読み直す
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    currentUser().then(async (user) => {
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
  }, [pathname]);

  const handleSignOut = async () => {
    // この端末の通知を止めてから(共用の端末で、ログアウトしたあとも前の人の通知が届かないように)、
    // Cognito のログアウト画面を経由してトップに戻る
    await disablePush().catch(() => {});
    await signOutUser();
  };

  if (state.status === "loading") {
    return <div className="h-4" />;
  }

  if (state.status === "signed-out") {
    return (
      <Link
        href="/login"
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
      >
        ログイン
      </Link>
    );
  }

  return (
    <div className="inline-flex items-center gap-3 text-xs min-w-0">
      <Link href="/nickname" className="text-[#78716c] hover:text-[#3c2a14] truncate max-w-[9rem]">
        {state.nickname ? `👤 ${state.nickname}` : "⚙️ 設定"}
      </Link>
      <button
        type="button"
        onClick={handleSignOut}
        className="shrink-0 text-[#a8937a] underline underline-offset-2 hover:text-[#78716c]"
      >
        ログアウト
      </button>
    </div>
  );
}
