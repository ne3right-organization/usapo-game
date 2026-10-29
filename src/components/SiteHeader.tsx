"use client";

import Link from "next/link";
import AuthStatus from "@/components/AuthStatus";

// 全ページに出す共通ヘッダー。左はサイトのトップ(ゲームコーナー)へ、右はログイン・ログアウト。
// 地図パズルのプレイ画面・エリア選択など画面全体を覆う表示(z-[1100])の下には隠れるが、
// それらは左上の「←」でゲームのトップに戻れるので、そこからこのヘッダーを使える
export default function SiteHeader() {
  return (
    <header className="shrink-0 bg-[#fdf8f0] border-b border-[#efe6d8]">
      <div className="max-w-lg mx-auto px-4 h-10 flex items-center justify-between gap-3">
        <Link href="/" className="shrink-0 text-xs font-semibold text-[#78716c] hover:text-[#3c2a14]">
          🏠 うさぽ ゲームコーナー
        </Link>
        <AuthStatus />
      </div>
    </header>
  );
}
