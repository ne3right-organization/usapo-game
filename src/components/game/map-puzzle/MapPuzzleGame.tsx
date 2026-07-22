"use client";

import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import type L from "leaflet";
import { submitChallenge, saveProgress, type SavedProgressRecord } from "@/lib/game/mapPuzzleData";

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface MapPuzzleGameProps {
  difficulty: Difficulty;
  geojsonUrl: string;
  areaLabel: string;
  namePropCandidates: string[];
  // 進行状況の保存キーに使うエリア情報
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
  // サーバーの途中保存から再開する場合に渡す（無ければ sessionStorage を見る）
  initialProgress?: SavedProgressRecord | null;
  onRetry?: () => void;
  // 「保存して中断」実行後に呼ばれる（ゲーム画面を抜ける処理は呼び出し側に任せる）
  onSaveAndExit?: () => void;
}

interface GeoJsonGeometryPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

interface GeoJsonGeometryMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

type GeoJsonGeometry = GeoJsonGeometryPolygon | GeoJsonGeometryMultiPolygon;

interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: Record<string, string | number | null>;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

interface PieceData {
  id: number;
  name: string;
  feature: GeoJsonFeature;
  centroid: { lat: number; lng: number };
  layer: L.GeoJSON | null;
  labelMarker: L.Marker | null;
  placed: boolean;
  canvasRef: HTMLCanvasElement | null;
  itemRef: HTMLDivElement | null;
  // 町丁パズル（上級）の人口（JINKO）。取得できない/対象外の難易度では null
  population: number | null;
}

interface ScoreResult {
  base: number;
  timeBonus: number;
  missPenalty: number;
  total: number;
  elapsedSec: number;
  // 得点計算に使ったピース数（人口0スキップ分を除いた数）
  scoredTotal: number;
  skippedCount: number;
}

// 誤操作によるリロード・離脱からの復帰用に、配置済みピースをセッション単位で保存する
interface SavedProgress {
  placedIds: number[];
  missCount: number;
  elapsedSec: number;
  areaLabel: string;
  updatedAt: number;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

export function progressStorageKey(difficulty: Difficulty, geojsonUrl: string): string {
  return `mapPuzzleProgress:${difficulty}:${geojsonUrl}`;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const THEME_COLORS: Record<Difficulty, string> = {
  beginner: "#2563eb",
  intermediate: "#7c3aed",
  advanced: "#0f766e",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
};

const COLOR_PLACED = "#4f8ef7";
const COLOR_GIVEUP = "#fca5a5";
const COLOR_GIVEUP_STROKE = "#dc2626";
const COLOR_OUTLINE = "#9ba8b5";
const COLOR_FILL_DEFAULT = "#eceff1";

// ─── ユーティリティ関数 ────────────────────────────────────────────────────────

function getName(feature: GeoJsonFeature, candidates: string[]): string {
  const props = feature.properties;
  for (const key of candidates) {
    const v = props[key];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "不明";
}

// 町丁パズル（上級）のGeoJSONに含まれる人口（JINKO）を取得。無い/数値でない場合は null
function getPopulation(feature: GeoJsonFeature): number | null {
  const raw = feature.properties["JINKO"];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function calcCentroid(feature: GeoJsonFeature): { lat: number; lng: number } {
  let allCoords: number[][] = [];
  if (feature.geometry.type === "Polygon") {
    allCoords = feature.geometry.coordinates[0];
  } else {
    feature.geometry.coordinates.forEach((poly) => {
      allCoords.push(...poly[0]);
    });
  }
  if (allCoords.length === 0) return { lat: 36.5, lng: 137.0 };
  const lats = allCoords.map((c) => c[1]);
  const lngs = allCoords.map((c) => c[0]);
  const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
  return { lat, lng };
}

// サムネイル用：最大ポリゴン（面積が最大の外周リング）を返す
// 離島が多い都道府県（東京・沖縄等）のbbox歪みを防ぐため本体のみを対象にする
function getLargestOuterRing(feature: GeoJsonFeature): number[][] {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates[0];
  }
  let bestRing: number[][] = [];
  let bestArea = -1;
  for (const poly of feature.geometry.coordinates) {
    const ring = poly[0];
    if (ring.length === 0) continue;
    const lngs = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    const dLng = Math.max(...lngs) - Math.min(...lngs);
    const dLat = Math.max(...lats) - Math.min(...lats);
    const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const area = dLng * Math.cos((avgLat * Math.PI) / 180) * dLat;
    if (area > bestArea) {
      bestArea = area;
      bestRing = ring;
    }
  }
  return bestRing;
}

function drawThumbnail(
  canvas: HTMLCanvasElement,
  feature: GeoJsonFeature,
  fillColor: string,
  strokeColor: string
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // bbox・描画ともに最大ポリゴンのみ使用（離島による歪み防止 + cos(lat)補正）
  const ring = getLargestOuterRing(feature);
  if (ring.length === 0) return;

  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const dLng = maxLng - minLng || 0.01;
  const dLat = maxLat - minLat || 0.01;

  // 緯度による経度方向の圧縮を補正（日本付近: cos(38°)≈0.788）
  const avgLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((avgLat * Math.PI) / 180);

  const pad = 4;
  const scale = Math.min((W - pad * 2) / (dLng * cosLat), (H - pad * 2) / dLat);
  const offX = pad + (W - pad * 2 - dLng * cosLat * scale) / 2;
  const offY = pad + (H - pad * 2 - dLat * scale) / 2;

  const project = (c: number[]): [number, number] => [
    offX + (c[0] - minLng) * cosLat * scale,
    H - offY - (c[1] - minLat) * scale,
  ];

  ctx.beginPath();
  ring.forEach((c, i) => {
    const [x, y] = project(c);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

// ─── Point-in-Polygon（ray casting） ─────────────────────────────────────────

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  const n = ring.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring[i][0]; // lng
    const yi = ring[i][1]; // lat
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

function pointInPolygon(lat: number, lng: number, feature: GeoJsonFeature): boolean {
  if (feature.geometry.type === "Polygon") {
    return pointInRing(lat, lng, feature.geometry.coordinates[0]);
  } else {
    return feature.geometry.coordinates.some((poly) => pointInRing(lat, lng, poly[0]));
  }
}

// ─── 時間フォーマット ─────────────────────────────────────────────────────────

function formatTime(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ─── メインコンポーネント ───────────────────────────────────────────────────────

export default function MapPuzzleGame({
  difficulty,
  geojsonUrl,
  areaLabel,
  namePropCandidates,
  prefCode,
  prefName,
  cityCode,
  cityName,
  initialProgress,
  onRetry,
  onSaveAndExit,
}: MapPuzzleGameProps) {
  const themeColor = THEME_COLORS[difficulty];
  const diffLabel = DIFFICULTY_LABELS[difficulty];
  const router = useRouter();

  // UI State
  const [phase, setPhase] = useState<"loading" | "playing" | "clear" | "error">("loading");
  const [placedCount, setPlacedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [missCount, setMissCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [flashType, setFlashType] = useState<"snap" | "miss" | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [comment, setComment] = useState("");
  const [challengeSubmitState, setChallengeSubmitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const challengeSubmittedRef = useRef(false);
  // 人口0スキップ（上級のみ）: スキップ済みピース数と、未配置の人口0ピース残数
  const skippedCountRef = useRef(0);
  const [zeroPopRemaining, setZeroPopRemaining] = useState(0);

  // Refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const LRef = useRef<typeof L | null>(null);
  const piecesRef = useRef<PieceData[]>([]);
  const draggingRef = useRef<PieceData | null>(null);
  const ghostRef = useRef<HTMLCanvasElement | null>(null);
  const ghostContainerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const placedCountRef = useRef(0);
  const missCountRef = useRef(0);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<"loading" | "playing" | "clear" | "error">("loading");
  const pendingDragRef = useRef<{ piece: PieceData; startX: number; startY: number; lastX: number } | null>(null);
  const startDragRef = useRef<(piece: PieceData, e: PointerEvent) => void>(() => {});

  // flash helper
  const triggerFlash = useCallback((type: "snap" | "miss") => {
    setFlashType(type);
    setTimeout(() => setFlashType(null), type === "snap" ? 200 : 250);
  }, []);

  // ─── ラベル追加 ────────────────────────────────────────────────────────────
  const addLabel = useCallback((piece: PieceData, color: string) => {
    const L2 = LRef.current;
    const map2 = mapRef.current;
    if (!L2 || !map2) return;
    if (piece.labelMarker) map2.removeLayer(piece.labelMarker);
    piece.labelMarker = L2.marker([piece.centroid.lat, piece.centroid.lng], {
      icon: L2.divIcon({
        html: `<div style="font-size:10px;white-space:nowrap;background:rgba(255,255,255,0.85);padding:1px 5px;border-radius:4px;color:${color};font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.2)">${piece.name}</div>`,
        className: "",
        iconAnchor: [0, 8],
      }),
    }).addTo(map2) as L.Marker;
  }, []);

  // ─── 初期化 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let cancelled = false;

    const init = async () => {
      // Leaflet 動的インポート
      const leaflet = await import("leaflet");
      const Lmod = leaflet.default ?? leaflet;
      if (cancelled) return;
      LRef.current = Lmod as typeof L;

      // 地図初期化
      const mapEl = mapContainerRef.current!;
      const mapInstance = Lmod.map(mapEl, {
        center: [36.5, 137.0],
        zoom: 5,
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = mapInstance as L.Map;

      Lmod.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        opacity: 0.55,
      }).addTo(mapInstance);

      // GeoJSON取得
      let data: GeoJsonFeatureCollection;
      try {
        const resp = await fetch(geojsonUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            `GeoJSONの取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`
          );
          setPhase("error");
          phaseRef.current = "error";
        }
        return;
      }
      if (cancelled) return;

      // ピース生成
      const pieces: PieceData[] = data.features.map((feature, idx) => {
        const name = getName(feature, namePropCandidates);
        const centroid = calcCentroid(feature);

        const layer = (Lmod as typeof L).geoJSON(feature as Parameters<typeof L.geoJSON>[0], {
          style: {
            color: COLOR_OUTLINE,
            weight: 1,
            fillColor: COLOR_FILL_DEFAULT,
            fillOpacity: 0.7,
            dashArray: "2 2",
          },
        }).addTo(mapInstance);

        return {
          id: idx,
          name,
          feature,
          centroid,
          layer,
          labelMarker: null,
          placed: false,
          canvasRef: null,
          itemRef: null,
          population: difficulty === "advanced" ? getPopulation(feature) : null,
        };
      });

      // シャッフル
      const shuffled = [...pieces].sort(() => Math.random() - 0.5);
      piecesRef.current = pieces;

      setTotalCount(pieces.length);
      placedCountRef.current = 0;

      // 地図をデータのboundsにフィット（初期ズームを最適化）
      {
        let allBounds: L.LatLngBounds | null = null;
        for (const p of pieces) {
          const b = (p.layer as L.GeoJSON | null)?.getBounds();
          if (!b || !b.isValid()) continue;
          if (!allBounds) {
            allBounds = (Lmod as typeof L).latLngBounds(b.getSouthWest(), b.getNorthEast());
          } else {
            allBounds.extend(b);
          }
        }
        if (allBounds?.isValid()) {
          (mapInstance as L.Map).fitBounds(allBounds, { padding: [20, 20] });
        }
      }

      // トレイにキャンバスを描画（DOMは trayRef にアクセス）
      if (trayRef.current) {
        trayRef.current.innerHTML = "";
        shuffled.forEach((piece) => {
          const item = document.createElement("div");
          item.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            cursor: grab;
            user-select: none;
            touch-action: none;
            flex: 0 0 auto;
            width: 92px;
          `;

          const canvas = document.createElement("canvas");
          canvas.width = 92;
          canvas.height = 92;
          canvas.style.cssText = `
            width: 92px;
            height: 92px;
            border: 2px solid #cbd5e1;
            border-radius: 8px;
            background: #eff6ff;
            display: block;
            transition: border-color 0.15s, opacity 0.3s;
          `;

          // サムネイル描画（テーマカラーを薄くする）
          const fillHex = themeColor + "33"; // ~20% opacity
          drawThumbnail(canvas, piece.feature, fillHex, themeColor);

          const nameEl = document.createElement("div");
          nameEl.style.cssText = `
            font-size: 13px;
            color: #6b7280;
            margin-top: 4px;
            text-align: center;
            line-height: 1.25;
            width: 92px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: normal;
            word-break: break-all;
          `;
          nameEl.textContent = piece.name;

          item.appendChild(canvas);
          item.appendChild(nameEl);
          trayRef.current!.appendChild(item);

          piece.canvasRef = canvas;
          piece.itemRef = item;

          // ポインターイベント
          item.addEventListener("pointerdown", (e) => {
            if (piece.placed || phaseRef.current !== "playing") return;
            e.preventDefault();
            pendingDragRef.current = { piece, startX: e.clientX, startY: e.clientY, lastX: e.clientX };
          });
        });
      }

      // 保存済み進行状況の復元。サーバーの途中保存（initialProgress）があればそちらを優先し、
      // 無ければ誤操作によるリロード・離脱からの復帰用に sessionStorage を見る
      let restoredElapsedSec = 0;
      const applyRestored = (placedIds: number[], savedMissCount: number, savedElapsedSec: number) => {
        const placedIdSet = new Set(placedIds);
        if (placedIdSet.size === 0 || placedIdSet.size >= pieces.length) return;
        pieces.forEach((piece) => {
          if (!placedIdSet.has(piece.id)) return;
          piece.placed = true;
          piece.layer?.setStyle({
            color: "#1d4ed8",
            weight: 1.5,
            fillColor: COLOR_PLACED,
            fillOpacity: 0.65,
            dashArray: undefined,
          });
          addLabel(piece, "#1d4ed8");
          if (piece.itemRef) {
            piece.itemRef.remove();
            piece.itemRef = null;
          }
        });
        placedCountRef.current = placedIdSet.size;
        missCountRef.current = savedMissCount;
        restoredElapsedSec = savedElapsedSec;
        setPlacedCount(placedCountRef.current);
        setMissCount(missCountRef.current);
        setElapsedSec(restoredElapsedSec);
      };

      if (initialProgress) {
        applyRestored(initialProgress.placedIds, initialProgress.missCount, initialProgress.elapsedSeconds);
      } else {
        try {
          const raw = sessionStorage.getItem(progressStorageKey(difficulty, geojsonUrl));
          if (raw) {
            const saved = JSON.parse(raw) as SavedProgress;
            applyRestored(saved.placedIds, saved.missCount ?? 0, saved.elapsedSec ?? 0);
          }
        } catch {
          // 保存データが壊れている場合は無視して最初から開始する
        }
      }

      // タイマー開始
      startTimeRef.current = Date.now() - restoredElapsedSec * 1000;
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);

      setPhase("playing");
      phaseRef.current = "playing";
    };

    init().catch((err) => {
      if (!cancelled) {
        setErrorMsg(String(err));
        setPhase("error");
        phaseRef.current = "error";
      }
    });

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojsonUrl]);

  // ─── スナップ処理 ──────────────────────────────────────────────────────────
  // opts.skipScore: 人口0スキップボタンによる自動配置。得点計算の対象ピース数から除外する
  const snapPiece = useCallback(
    (piece: PieceData, opts?: { silent?: boolean; skipScore?: boolean }) => {
      piece.placed = true;
      placedCountRef.current += 1;
      const newPlaced = placedCountRef.current;
      const total = piecesRef.current.length;

      if (opts?.skipScore) skippedCountRef.current += 1;

      piece.layer?.setStyle({
        color: "#1d4ed8",
        weight: 1.5,
        fillColor: COLOR_PLACED,
        fillOpacity: 0.65,
        dashArray: undefined,
      });

      addLabel(piece, "#1d4ed8");

      // piece-item をトレイから削除
      if (piece.itemRef) {
        piece.itemRef.remove();
        piece.itemRef = null;
      }

      setPlacedCount(newPlaced);
      if (!opts?.silent) triggerFlash("snap");

      if (newPlaced === total) {
        if (timerRef.current) clearInterval(timerRef.current);
        const elapsed = startTimeRef.current
          ? Math.floor((Date.now() - startTimeRef.current) / 1000)
          : 0;
        // 人口0スキップ分はピース数に含めない（得点に加算されない）
        const scoredTotal = Math.max(1, total - skippedCountRef.current);
        const base = scoredTotal * 10;
        const timeBonus = Math.max(0, scoredTotal * 5 - Math.floor(elapsed / 10));
        const missPenalty = missCountRef.current * 5;
        const scoreTotal = Math.max(0, base + timeBonus - missPenalty);
        setScore({
          base,
          timeBonus,
          missPenalty,
          total: scoreTotal,
          elapsedSec: elapsed,
          scoredTotal,
          skippedCount: skippedCountRef.current,
        });
        try {
          sessionStorage.removeItem(progressStorageKey(difficulty, geojsonUrl));
        } catch {
          // 保存領域が使えない環境は無視
        }
        setTimeout(() => {
          setPhase("clear");
          phaseRef.current = "clear";
          setShowResultModal(true);
        }, 600);
      }
    },
    [addLabel, triggerFlash, difficulty, geojsonUrl]
  );

  // ─── 人口0エリアの一括スキップ（上級のみ）────────────────────────────────────
  const handleSkipZeroPopulation = useCallback(() => {
    const targets = piecesRef.current.filter((p) => !p.placed && p.population === 0);
    if (targets.length === 0) return;
    const ok = confirm(
      `人口が0人のエリアを自動的にはめ込みます（${targets.length}件）。\n` +
        `これらのピースは得点には加算されません。よろしいですか？`
    );
    if (!ok) return;
    targets.forEach((p) => snapPiece(p, { silent: true, skipScore: true }));
    triggerFlash("snap");
  }, [snapPiece, triggerFlash]);

  // 配置状況が変わるたびに、上級での人口0未配置ピース数を再計算する
  // piecesRef はポインターイベントで直接書き換わる外部状態のため、effect側からの同期が必要
  useEffect(() => {
    if (phase !== "playing" || difficulty !== "advanced") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setZeroPopRemaining(0);
      return;
    }
    setZeroPopRemaining(piecesRef.current.filter((p) => !p.placed && p.population === 0).length);
  }, [phase, difficulty, placedCount]);

  // ─── 進行状況の自動保存(誤操作によるリロード・離脱対策)────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    if (placedCount >= totalCount) return; // クリア確定後の再保存を防ぐ（clear 遷移は setTimeout 待ちのため）
    const placedIds = piecesRef.current.filter((p) => p.placed).map((p) => p.id);
    if (placedIds.length === 0) return;
    const progress: SavedProgress = {
      placedIds,
      missCount,
      elapsedSec,
      areaLabel,
      updatedAt: Date.now(),
      prefCode,
      prefName,
      cityCode,
      cityName,
    };
    try {
      sessionStorage.setItem(progressStorageKey(difficulty, geojsonUrl), JSON.stringify(progress));
    } catch {
      // 保存領域が使えない環境は無視
    }
  }, [phase, placedCount, totalCount, missCount, elapsedSec, difficulty, geojsonUrl, areaLabel, prefCode, prefName, cityCode, cityName]);

  // ─── ドラッグ ──────────────────────────────────────────────────────────────
  const startDrag = useCallback(
    (piece: PieceData, e: PointerEvent) => {
      if (!ghostRef.current || !ghostContainerRef.current) return;
      draggingRef.current = piece;

      const ghost = ghostRef.current;
      ghost.width = 72;
      ghost.height = 72;
      const fillHex = themeColor + "33";
      drawThumbnail(ghost, piece.feature, fillHex, themeColor);

      const cont = ghostContainerRef.current;
      cont.style.display = "block";
      cont.style.left = `${e.clientX}px`;
      cont.style.top = `${e.clientY}px`;
    },
    [themeColor]
  );

  useEffect(() => {
    startDragRef.current = startDrag;
  }, [startDrag]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pending = pendingDragRef.current;
      if (pending) {
        const adx = Math.abs(e.clientX - pending.startX);
        const ady = Math.abs(e.clientY - pending.startY);
        const dxDelta = e.clientX - pending.lastX;
        pending.lastX = e.clientX;
        if (adx > 8 && adx > ady * 1.5) {
          // 横スワイプ → トレイをスクロール
          if (trayRef.current) trayRef.current.scrollLeft -= dxDelta;
          return;
        }
        if (adx * adx + ady * ady > 100) {
          // 斜め/縦移動 → ドラッグ開始
          pendingDragRef.current = null;
          startDragRef.current(pending.piece, e);
        }
        return;
      }
      if (!draggingRef.current || !ghostContainerRef.current) return;
      ghostContainerRef.current.style.left = `${e.clientX}px`;
      ghostContainerRef.current.style.top = `${e.clientY}px`;
    };

    const onUp = (e: PointerEvent) => {
      pendingDragRef.current = null;
      if (!ghostContainerRef.current) return;
      const piece = draggingRef.current;
      draggingRef.current = null;
      ghostContainerRef.current.style.display = "none";

      if (!piece || phaseRef.current !== "playing") return;

      // 地図コンテナ内チェック
      const mapEl = mapContainerRef.current;
      if (!mapEl) return;
      const mapRect = mapEl.getBoundingClientRect();
      if (
        e.clientX < mapRect.left ||
        e.clientX > mapRect.right ||
        e.clientY < mapRect.top ||
        e.clientY > mapRect.bottom
      ) {
        return;
      }

      const L2 = LRef.current;
      const map2 = mapRef.current;
      if (!L2 || !map2) return;

      const point = L2.point(e.clientX - mapRect.left, e.clientY - mapRect.top);
      const dropLatLng = map2.containerPointToLatLng(point);

      let snapped = false;

      // Point-in-Polygon（全難易度統一）離島を含む全ポリゴンを対象にする
      if (pointInPolygon(dropLatLng.lat, dropLatLng.lng, piece.feature)) {
        snapped = true;
      }

      if (snapped) {
        snapPiece(piece);
      } else {
        missCountRef.current += 1;
        setMissCount(missCountRef.current);
        triggerFlash("miss");
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [difficulty, snapPiece, triggerFlash]);

  // ─── ギブアップ ────────────────────────────────────────────────────────────
  const handleGiveUp = useCallback(() => {
    if (!confirm("答えを表示して終了しますか？")) return;
    if (timerRef.current) clearInterval(timerRef.current);
    draggingRef.current = null;
    if (ghostContainerRef.current) ghostContainerRef.current.style.display = "none";

    piecesRef.current.forEach((p) => {
      if (!p.placed) {
        p.layer?.setStyle({
          fillColor: COLOR_GIVEUP,
          fillOpacity: 0.6,
          color: COLOR_GIVEUP_STROKE,
          dashArray: undefined,
          weight: 1.5,
        });
        addLabel(p, COLOR_GIVEUP_STROKE);
      }
    });

    setGaveUp(true);
    setShowResultModal(true);
    phaseRef.current = "clear";
    setPhase("clear");
    setScore(null); // ギブアップ時はスコアなし
    try {
      sessionStorage.removeItem(progressStorageKey(difficulty, geojsonUrl));
    } catch {
      // 保存領域が使えない環境は無視
    }
  }, [addLabel, difficulty, geojsonUrl]);

  // ─── リトライ ──────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  }, [onRetry]);

  // ─── 保存して中断 ──────────────────────────────────────────────────────────
  const handleSaveAndExit = useCallback(async () => {
    if (saveState === "saving") return;
    const placedIds = piecesRef.current.filter((p) => p.placed).map((p) => p.id);
    if (placedIds.length === 0) {
      onSaveAndExit?.();
      return;
    }
    setSaveState("saving");
    try {
      await saveProgress({
        difficulty,
        prefCode,
        prefName,
        cityCode,
        cityName,
        placedIds,
        missCount: missCountRef.current,
        elapsedSeconds: elapsedSec,
      });
      try {
        sessionStorage.removeItem(progressStorageKey(difficulty, geojsonUrl));
      } catch {
        // 保存領域が使えない環境は無視
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setSaveState("idle");
      onSaveAndExit?.();
    } catch (err) {
      console.error("❌ 途中保存に失敗しました:", err);
      setSaveState("error");
      alert("途中保存に失敗しました。ログイン状態・通信環境をご確認のうえもう一度お試しください。");
    }
  }, [saveState, difficulty, prefCode, prefName, cityCode, cityName, elapsedSec, geojsonUrl, onSaveAndExit]);

  // ─── チャレンジ結果の送信（正常クリア時のみ。ギブアップは履歴に残さない）─────────
  const submitChallengeIfNeeded = useCallback(() => {
    if (gaveUp || !score || challengeSubmittedRef.current) return;
    challengeSubmittedRef.current = true;
    setChallengeSubmitState("submitting");
    submitChallenge({
      difficulty,
      prefCode,
      prefName,
      cityCode,
      cityName,
      totalPieces: score.scoredTotal,
      missCount: missCountRef.current,
      elapsedSeconds: score.elapsedSec,
      comment: comment.trim() || undefined,
    })
      .then(() => setChallengeSubmitState("done"))
      .catch((err) => {
        console.error("❌ チャレンジ結果の送信に失敗しました:", err);
        setChallengeSubmitState("error");
      });
  }, [gaveUp, score, difficulty, prefCode, prefName, cityCode, cityName, comment]);

  // ─── レンダリング ──────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        background: "#fdf8f0",
        overscrollBehaviorX: "none",
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        #puzzle-piece-tray::-webkit-scrollbar { display: none; }
        #puzzle-piece-tray { overscroll-behavior-x: contain; touch-action: pan-x; }
      `}</style>
      {/* ゲームヘッダー（1行） */}
      <div
        style={{
          background: themeColor,
          color: "white",
          flexShrink: 0,
          height: "48px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "0 10px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
        }}
      >
        <button
          type="button"
          onClick={() => router.push("/game/map-puzzle")}
          style={{
            color: "white",
            opacity: 0.9,
            flexShrink: 0,
            fontSize: "18px",
            lineHeight: 1,
            textDecoration: "none",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
          title="ゲームトップに戻る"
        >
          ←
        </button>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: "4px",
            background: "rgba(255,255,255,0.25)",
            flexShrink: 0,
          }}
        >
          {diffLabel}
        </span>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {areaLabel}
        </span>
        <span
          style={{
            fontSize: "11px",
            background: "rgba(255,255,255,0.2)",
            padding: "2px 7px",
            borderRadius: "20px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {placedCount}/{totalCount}
        </span>
        <span
          style={{
            fontSize: "11px",
            background: "rgba(255,255,255,0.2)",
            padding: "2px 7px",
            borderRadius: "20px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {formatTime(elapsedSec)}
        </span>
        <span
          style={{
            fontSize: "11px",
            background: "rgba(255,255,255,0.2)",
            padding: "2px 7px",
            borderRadius: "20px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ミス:{missCount}
        </span>
      </div>

      {/* 地図エリア */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
        {phase === "playing" && !gaveUp && (
          <div
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              zIndex: 500,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              gap: "8px",
              maxWidth: "calc(100% - 20px)",
            }}
          >
            {difficulty === "advanced" && zeroPopRemaining > 0 && (
              <button
                onClick={handleSkipZeroPopulation}
                style={{
                  background: "white",
                  border: `1px solid ${themeColor}4d`,
                  color: themeColor,
                  padding: "6px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "12px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                }}
                title="人口0のエリアをまとめて自動配置します（得点対象外）"
              >
                🏔️ 人口0地区をスキップ（{zeroPopRemaining}）
              </button>
            )}
            {onSaveAndExit && (
              <button
                onClick={handleSaveAndExit}
                disabled={saveState === "saving"}
                style={{
                  background: "white",
                  border: `1px solid ${themeColor}4d`,
                  color: themeColor,
                  padding: "6px 12px",
                  borderRadius: "8px",
                  cursor: saveState === "saving" ? "default" : "pointer",
                  fontSize: "12px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                  opacity: saveState === "saving" ? 0.6 : 1,
                }}
              >
                {saveState === "saving" ? "保存中..." : "💾 保存して中断"}
              </button>
            )}
            <button
              onClick={handleGiveUp}
              style={{
                background: "white",
                border: `1px solid ${themeColor}4d`,
                color: themeColor,
                padding: "6px 12px",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "12px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
              }}
            >
              答えを見る
            </button>
          </div>
        )}
        {phase === "clear" && !showResultModal && (
          <button
            onClick={handleRetry}
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              zIndex: 500,
              background: "white",
              border: `1px solid ${themeColor}4d`,
              color: themeColor,
              padding: "6px 12px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "12px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
            }}
          >
            🔄 もう一度プレイ
          </button>
        )}
      </div>

      {/* ピーストレイ */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          background: "white",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        {/* トレイヘッダー */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 12px",
            borderBottom: "1px solid #f3f4f6",
            height: "44px",
            flexShrink: 0,
          }}
        >
          {/* トレイ左右スクロールボタン */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => trayRef.current?.scrollBy({ left: -(trayRef.current.clientWidth || 300), behavior: "smooth" })}
              style={{
                background: `${themeColor}14`,
                border: `1px solid ${themeColor}4d`,
                color: themeColor,
                width: "60px",
                height: "36px",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "22px",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-label="左にスクロール"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => trayRef.current?.scrollBy({ left: trayRef.current.clientWidth || 300, behavior: "smooth" })}
              style={{
                background: `${themeColor}14`,
                border: `1px solid ${themeColor}4d`,
                color: themeColor,
                width: "60px",
                height: "36px",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "22px",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-label="右にスクロール"
            >
              ›
            </button>
          </div>
        </div>

        {/* ピースグリッド（横スクロール） */}
        <div
          ref={trayRef}
          id="puzzle-piece-tray"
          style={{
            display: "flex",
            flexDirection: "row",
            gap: "10px",
            padding: "10px 12px",
            overflowX: "auto",
            height: "132px",
            alignItems: "flex-start",
            scrollbarWidth: "none",
          }}
        />
      </div>

      {/* ドラッグゴースト */}
      <div
        ref={ghostContainerRef}
        style={{
          position: "fixed",
          pointerEvents: "none",
          zIndex: 9999,
          display: "none",
          transform: "translate(-50%, -50%)",
        }}
      >
        <canvas
          ref={ghostRef}
          width={72}
          height={72}
          style={{
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            border: `2px solid ${themeColor}`,
            display: "block",
          }}
        />
      </div>

      {/* フラッシュオーバーレイ */}
      {flashType === "snap" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(79, 142, 247, 0.15)",
            pointerEvents: "none",
            zIndex: 8000,
          }}
        />
      )}
      {flashType === "miss" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(239, 68, 68, 0.12)",
            pointerEvents: "none",
            zIndex: 8000,
          }}
        />
      )}

      {/* ローディング */}
      {phase === "loading" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(253,248,240,0.95)",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "4px solid #e2e8f0",
              borderTopColor: themeColor,
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p style={{ color: "#64748b", fontSize: "14px" }}>データを読み込み中...</p>
        </div>
      )}

      {/* エラー */}
      {phase === "error" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(253,248,240,0.97)",
            zIndex: 10001,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            padding: "20px",
          }}
        >
          <div style={{ fontSize: "40px" }}>⚠️</div>
          <h2 style={{ color: "#dc2626", fontSize: "16px", fontWeight: 700 }}>
            データの読み込みに失敗しました
          </h2>
          <p style={{ color: "#64748b", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>
            {errorMsg}
          </p>
          <button
            onClick={handleRetry}
            style={{
              marginTop: "12px",
              padding: "8px 20px",
              borderRadius: "8px",
              border: "1px solid #dc2626",
              background: "white",
              color: "#dc2626",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            再読み込み
          </button>
        </div>
      )}

      {/* クリアカード */}
      {phase === "clear" && showResultModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.65)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "20px",
              padding: "40px 48px",
              textAlign: "center",
              maxWidth: "380px",
              width: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            {gaveUp ? (
              <>
                <div style={{ fontSize: "40px", marginBottom: "8px" }}>📖</div>
                <h2 style={{ fontSize: "20px", color: "#3c2a14", marginBottom: "12px" }}>
                  答えを表示しました
                </h2>
                <p style={{ color: "#78716c", fontSize: "13px", marginBottom: "4px" }}>
                  地図上に正解のエリアが表示されています
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: "48px", marginBottom: "8px" }}>🎉</div>
                <h2 style={{ fontSize: "22px", color: themeColor, marginBottom: "4px" }}>
                  クリア！
                </h2>
                <div style={{ fontSize: "13px", color: "#78716c", marginBottom: "16px" }}>
                  {diffLabel}｜{areaLabel}
                </div>
                {score && (
                  <>
                    <div
                      style={{
                        fontSize: "56px",
                        fontWeight: 800,
                        color: "#f59e0b",
                        lineHeight: 1,
                      }}
                    >
                      {score.total.toLocaleString()}
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        color: "#94a3b8",
                        marginTop: "2px",
                        marginBottom: "20px",
                      }}
                    >
                      ポイント
                    </div>
                    <div
                      style={{
                        background: "#f8fafc",
                        borderRadius: "10px",
                        padding: "14px 16px",
                        textAlign: "left",
                        fontSize: "13px",
                        color: "#475569",
                      }}
                    >
                      <div
                        style={{
                          padding: "3px 0",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>基礎点 ({score.scoredTotal} × 10)</span>
                        <span>{score.base}pt</span>
                      </div>
                      <div
                        style={{
                          padding: "3px 0",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>時間ボーナス</span>
                        <span>+{score.timeBonus}pt</span>
                      </div>
                      <div
                        style={{
                          padding: "3px 0",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>ミスペナルティ</span>
                        <span>-{score.missPenalty}pt</span>
                      </div>
                      {score.skippedCount > 0 && (
                        <div
                          style={{
                            padding: "3px 0",
                            display: "flex",
                            justifyContent: "space-between",
                            color: "#94a3b8",
                          }}
                        >
                          <span>人口0地区（自動配置・対象外）</span>
                          <span>{score.skippedCount}件</span>
                        </div>
                      )}
                      <div
                        style={{
                          borderTop: "1px solid #e2e8f0",
                          marginTop: "6px",
                          paddingTop: "8px",
                          display: "flex",
                          justifyContent: "space-between",
                          fontWeight: 600,
                          color: themeColor,
                        }}
                      >
                        <span>クリアタイム</span>
                        <span>{formatTime(score.elapsedSec)}</span>
                      </div>
                    </div>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value.slice(0, 200))}
                      placeholder="感想を書く（任意）"
                      rows={2}
                      maxLength={200}
                      style={{
                        marginTop: "14px",
                        width: "100%",
                        resize: "none",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "10px 12px",
                        fontSize: "13px",
                        color: "#3c2a14",
                        boxSizing: "border-box",
                      }}
                    />
                  </>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                submitChallengeIfNeeded();
                setShowResultModal(false);
              }}
              style={{
                marginTop: "24px",
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                border: `1px solid ${themeColor}`,
                background: "white",
                color: themeColor,
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: "8px",
              }}
            >
              🗺️ 地図を見る
            </button>
            <button
              type="button"
              onClick={() => {
                submitChallengeIfNeeded();
                handleRetry();
              }}
              style={{
                background: themeColor,
                color: "white",
                border: "none",
                padding: "12px 36px",
                borderRadius: "10px",
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
                width: "100%",
              }}
            >
              もう一度プレイ
            </button>
            {challengeSubmitState === "error" && (
              <p style={{ marginTop: "10px", fontSize: "12px", color: "#dc2626" }}>
                結果の送信に失敗しました（記録は反映されていません）
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
