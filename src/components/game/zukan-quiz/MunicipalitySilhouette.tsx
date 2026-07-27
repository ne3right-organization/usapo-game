"use client";

import { useMemo } from "react";
import type { GeoJsonGeometry } from "@/lib/game/zukanQuizClient";

export interface MunicipalitySilhouetteProps {
  geometry: GeoJsonGeometry;
  fillColor?: string;
  className?: string;
}

const VIEW_SIZE = 300;
const PADDING_RATIO = 0.08;

function ringsOf(geometry: GeoJsonGeometry): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

// 縮尺(実際の大きさ)は伏せる仕様のため、bboxをVIEW_SIZE一杯に正規化して表示する。
// 向き(北が上)は変えない。経度方向は緯度に応じたcos補正をして形の歪みを抑える
function buildPath(geometry: GeoJsonGeometry): { path: string; viewBox: string } {
  const rings = ringsOf(geometry);
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const latMid = (minLat + maxLat) / 2;
  const lngScale = Math.cos((latMid * Math.PI) / 180);
  const contentWidth = (maxLng - minLng || 1) * lngScale;
  const contentHeight = maxLat - minLat || 1;
  const scale = (VIEW_SIZE * (1 - PADDING_RATIO * 2)) / Math.max(contentWidth, contentHeight);
  const offsetX = (VIEW_SIZE - contentWidth * scale) / 2;
  const offsetY = (VIEW_SIZE - contentHeight * scale) / 2;

  const project = (lng: number, lat: number): [number, number] => {
    const x = (lng - minLng) * lngScale * scale + offsetX;
    const y = VIEW_SIZE - ((lat - minLat) * scale + offsetY); // 緯度は上ほど大きいのでY反転
    return [x, y];
  };

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const path = polygons
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map(([lng, lat], i) => {
              const [x, y] = project(lng, lat);
              return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ") + " Z"
        )
        .join(" ")
    )
    .join(" ");

  return { path, viewBox: `0 0 ${VIEW_SIZE} ${VIEW_SIZE}` };
}

// 市区町村のシルエットをSVGで描画する。穴(飛び地の湖沼など)はfillRule=evenoddで表現する
export default function MunicipalitySilhouette({ geometry, fillColor = "#57534e", className }: MunicipalitySilhouetteProps) {
  const { path, viewBox } = useMemo(() => buildPath(geometry), [geometry]);

  return (
    <svg viewBox={viewBox} className={className} role="img" aria-label="出題対象の市区町村のシルエット">
      <path d={path} fill={fillColor} fillRule="evenodd" stroke={fillColor} strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}
