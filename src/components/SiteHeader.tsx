"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// どのゲームの画面からでもサイトのトップ(ゲームコーナー)に戻れるようにする共通ヘッダー。
// トップページ自身では出さない。地図パズルのプレイ画面・エリア選択など画面全体を覆う表示(z-[1100])の
// 下には隠れるが、それらは左上の「←」でゲームのトップに戻れるので、そこからこのヘッダーで戻れる
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <header className="shrink-0 bg-[#fdf8f0] border-b border-[#efe6d8]">
      <div className="max-w-lg mx-auto px-4 h-9 flex items-center">
        <Link href="/" className="text-xs font-semibold text-[#78716c] hover:text-[#3c2a14]">
          🏠 うさぽ ゲームコーナー
        </Link>
      </div>
    </header>
  );
}
