"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";

// コンプリート表示用の塗り分け地図。MapAreaSelector の ChoroplethMap と同じく geojson を読んで
// 地物ごとにレイヤーを作るが、塗り色はクリア状況に合わせて外から渡し、データが変わったら読み直さずに塗り直す

export interface MapFeatureKey {
  code: string;
  name: string;
}

export interface FillStyle {
  color: string;
  opacity: number;
}

export interface CompletionMapProps {
  geojsonUrl: string;
  featureKey: (feature: unknown) => MapFeatureKey | null;
  /** null なら塗らない(未クリア) */
  fillFor: (code: string) => FillStyle | null;
  selectedCode?: string | null;
  /** 渡さなければタップできない地図にする */
  onSelect?: (key: MapFeatureKey) => void;
  /** 読み込んだ地物(コードの重複は除く)。県内の市区町村数を数えるのに使う */
  onLoaded?: (keys: MapFeatureKey[]) => void;
  /** 地図のどこかをタップしたときの緯度・経度(地物の上でも外でも)。地図タネの開発用の位置指定で使う */
  onPointSelect?: (lat: number, lng: number) => void;
  /** 地物の上に出す印(HTML。null なら出さない)。うさぽ農園のご当地の実の絵。印はタップを下の地物に通す */
  markerFor?: (code: string) => { html: string; size: number } | null;
}

/**
 * 印を置く点。いちばん大きい多角形(本土。離島に置かないように)の外周の範囲のまん中。
 * 東京都は小笠原まで入るので、地物全体の範囲のまん中だと海の上になる
 */
function labelPointOf(feature: unknown): { point: [number, number]; area: number } | null {
  const geometry = (feature as { geometry?: { type?: string; coordinates?: unknown } })?.geometry;
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : geometry?.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][])
        : [];
  let best: { point: [number, number]; area: number } | null = null;
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    if (ring.length === 0) continue;
    // 点が多い(北海道は数万)ので、Math.min(...配列) ではなく1つずつ見る
    let [minLng, maxLng, minLat, maxLat] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const area = (maxLng - minLng) * (maxLat - minLat);
    if (!best || area > best.area) best = { point: [(minLat + maxLat) / 2, (minLng + maxLng) / 2], area };
  }
  return best;
}

const UNCLEARED: FillStyle = { color: "#ffffff", opacity: 0.75 };
const STROKE = "#9ca3af";
const SELECTED_STROKE = "#1d4ed8";

export default function CompletionMap({
  geojsonUrl,
  featureKey,
  fillFor,
  selectedCode = null,
  onSelect,
  onLoaded,
  onPointSelect,
  markerFor,
}: CompletionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<Map<string, L.GeoJSON[]>>(new Map());
  // 印を置く点(地物のいちばん大きい島のまん中)と、印を置く層
  const labelPointsRef = useRef<Map<string, { point: [number, number]; area: number }>>(new Map());
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const callbacksRef = useRef({ featureKey, onSelect, onLoaded, onPointSelect });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    callbacksRef.current = { featureKey, onSelect, onLoaded, onPointSelect };
  });

  useEffect(() => {
    let cancelled = false;
    let mapInstance: L.Map | null = null;
    layersRef.current = new Map();
    labelPointsRef.current = new Map();

    (async () => {
      const leaflet = await import("leaflet");
      const Lmod = (leaflet as { default?: typeof L }).default ?? (leaflet as unknown as typeof L);
      if (cancelled || !containerRef.current) return;

      const map = Lmod.map(containerRef.current, {
        center: [36.5, 137.0],
        zoom: 5,
        zoomControl: true,
        attributionControl: false,
      });
      mapInstance = map;
      leafletRef.current = Lmod;
      markerLayerRef.current = Lmod.layerGroup().addTo(map);
      Lmod.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { opacity: 0.5 }).addTo(map);
      // 地物の上のタップも地図まで伝わってくる(Leaflet の既定)
      map.on("click", (e: L.LeafletMouseEvent) => callbacksRef.current.onPointSelect?.(e.latlng.lat, e.latlng.lng));

      let data: { features?: unknown[] };
      try {
        const resp = await fetch(geojsonUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;

      let bounds: L.LatLngBounds | null = null;
      const keys = new Map<string, MapFeatureKey>();
      for (const feature of data.features ?? []) {
        const key = callbacksRef.current.featureKey(feature);
        if (!key) continue;
        keys.set(key.code, key);
        const layer = Lmod.geoJSON(feature as Parameters<typeof L.geoJSON>[0]).addTo(map);
        const list = layersRef.current.get(key.code) ?? [];
        list.push(layer);
        layersRef.current.set(key.code, list);
        const b = layer.getBounds();
        if (b.isValid()) bounds = bounds ? bounds.extend(b) : Lmod.latLngBounds(b.getSouthWest(), b.getNorthEast());
        layer.on("click", () => callbacksRef.current.onSelect?.(key));
        const label = labelPointOf(feature);
        const prev = labelPointsRef.current.get(key.code);
        if (label && (!prev || label.area > prev.area)) labelPointsRef.current.set(key.code, label);
      }

      if (bounds) map.fitBounds(bounds, { padding: [12, 12] });
      callbacksRef.current.onLoaded?.([...keys.values()]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [geojsonUrl]);

  // クリア状況・選択が変わったら塗り直す(読み込みが終わったときも)
  useEffect(() => {
    if (loading) return;
    for (const [code, layers] of layersRef.current) {
      const fill = fillFor(code) ?? UNCLEARED;
      const selected = code === selectedCode;
      for (const layer of layers) {
        layer.setStyle({
          color: selected ? SELECTED_STROKE : STROKE,
          weight: selected ? 3 : 1,
          fillColor: fill.color,
          fillOpacity: fill.opacity,
        });
        if (selected) layer.bringToFront();
      }
    }
  }, [loading, fillFor, selectedCode]);

  // 印を置き直す
  useEffect(() => {
    const Lmod = leafletRef.current;
    const group = markerLayerRef.current;
    if (loading || !Lmod || !group) return;
    group.clearLayers();
    if (!markerFor) return;
    for (const [code, { point }] of labelPointsRef.current) {
      const marker = markerFor(code);
      if (!marker) continue;
      Lmod.marker(point, {
        icon: Lmod.divIcon({ html: marker.html, className: "", iconSize: [marker.size, marker.size] }),
        interactive: false,
        keyboard: false,
      }).addTo(group);
    }
  }, [loading, markerFor]);

  return (
    <div className="relative h-[360px] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(120,90,40,0.08)] bg-white">
      <div ref={containerRef} className="w-full h-full" />
      {loading && !error && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-[#fdf8f0]/80">
          <p className="text-sm text-[#a8937a]">地図を読み込み中...</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 bg-[#fdf8f0]/95 px-6 text-center">
          <p className="text-sm text-red-600">地図の読み込みに失敗しました</p>
          <p className="text-xs text-[#78716c]">{error}</p>
        </div>
      )}
    </div>
  );
}
