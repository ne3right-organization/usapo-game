"use client";

import { Suspense, use, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import type { Difficulty } from "@/lib/game/mapPuzzleData";
import type { AreaInfo } from "@/components/game/map-puzzle/MapAreaSelector";
import { MAP_PACK_BEGINNER_AREA, type MapPackArea } from "@/lib/game/mapPackData";

const MapPackGame = dynamic(() => import("@/components/game/map-pack/MapPackGame"), { ssr: false });
// エリア選択は地図パズルのものをそのまま使う
const MapAreaSelector = dynamic(() => import("@/components/game/map-puzzle/MapAreaSelector"), { ssr: false });

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

const VALID_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;

const META: Record<Difficulty, { label: string; title: string; nameKey: string; unitLabel: string }> = {
  beginner: { label: "初級", title: "都道府県ポットン", nameKey: "name", unitLabel: "都道府県" },
  intermediate: { label: "中級", title: "自治体ポットン", nameKey: "cityName", unitLabel: "市区町村" },
  advanced: { label: "上級", title: "ご近所ポットン", nameKey: "S_NAME", unitLabel: "町丁" },
};

type GameConfig = { geojsonUrl: string; areaLabel: string; area: MapPackArea };

type Props = { params: Promise<{ difficulty: string }> };

/**
 * 最初に遊ぶエリア。初級は全国固定。中級・上級は URL でエリアが指定されていれば(ランキングから直接来た場合)
 * それで始め、無ければ地図でエリアを選ぶ
 */
function initialConfig(difficulty: Difficulty, q: URLSearchParams): GameConfig | null {
  if (difficulty === "beginner") {
    return {
      geojsonUrl: `${CLOUDFRONT_URL}/geojson/prefecture/prefectures.geojson`,
      areaLabel: "日本",
      area: { difficulty, ...MAP_PACK_BEGINNER_AREA },
    };
  }
  const prefCode = q.get("prefCode"), prefName = q.get("prefName");
  if (!prefCode || !/^\d{2}$/.test(prefCode) || !prefName) return null;
  if (difficulty === "intermediate") {
    return {
      geojsonUrl: `${CLOUDFRONT_URL}/geojson/municipality/2020/${prefCode}.geojson`,
      areaLabel: prefName,
      area: { difficulty, prefCode, prefName },
    };
  }
  const cityCode = q.get("cityCode"), cityName = q.get("cityName");
  if (!cityCode || !/^\d{3}$/.test(cityCode) || !cityName) return null;
  return {
    geojsonUrl: `${CLOUDFRONT_URL}/geojson/town-district/2020/${prefCode}/${cityCode}.geojson`,
    areaLabel: cityName,
    area: { difficulty, prefCode, prefName, cityCode, cityName },
  };
}

export default function MapPackPlayPage({ params }: Props) {
  const { difficulty: diffParam } = use(params);
  if (!VALID_DIFFICULTIES.includes(diffParam as Difficulty)) notFound();
  // useSearchParams を使うので Suspense で包む(Next.js の要件)
  return (
    <Suspense fallback={<p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}>
      <MapPackPlay difficulty={diffParam as Difficulty} />
    </Suspense>
  );
}

function MapPackPlay({ difficulty }: { difficulty: Difficulty }) {
  const meta = META[difficulty];
  const router = useRouter();
  const searchParams = useSearchParams();

  // area はゲーム側の effect の依存になるので state で固定する
  const [config, setConfig] = useState<GameConfig | null>(() => initialConfig(difficulty, searchParams));

  if (!config) {
    return (
      <MapAreaSelector
        difficulty={difficulty as "intermediate" | "advanced"}
        title={meta.title}
        onBack={() => router.push("/game/map-pack")}
        onConfirm={(url, _label, area: AreaInfo) =>
          setConfig({ geojsonUrl: url, areaLabel: area.cityName ?? area.prefName, area: { ...area, difficulty } })
        }
      />
    );
  }

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-4 pb-16">
        <div className="flex items-center gap-2 mb-3">
          <Link href="/game/map-pack" className="text-[#78716c] text-lg leading-none" title="戻る">
            ←
          </Link>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200">
            {meta.label}
          </span>
          <h1 className="text-base font-bold text-[#3c2a14] truncate">
            {meta.title}・{config.areaLabel}
          </h1>
        </div>

        <MapPackGame
          geojsonUrl={config.geojsonUrl}
          areaLabel={config.areaLabel}
          nameKey={meta.nameKey}
          unitLabel={meta.unitLabel}
          area={config.area}
        />

        {difficulty !== "beginner" && (
          <p className="text-center mt-6">
            <button
              type="button"
              onClick={() => setConfig(null)}
              className="text-sm text-[#78716c] underline underline-offset-2"
            >
              別のエリアを選ぶ
            </button>
          </p>
        )}
      </div>
    </main>
  );
}
