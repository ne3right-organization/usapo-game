"use client";

import { Suspense, use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import type { Difficulty } from "@/lib/game/mapPuzzleData";
import type { AreaInfo } from "@/components/game/map-puzzle/MapAreaSelector";
import { areaFromQuery } from "@/lib/game/playLinks";
import {
  MAP_PACK_BEGINNER_AREA,
  clearMapPackSessionSaves,
  discardMapPackProgress,
  fetchMapPackProgress,
  findMapPackSessionSave,
  type MapPackArea,
  type MapPackSessionSave,
  type MapPackSnapshot,
} from "@/lib/game/mapPackData";

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
  const area = areaFromQuery(difficulty, q);
  if (!area) return null;
  if (difficulty === "intermediate") {
    return {
      geojsonUrl: `${CLOUDFRONT_URL}/geojson/municipality/2020/${area.prefCode}.geojson`,
      areaLabel: area.prefName,
      area,
    };
  }
  return {
    geojsonUrl: `${CLOUDFRONT_URL}/geojson/town-district/2020/${area.prefCode}/${area.cityCode}.geojson`,
    areaLabel: area.cityName!,
    area,
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

function ResumePrompt({
  title,
  description,
  areaLabel,
  resumeLabel,
  resetLabel,
  onResume,
  onReset,
}: {
  title: string;
  description: string;
  areaLabel: string;
  resumeLabel: string;
  resetLabel: string;
  onResume: () => void;
  onReset: () => void;
}) {
  return (
    <main className="min-h-full bg-[#fdf8f0] flex items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <p className="text-base font-semibold text-[#3c2a14] mb-2">{title}</p>
        <p className="text-xs text-[#a8937a] mb-3">{description}</p>
        <p className="text-sm text-[#78716c] mb-6">「{areaLabel}」の途中から再開しますか？</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800"
          >
            {resumeLabel}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-[#78716c] border border-gray-300 bg-white hover:bg-gray-50"
          >
            {resetLabel}
          </button>
        </div>
      </div>
    </main>
  );
}

const Loading = () => <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>;

function MapPackPlay({ difficulty }: { difficulty: Difficulty }) {
  const meta = META[difficulty];
  const router = useRouter();
  const searchParams = useSearchParams();

  // area はゲーム側の effect の依存になるので state で固定する
  const [config, setConfig] = useState<GameConfig | null>(() => initialConfig(difficulty, searchParams));
  // 再開する場合の状態と、ゲームを始めてよいか(再開の確認が済んだか)
  const [snapshot, setSnapshot] = useState<MapPackSnapshot | null>(null);
  const [started, setStarted] = useState(false);

  // 地図パズルと同じ順で再開を確認する: ①同じタブで中断中のゲーム → ②サーバーに保存した続き
  const [sessionSave, setSessionSave] = useState<MapPackSessionSave | null | undefined>(undefined);
  const [serverSnapshot, setServerSnapshot] = useState<MapPackSnapshot | null>(null);

  useEffect(() => {
    // sessionStorage はブラウザ専用なので、表示後にここで読むしかない
    const save = findMapPackSessionSave(difficulty);
    // URL でエリアが指定されている(ランキングから来た)ときは、そのエリアの続きだけを対象にする
    const fits = save && (!config || save.geojsonUrl === config.geojsonUrl);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionSave(fits ? save : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  useEffect(() => {
    if (sessionSave !== null || !config || started) return;
    let cancelled = false;
    fetchMapPackProgress(config.area)
      .then((snap) => {
        if (cancelled) return;
        if (snap) setServerSnapshot(snap);
        else setStarted(true);
      })
      .catch(() => {
        if (!cancelled) setStarted(true); // 未ログイン・通信エラーは続きなしとして始める
      });
    return () => {
      cancelled = true;
    };
  }, [sessionSave, config, started]);

  if (sessionSave === undefined) return <Loading />;

  if (sessionSave) {
    return (
      <ResumePrompt
        title="中断中のゲームがあります"
        description="このタブを離れる前の状態が一時的に残っています（タブを閉じると消えます）"
        areaLabel={sessionSave.areaLabel}
        resumeLabel="再開する"
        resetLabel="最初から始める"
        onResume={() => {
          setConfig({ geojsonUrl: sessionSave.geojsonUrl, areaLabel: sessionSave.areaLabel, area: sessionSave.area });
          setSnapshot(sessionSave.snapshot);
          setStarted(true);
          setSessionSave(null);
        }}
        onReset={() => {
          clearMapPackSessionSaves(difficulty);
          setSessionSave(null);
        }}
      />
    );
  }

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

  if (!started && serverSnapshot) {
    const area = config.area;
    return (
      <ResumePrompt
        title="保存された途中経過があります"
        description="「中断」で保存した続きです（別の端末・ブラウザからでも再開できます）"
        areaLabel={config.areaLabel}
        resumeLabel="続きから再開する"
        resetLabel="最初から始める"
        onResume={() => {
          setSnapshot(serverSnapshot);
          setServerSnapshot(null);
          setStarted(true);
        }}
        onReset={() => {
          discardMapPackProgress(area).catch(() => {});
          setServerSnapshot(null);
          setStarted(true);
        }}
      />
    );
  }

  if (!started) return <Loading />;

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
          key={config.geojsonUrl}
          geojsonUrl={config.geojsonUrl}
          areaLabel={config.areaLabel}
          nameKey={meta.nameKey}
          unitLabel={meta.unitLabel}
          area={config.area}
          initialSnapshot={snapshot}
          onSaveAndExit={() => router.push("/game/map-pack")}
        />

        {difficulty !== "beginner" && (
          <p className="text-center mt-6">
            <button
              type="button"
              onClick={() => {
                setConfig(null);
                setSnapshot(null);
                setStarted(false);
              }}
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
