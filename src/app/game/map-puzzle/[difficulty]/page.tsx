"use client";

import { use, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { notFound, useRouter } from "next/navigation";
import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";
import { progressStorageKey } from "@/components/game/map-puzzle/MapPuzzleGame";
import type { AreaInfo } from "@/components/game/map-puzzle/MapAreaSelector";

const MapPuzzleGame = dynamic(
  () => import("@/components/game/map-puzzle/MapPuzzleGame"),
  { ssr: false }
);

const MapAreaSelector = dynamic(
  () => import("@/components/game/map-puzzle/MapAreaSelector"),
  { ssr: false }
);

// ─── 定数 ────────────────────────────────────────────────────────────────────

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

// 都道府県パズル（初級）は全国固定のため、専用のエリアコードで表現する
const BEGINNER_AREA = { prefCode: "00", prefName: "全国" } as const;

const VALID_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;

const DIFFICULTY_META: Record<
  Difficulty,
  {
    label: string;
    title: string;
    themeColor: string;
    namePropCandidates: string[];
  }
> = {
  beginner: {
    label: "初級",
    title: "都道府県パズル",
    themeColor: "#2563eb",
    namePropCandidates: ["nam_ja", "PREF_NAME", "name"],
  },
  intermediate: {
    label: "中級",
    title: "市区町村パズル",
    themeColor: "#7c3aed",
    namePropCandidates: ["cityName", "CITY_NAME", "name"],
  },
  advanced: {
    label: "上級",
    title: "町丁パズル",
    themeColor: "#0f766e",
    namePropCandidates: ["S_NAME"],
  },
};

// ─── 中断中のパズル再開プロンプト ──────────────────────────────────────────────

interface ResumeCandidate {
  geojsonUrl: string;
  areaLabel: string;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

function findResumeCandidate(difficulty: Difficulty): ResumeCandidate | null {
  const prefix = progressStorageKey(difficulty, "");
  let best: (ResumeCandidate & { updatedAt: number }) | null = null;
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const key = window.sessionStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;
      const saved = JSON.parse(raw) as {
        placedIds?: number[];
        areaLabel?: string;
        updatedAt?: number;
        prefCode?: string;
        prefName?: string;
        cityCode?: string;
        cityName?: string;
      };
      if (
        !saved.areaLabel || !saved.prefCode || !saved.prefName ||
        !Array.isArray(saved.placedIds) || saved.placedIds.length === 0
      ) continue;
      const updatedAt = saved.updatedAt ?? 0;
      if (!best || updatedAt > best.updatedAt) {
        best = {
          geojsonUrl: key.slice(prefix.length),
          areaLabel: saved.areaLabel,
          prefCode: saved.prefCode,
          prefName: saved.prefName,
          cityCode: saved.cityCode,
          cityName: saved.cityName,
          updatedAt,
        };
      }
    } catch {
      // 破損データは無視
    }
  }
  if (!best) return null;
  return {
    geojsonUrl: best.geojsonUrl,
    areaLabel: best.areaLabel,
    prefCode: best.prefCode,
    prefName: best.prefName,
    cityCode: best.cityCode,
    cityName: best.cityName,
  };
}

function clearResumeCandidates(difficulty: Difficulty): void {
  const prefix = progressStorageKey(difficulty, "");
  for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
    const key = window.sessionStorage.key(i);
    if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
  }
}

interface ResumePromptProps {
  themeColor: string;
  areaLabel: string;
  onResume: () => void;
  onReset: () => void;
}

function ResumePrompt({ themeColor, areaLabel, onResume, onReset }: ResumePromptProps) {
  return (
    <div className="fixed inset-0 z-[1100] flex flex-col items-center justify-center gap-6 bg-[#fdf8f0] px-6 text-center">
      <div>
        <p className="text-base font-semibold text-[#3c2a14] mb-2">中断中のパズルがあります</p>
        <p className="text-xs text-[#a8937a] mb-3">
          このタブを離れる前の状態が一時的に残っています（タブを閉じると消えます）
        </p>
        <p className="text-sm text-[#78716c]">「{areaLabel}」の途中から再開しますか?</p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <button
          type="button"
          onClick={onResume}
          className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-colors duration-150"
          style={{ background: themeColor }}
        >
          再開する
        </button>
        <button
          type="button"
          onClick={onReset}
          className="w-full py-3.5 rounded-xl text-sm font-semibold text-[#78716c] border border-gray-300 bg-white transition-colors duration-150 hover:bg-gray-50"
        >
          リセットする
        </button>
      </div>
    </div>
  );
}

function LoadingScreen({ themeColor }: { themeColor: string }) {
  return (
    <div className="fixed inset-0 z-[1100] flex flex-col items-center justify-center gap-4 bg-[#fdf8f0]">
      <div
        className="w-10 h-10 rounded-full border-4 border-gray-200 animate-spin"
        style={{ borderTopColor: themeColor }}
      />
      <p className="text-sm text-[#64748b]">読み込み中...</p>
    </div>
  );
}

// ─── ページコンポーネント ──────────────────────────────────────────────────────

type Props = { params: Promise<{ difficulty: string }> };

interface GameConfig {
  geojsonUrl: string;
  areaLabel: string;
  prefCode: string;
  prefName: string;
  cityCode?: string;
  cityName?: string;
}

export default function MapPuzzleGamePage({ params }: Props) {
  const { difficulty: diffParam } = use(params);

  // difficulty バリデーション
  if (!VALID_DIFFICULTIES.includes(diffParam as Difficulty)) {
    notFound();
  }
  const difficulty = diffParam as Difficulty;
  const meta = DIFFICULTY_META[difficulty];
  const router = useRouter();

  // ゲーム再起動キー（インクリメントで MapPuzzleGame を再マウント）
  const [gameKey, setGameKey] = useState(0);

  const defaultBeginnerConfig: GameConfig = {
    geojsonUrl: `${CLOUDFRONT_URL}/geojson/prefecture/prefectures.geojson`,
    areaLabel: "全国（都道府県）",
    prefCode: BEGINNER_AREA.prefCode,
    prefName: BEGINNER_AREA.prefName,
  };

  // ゲーム開始状態（null のうちは「未確定」＝中断チェック待ち or エリア選択待ち）
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);

  // 同一タブの中断中パズル（未チェック: undefined / なし: null / あり: ResumeCandidate）
  const [resumeCandidate, setResumeCandidate] = useState<ResumeCandidate | null | undefined>(undefined);

  useEffect(() => {
    // sessionStorage はブラウザ専用APIのため、difficulty変更のたびにここで同期的に読むしかない
    const candidate = findResumeCandidate(difficulty);
    if (candidate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResumeCandidate(candidate);
    } else {
      setResumeCandidate(null);
      if (difficulty === "beginner") {
        setGameConfig(defaultBeginnerConfig);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  // 中断チェック中
  if (resumeCandidate === undefined) {
    return <LoadingScreen themeColor={meta.themeColor} />;
  }

  // 同一タブの中断中パズルがある場合は再開確認を表示
  if (resumeCandidate) {
    return (
      <ResumePrompt
        themeColor={meta.themeColor}
        areaLabel={resumeCandidate.areaLabel}
        onResume={() => {
          setGameConfig(resumeCandidate);
          setResumeCandidate(null);
        }}
        onReset={() => {
          clearResumeCandidates(difficulty);
          setResumeCandidate(null);
          if (difficulty === "beginner") {
            setGameConfig(defaultBeginnerConfig);
          }
        }}
      />
    );
  }

  // intermediate / advanced はエリア選択待ち
  if (!gameConfig) {
    return (
      <MapAreaSelector
        difficulty={difficulty as "intermediate" | "advanced"}
        title={meta.title}
        onBack={() => router.push("/game/map-puzzle")}
        onConfirm={(url, label, area: AreaInfo) => setGameConfig({ geojsonUrl: url, areaLabel: label, ...area })}
      />
    );
  }

  return (
    <MapPuzzleGame
      key={gameKey}
      difficulty={difficulty}
      geojsonUrl={gameConfig.geojsonUrl}
      areaLabel={gameConfig.areaLabel}
      namePropCandidates={meta.namePropCandidates}
      prefCode={gameConfig.prefCode}
      prefName={gameConfig.prefName}
      cityCode={gameConfig.cityCode}
      cityName={gameConfig.cityName}
      onRetry={() => setGameKey((k) => k + 1)}
    />
  );
}
