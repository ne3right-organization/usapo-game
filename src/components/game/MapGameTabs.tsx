"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// 地図パズルと地図ポットンを「地図ゲーム」としてまとめる、下に固定のタブ(うさぽ農園の TaneTabs と同じ形)。
// 各ゲームのトップ・ランキング・履歴(/history)・プロフィール(/profile)に出す。プレイ画面は画面全体を使うので出さない
// (プレイ画面と同じ URL でエリアを選んでいる間は、ページ側が onPlayPath を付けて出す)。
// Leaflet の地図(つまみが z-index 1000)より前、プレイ画面などの全画面表示(z-[1100])より後ろに置く。
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
      {/* 下のタブに隠れないよう、ページの下を空けておく(タブの高さ h-16 と同じにする。ずれると隙間が見える) */}
      <div className="shrink-0 bg-[#fdf8f0] h-[calc(4rem+env(safe-area-inset-bottom))]" aria-hidden />
      <nav className="fixed bottom-0 inset-x-0 z-[1050] bg-white/95 backdrop-blur border-t border-[#f3ece0] pb-[env(safe-area-inset-bottom)]">
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
