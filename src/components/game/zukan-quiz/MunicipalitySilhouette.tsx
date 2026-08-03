"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { GeoJsonGeometry } from "@/lib/game/zukanQuizClient";
import { fetchGsiRaster, type GsiTileLayer } from "@/lib/game/hillshadeRaster";

export interface MunicipalitySilhouetteProps {
  geometry: GeoJsonGeometry;
  fillColor?: string;
  className?: string;
  // 国土地理院タイル(陰影起伏図 or 標準地図)をシルエット内部にテクスチャとして重ねる
  // (取得失敗時は単色塗りにフォールバック)。指定する場合、呼び出し側で出典(国土地理院)の
  // クレジット表示が必要。未指定(undefined)なら単色シルエットのまま
  terrainLayer?: GsiTileLayer;
}

const VIEW_SIZE = 300;
const PADDING_RATIO = 0.08;

function ringsOf(geometry: GeoJsonGeometry): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

interface Projection {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  project: (lng: number, lat: number) => [number, number];
}

// 縮尺(実際の大きさ)は伏せる仕様のため、bboxをVIEW_SIZE一杯に正規化して表示する。
// 向き(北が上)は変えない。経度方向は緯度に応じたcos補正をして形の歪みを抑える
function buildProjection(geometry: GeoJsonGeometry): Projection {
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

  return { minLng, maxLng, minLat, maxLat, project };
}

function buildPath(projection: Projection, geometry: GeoJsonGeometry): string {
  const { project } = projection;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons
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
}

// 市区町村のシルエットをSVGで描画する。穴(飛び地の湖沼など)はfillRule=evenoddで表現する
export default function MunicipalitySilhouette({
  geometry,
  fillColor = "#57534e",
  className,
  terrainLayer,
}: MunicipalitySilhouetteProps) {
  const { path, imageRect, bbox } = useMemo(() => {
    const projection = buildProjection(geometry);
    const path = buildPath(projection, geometry);
    // 陰影起伏図をシルエットと同じ座標系(project)で配置するための矩形
    const [x0, y0] = projection.project(projection.minLng, projection.maxLat);
    const [x1, y1] = projection.project(projection.maxLng, projection.minLat);
    return {
      path,
      imageRect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      bbox: {
        minLng: projection.minLng,
        maxLng: projection.maxLng,
        minLat: projection.minLat,
        maxLat: projection.maxLat,
      },
    };
  }, [geometry]);

  const clipId = useId();
  const [terrainUrl, setTerrainUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!terrainLayer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTerrainUrl(null);
      return;
    }
    let cancelled = false;
    // 新しい問題(geometry)/レイヤ切り替え時、前のテクスチャが一瞬残らないようリセットする
    setTerrainUrl(null);
    fetchGsiRaster(bbox, terrainLayer).then((canvas) => {
      if (cancelled || !canvas) return;
      try {
        setTerrainUrl(canvas.toDataURL("image/png"));
      } catch {
        setTerrainUrl(null); // CORS等で取得できなければ単色塗りのまま
      }
    });
    return () => {
      cancelled = true;
    };
  }, [terrainLayer, bbox]);

  return (
    <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className={className} role="img" aria-label="出題対象の市区町村のシルエット">
      <defs>
        <clipPath id={clipId}>
          <path d={path} fillRule="evenodd" />
        </clipPath>
      </defs>
      <path d={path} fill={fillColor} fillRule="evenodd" stroke={fillColor} strokeWidth={1} strokeLinejoin="round" />
      {terrainUrl && (
        <image
          href={terrainUrl}
          x={imageRect.x}
          y={imageRect.y}
          width={imageRect.width}
          height={imageRect.height}
          preserveAspectRatio="none"
          clipPath={`url(#${clipId})`}
          opacity={0.85}
        />
      )}
    </svg>
  );
}
