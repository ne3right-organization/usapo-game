"use client";

import Link from "next/link";
import MunicipalitySilhouette from "@/components/game/zukan-quiz/MunicipalitySilhouette";
import { ZUKAN_DIFFICULTY_META } from "@/lib/game/zukanQuizDifficulty";
import { zukanGeometryKey, type ZukanCollectionEntry, type GeoJsonGeometry } from "@/lib/game/zukanQuizClient";

interface Props {
  collections: ZukanCollectionEntry[];
  geometries: Map<string, GeoJsonGeometry>;
  hrefFor: (entry: ZukanCollectionEntry) => string;
}

// 図鑑の「獲得済みカード」グリッド。自分の図鑑(collection/page.tsx)と
// 他ユーザーの公開図鑑(profile/[userId]/page.tsx)の両方から共通利用する
export default function ZukanCardGrid({ collections, geometries, hrefFor }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {collections.map((c) => {
        const geometry = geometries.get(zukanGeometryKey(c.prefCode, c.cityCode));
        const meta = ZUKAN_DIFFICULTY_META[c.bestDifficulty];
        return (
          <Link
            key={`${c.prefCode}-${c.cityCode}`}
            href={hrefFor(c)}
            className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-3 flex flex-col items-center gap-1.5 hover:shadow-[0_4px_16px_rgba(234,88,12,0.15)] transition-shadow"
          >
            <div className="w-full aspect-square flex items-center justify-center">
              {geometry ? (
                <MunicipalitySilhouette geometry={geometry} className="w-full h-full" />
              ) : (
                <div className="w-full h-full rounded-lg bg-[#f8f4ea]" />
              )}
            </div>
            <div className="text-xs font-semibold text-[#3c2a14] text-center truncate w-full">
              {c.prefName} {c.cityName}
            </div>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${meta.badgeClass}`}>
              {meta.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
