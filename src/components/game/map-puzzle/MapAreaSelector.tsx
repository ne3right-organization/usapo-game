"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
// 地図パズル以外(地図ポットンなど)からも使うため、Leaflet のCSSはこのコンポーネント自身で読み込む
import "leaflet/dist/leaflet.css";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

export type MapAreaSelectorDifficulty = "intermediate" | "advanced";

export interface AreaInfo {
  difficulty: MapAreaSelectorDifficulty;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

export interface MapAreaSelectorProps {
  difficulty: MapAreaSelectorDifficulty;
  /** 見出しに出す説明(「都道府県を選んで、市区町村をくっつけよう」など) */
  description: string;
  onConfirm: (geojsonUrl: string, areaLabel: string, area: AreaInfo) => void;
}

const THEME: Record<MapAreaSelectorDifficulty, { header: string; badge: string; btn: string; color: string }> = {
  intermediate: { header: "bg-violet-700", badge: "bg-violet-900/40", btn: "bg-violet-700 hover:bg-violet-800", color: "#7c3aed" },
  advanced: { header: "bg-teal-700", badge: "bg-teal-900/40", btn: "bg-teal-700 hover:bg-teal-800", color: "#0f766e" },
};

// バックエンドの状態集計を持たないため、全エリアをこの中立色1色で表示する
const NEUTRAL_COLOR = { fill: "#ffffff", stroke: "#9ca3af" };
const SELECTED_STROKE = "#1d4ed8";

interface FeatureInfo {
  code: string;
  name: string;
}

// ─── クリック可能なコロプレス地図（都道府県・市区町村選択の両方で使い回す）───────────

interface ChoroplethMapProps {
  geojsonUrl: string;
  getFeatureInfo: (feature: unknown) => FeatureInfo | null;
  onSelect: (code: string, name: string) => void;
}

function ChoroplethMap({ geojsonUrl, getFeatureInfo, onSelect }: ChoroplethMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let mapInstance: L.Map | null = null;

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

      let selectedLayer: L.GeoJSON | null = null;
      let bounds: L.LatLngBounds | null = null;

      (data.features ?? []).forEach((feature) => {
        const info = getFeatureInfo(feature);
        if (!info) return;
        const normalStyle: L.PathOptions = {
          color: NEUTRAL_COLOR.stroke,
          weight: 1,
          fillColor: NEUTRAL_COLOR.fill,
          fillOpacity: 0.75,
        };
        const layer = Lmod.geoJSON(feature as Parameters<typeof L.geoJSON>[0], { style: normalStyle }).addTo(map);
        // どこがどこか分かるよう、地域の名前を地図の上に出しておく(タップの邪魔にならないよう、名前はクリックを受けない)
        layer.bindTooltip(info.name, { permanent: true, direction: "center", className: "area-name-label", interactive: false });

        const b = layer.getBounds();
        if (b.isValid()) {
          bounds = bounds ? bounds.extend(b) : Lmod.latLngBounds(b.getSouthWest(), b.getNorthEast());
        }

        layer.on("click", () => {
          if (selectedLayer && selectedLayer !== layer) {
            selectedLayer.setStyle(normalStyle);
          }
          layer.setStyle({ ...normalStyle, weight: 3, color: SELECTED_STROKE });
          layer.bringToFront();
          selectedLayer = layer;
          onSelect(info.code, info.name);
        });
      });

      if (bounds) map.fitBounds(bounds, { padding: [16, 16] });
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojsonUrl]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#fdf8f0]/80">
          <p className="text-sm text-[#a8937a]">地図を読み込み中...</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#fdf8f0]/95 px-6 text-center">
          <p className="text-sm text-red-600">地図の読み込みに失敗しました</p>
          <p className="text-xs text-[#78716c]">{error}</p>
        </div>
      )}
    </div>
  );
}

// ─── メインコンポーネント ───────────────────────────────────────────────────────

export default function MapAreaSelector({ difficulty, description, onConfirm }: MapAreaSelectorProps) {
  const theme = THEME[difficulty];

  const [step, setStep] = useState<"prefecture" | "city">("prefecture");
  const [selectedPref, setSelectedPref] = useState<{ code: string; name: string } | null>(null);
  const [selectedCity, setSelectedCity] = useState<{ code: string; name: string } | null>(null);

  const prefFeatureInfo = (feature: unknown): FeatureInfo | null => {
    const props = (feature as { properties?: Record<string, unknown> })?.properties;
    const prefNum = props?.pref;
    if (prefNum == null) return null;
    const code = String(prefNum).padStart(2, "0");
    const name = String(props?.name ?? code);
    return { code, name };
  };

  const cityFeatureInfo = (feature: unknown): FeatureInfo | null => {
    const props = (feature as { properties?: Record<string, unknown> })?.properties;
    const code = props?.cityCode ? String(props.cityCode) : null;
    const name = props?.cityName ? String(props.cityName) : null;
    if (!code || !name) return null;
    return { code, name };
  };

  const handleConfirmPrefecture = () => {
    if (!selectedPref) return;
    if (difficulty === "intermediate") {
      const url = `${CLOUDFRONT_URL}/geojson/municipality/2020/${selectedPref.code}.geojson`;
      const label = `${selectedPref.name}（市区町村）`;
      onConfirm(url, label, { difficulty, prefCode: selectedPref.code, prefName: selectedPref.name });
    } else {
      setStep("city");
    }
  };

  const handleConfirmCity = () => {
    if (!selectedPref || !selectedCity) return;
    const url = `${CLOUDFRONT_URL}/geojson/town-district/2020/${selectedPref.code}/${selectedCity.code}.geojson`;
    const label = `${selectedCity.name}（町丁）`;
    onConfirm(url, label, {
      difficulty,
      prefCode: selectedPref.code,
      prefName: selectedPref.name,
      cityCode: selectedCity.code,
      cityName: selectedCity.name,
    });
  };

  // 市区町村を選ぶ段階から、都道府県を選ぶ段階に戻る(ゲームのトップへはサイトのヘッダー・下のタブから戻る)
  const backToPrefecture = () => {
    setStep("prefecture");
    setSelectedCity(null);
  };

  const showingCityStep = difficulty === "advanced" && step === "city" && selectedPref;

  return (
    // 画面全体は覆わず、サイトのヘッダー(h-10)と地図ゲームの下のタブ(4rem)の間に収める(エリアを選ぶ間もヘッダー・タブを使えるように)。
    // 地図(Leaflet)は高さが決まっていないと潰れるので、画面の高さから引いて決める
    <div className="h-[calc(100dvh-2.5rem-4rem-env(safe-area-inset-bottom))] min-h-[24rem] flex flex-col bg-[#fdf8f0]">
      {/* 見出し: 何をする画面かの説明だけ。市区町村を選ぶ段階では、都道府県を選び直す「←」と都道府県名を出す */}
      <div className={`flex items-center gap-2 px-4 h-[44px] shrink-0 shadow-md ${theme.header}`}>
        {showingCityStep && (
          <button type="button" onClick={backToPrefecture} className="text-white opacity-90 shrink-0 text-lg leading-none" title="都道府県を選び直す">
            ←
          </button>
        )}
        <span className="text-sm font-semibold text-white truncate">
          {showingCityStep ? `${selectedPref!.name}の市区町村を選んでね` : description}
        </span>
      </div>

      {showingCityStep ? (
        <ChoroplethMap
          key={`city-${selectedPref!.code}`}
          geojsonUrl={`${CLOUDFRONT_URL}/geojson/municipality/2020/${selectedPref!.code}.geojson`}
          getFeatureInfo={cityFeatureInfo}
          onSelect={(code, name) => setSelectedCity({ code, name })}
        />
      ) : (
        <ChoroplethMap
          key={`pref-${difficulty}`}
          geojsonUrl={`${CLOUDFRONT_URL}/geojson/prefecture/prefectures.geojson`}
          getFeatureInfo={prefFeatureInfo}
          onSelect={(code, name) => setSelectedPref({ code, name })}
        />
      )}

      {/* 選択確認バー */}
      {(showingCityStep ? selectedCity : selectedPref) && (
        <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-[#3c2a14] flex-1 truncate">
            {showingCityStep ? selectedCity!.name : selectedPref!.name}
          </span>
          <button
            type="button"
            onClick={showingCityStep ? handleConfirmCity : handleConfirmPrefecture}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors duration-150 ${theme.btn}`}
          >
            {showingCityStep ? "このエリアで開始" : difficulty === "advanced" ? "次へ(市区町村を選ぶ)" : "このエリアで開始"}
          </button>
        </div>
      )}
    </div>
  );
}
