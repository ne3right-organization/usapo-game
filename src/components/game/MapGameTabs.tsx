"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// 地図パズルと地図ポットンを「地図ゲーム」としてまとめるタブ(うさぽ農園の TaneTabs と同じ形)。サイトのヘッダーのすぐ下に出し、
// ヘッダーと一緒にスクロールする(2026-11-01 まで画面の下に固定していたが、PWA でうまく動かないことがあったので上に移した)。
// 各ゲームのトップ・ランキング・履歴(/history)・プロフィール(/profile)に出す。プレイ画面は画面全体を使うので出さない
// (プレイ画面と同じ URL でエリアを選んでいる間は、ページ側が onPlayPath を付けて出す)。
// ランキング・履歴・プロフィールは、いま見ているゲーム(パズルかポットンか)の画面を開く

type MapGame = "map-puzzle" | "map-pack";

const PLAY_PATH = /^\/game\/(map-puzzle|map-pack)\/(beginner|intermediate|advanced)(\/|$)/;

/**
 * @param onPlayPath プレイ画面と同じ URL でも出す(プレイ画面の URL でエリアを選んでいる間。ページ側から出す)
 */
export default function MapGameTabs({ onPlayPath = false }: { onPlayPath?: boolean }) {
  return (
    <Suspense fallback={null}>
      <Tabs onPlayPath={onPlayPath} />
    </Suspense>
  );
}

function Tabs({ onPlayPath }: { onPlayPath: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (PLAY_PATH.test(pathname) !== onPlayPath) return null;

  const queryGame = searchParams.get("game");
  const game: MapGame =
    pathname.startsWith("/game/map-pack") || queryGame === "map-pack" ? "map-pack" : "map-puzzle";
  const inRanking = pathname.includes("/ranking");

  const tabs = [
    { href: "/game/map-puzzle", label: "パズル", emoji: "🗺️", active: pathname.startsWith("/game/map-puzzle") && !inRanking },
    { href: "/game/map-pack", label: "ポットン", emoji: "📦", active: pathname.startsWith("/game/map-pack") && !inRanking },
    { href: `/game/${game}/ranking`, label: "ランキング", emoji: "🏆", active: inRanking },
    { href: `/history?game=${game}`, label: "履歴", emoji: "📜", active: pathname.startsWith("/history") },
    { href: `/profile?game=${game}`, label: "プロフィール", emoji: "👤", active: pathname.startsWith("/profile") },
  ];

  return (
    <>
      <nav className="shrink-0 bg-white border-b border-[#f3ece0]">
        <ul className="max-w-lg mx-auto grid grid-cols-5">
          {tabs.map((t) => (
            <li key={t.label}>
              <Link
                href={t.href}
                aria-current={t.active ? "page" : undefined}
                className={`h-16 flex flex-col items-center justify-center gap-0.5 text-[10px] ${
                  t.active ? "text-teal-700 font-bold" : "text-[#a8937a]"
                }`}
              >
                <span className={`text-xl leading-none ${t.active ? "" : "opacity-70"}`}>{t.emoji}</span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
