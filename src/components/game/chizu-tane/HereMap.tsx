"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TaneBase } from "@/lib/game/chizuTaneData";
import { isHiddenLocalBase } from "@/lib/game/chizuTane/localItems";
import { taneMarkerIcon } from "./taneMarker";

// おでかけの地図: その市区町村の町丁 geojson を読み、現在地・いまいる地区・まかれているタネ(全国農地と同じアイコン)を出す。
// 地区は線も塗りも透明にして下の地図をそのまま見せ、いまいる地区だけ縁取る(透明でもタップは効く)

const SELECTED_STYLE = { color: "#1d4ed8", weight: 3, opacity: 1, fillColor: "#1d4ed8", fillOpacity: 0.08 };
const HIDDEN_STYLE = { color: "#000000", weight: 1, opacity: 0, fillOpacity: 0 };

export interface HereMapProps {
  geojsonUrl: string;
  /** いまいる地区(KEY_CODE) */
  selectedCode: string | null;
  /** 現在地(位置情報、または開発用の位置指定で選んだ点) */
  location: { lat: number; lng: number } | null;
  bases: TaneBase[];
  /** 自分のタネの地区(ほかの人のご当地の畑は、何の畑かを伏せて出す) */
  ownAreaKeys: ReadonlySet<string>;
  /** 地図のどこかをタップしたとき(開発用の位置指定)。渡さなければタップしても何もしない */
  onPointSelect?: (lat: number, lng: number) => void;
}

export default function HereMap({ geojsonUrl, selectedCode, location, bases, ownAreaKeys, onPointSelect }: HereMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ map: L.Map; Lmod: typeof L } | null>(null);
  const layersRef = useRef<Map<string, L.GeoJSON[]>>(new Map());
  const markersRef = useRef<L.LayerGroup | null>(null);
  const hereRef = useRef<L.CircleMarker | null>(null);
  const onPointSelectRef = useRef(onPointSelect);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    onPointSelectRef.current = onPointSelect;
  });

  // 市区町村が変わったら地図を作り直す
  useEffect(() => {
    let cancelled = false;
    let mapInstance: L.Map | null = null;
    layersRef.current = new Map();

    (async () => {
      const leaflet = await import("leaflet");
      setLoading(true);
      setError("");
      const Lmod = (leaflet as { default?: typeof L }).default ?? (leaflet as unknown as typeof L);
      if (cancelled || !containerRef.current) return;

      const map = Lmod.map(containerRef.current, { center: [36.5, 137.0], zoom: 5, attributionControl: false });
      mapInstance = map;
      Lmod.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
      // 地区の上のタップも地図まで伝わってくる(Leaflet の既定)
      map.on("click", (e: L.LeafletMouseEvent) => onPointSelectRef.current?.(e.latlng.lat, e.latlng.lng));

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
      for (const feature of data.features ?? []) {
        const code = (feature as { properties?: Record<string, unknown> }).properties?.KEY_CODE;
        if (typeof code !== "string") continue;
        const layer = Lmod.geoJSON(feature as Parameters<typeof L.geoJSON>[0], { style: HIDDEN_STYLE }).addTo(map);
        layersRef.current.set(code, [...(layersRef.current.get(code) ?? []), layer]);
        const b = layer.getBounds();
        if (b.isValid()) bounds = bounds ? bounds.extend(b) : Lmod.latLngBounds(b.getSouthWest(), b.getNorthEast());
      }
      if (bounds) map.fitBounds(bounds, { padding: [12, 12] });
      markersRef.current = Lmod.layerGroup().addTo(map);
      mapRef.current = { map, Lmod };
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapRef.current = null;
      markersRef.current = null;
      hereRef.current = null;
    };
  }, [geojsonUrl]);

  // いまいる地区を縁取る
  useEffect(() => {
    if (loading) return;
    for (const [code, layers] of layersRef.current) {
      const selected = code === selectedCode;
      for (const layer of layers) {
        layer.setStyle(selected ? SELECTED_STYLE : HIDDEN_STYLE);
        if (selected) layer.bringToFront();
      }
    }
  }, [loading, selectedCode]);

  // まかれているタネ。開発用の位置指定があるときは、アイコンをタップするとそのタネの地区に移る
  useEffect(() => {
    const m = mapRef.current;
    const group = markersRef.current;
    if (loading || !m || !group) return;
    group.clearLayers();
    for (const b of bases) {
      if (typeof b.repLat !== "number" || typeof b.repLng !== "number") continue;
      const lat = b.repLat;
      const lng = b.repLng;
      m.Lmod.marker([lat, lng], { icon: taneMarkerIcon(m.Lmod, b, isHiddenLocalBase(b, ownAreaKeys.has(b.areaKey))) })
        .on("click", () => onPointSelectRef.current?.(lat, lng))
        .addTo(group);
    }
  }, [loading, bases, ownAreaKeys]);

  // 現在地
  useEffect(() => {
    const m = mapRef.current;
    if (loading || !m) return;
    hereRef.current?.remove();
    hereRef.current = location
      ? m.Lmod.circleMarker([location.lat, location.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#2563eb",
          fillOpacity: 1,
          interactive: false,
        }).addTo(m.map)
      : null;
  }, [loading, location]);

  return (
    <div className="relative h-[340px] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(120,90,40,0.08)] bg-white">
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
