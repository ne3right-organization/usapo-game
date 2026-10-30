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
}: CompletionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<Map<string, L.GeoJSON[]>>(new Map());
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
