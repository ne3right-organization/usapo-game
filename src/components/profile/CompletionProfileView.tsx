"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchGameProfile, type Difficulty } from "@/lib/game/mapPuzzleData";
import {
  COMPLETION_GAMES,
  COMPLETION_LEVELS,
  completionLevelLabel,
  completionPlayHref,
  completionScopeOf,
  fetchCompletion,
  type ClearedArea,
  type CompletionData,
  type CompletionGame,
} from "@/lib/game/completionData";
import { areaLabelOf } from "@/lib/game/format";
import CompletionMap, { type FillStyle, type MapFeatureKey } from "@/components/profile/CompletionMap";
import { FollowButton, FollowSummary } from "@/components/profile/FollowControls";
import MapPuzzleScores from "@/components/profile/MapPuzzleScores";
import { currentUser } from "@/lib/auth";
import { UserIcon } from "@/components/game/chizu-tane/TaneParts";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";
const PREFECTURES_URL = `${CLOUDFRONT_URL}/geojson/prefecture/prefectures.geojson`;
const municipalitiesUrl = (prefCode: string) => `${CLOUDFRONT_URL}/geojson/municipality/2020/${prefCode}.geojson`;

const GAME_META: Record<CompletionGame, { label: string; color: string; tab: string }> = {
  "map-puzzle": { label: "🗺️ 地図パズル", color: "#0f766e", tab: "bg-teal-700" },
  "map-pack": { label: "📦 地図ポットン", color: "#7e22ce", tab: "bg-purple-700" },
};

function prefFeatureKey(feature: unknown): MapFeatureKey | null {
  const props = (feature as { properties?: Record<string, unknown> })?.properties;
  if (props?.pref == null) return null;
  const code = String(props.pref).padStart(2, "0");
  return { code, name: String(props.name ?? code) };
}

function cityFeatureKey(feature: unknown): MapFeatureKey | null {
  const props = (feature as { properties?: Record<string, unknown> })?.properties;
  if (!props?.cityCode || !props?.cityName) return null;
  return { code: String(props.cityCode), name: String(props.cityName) };
}

/** 都道府県ごとのクリア数の濃淡(上級の全国の地図) */
function countOpacity(count: number): number {
  if (count >= 20) return 0.9;
  if (count >= 10) return 0.75;
  if (count >= 5) return 0.6;
  if (count >= 2) return 0.45;
  return 0.3;
}

type ViewState =
  | { status: "loading" }
  | { status: "needs-login" }
  | { status: "private" }
  | { status: "ready"; userId: string; isSelf: boolean; nickname: string | null; iconItemId: string | null };

export interface CompletionProfileViewProps {
  /** 省略すると自分 */
  targetUserId?: string;
  initialGame?: string | null;
  initialLevel?: string | null;
}

export default function CompletionProfileView({ targetUserId, initialGame, initialLevel }: CompletionProfileViewProps) {
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [game, setGame] = useState<CompletionGame>(
    COMPLETION_GAMES.includes(initialGame as CompletionGame) ? (initialGame as CompletionGame) : "map-puzzle",
  );
  const [level, setLevel] = useState<Difficulty>(
    COMPLETION_LEVELS.includes(initialLevel as Difficulty) ? (initialLevel as Difficulty) : "intermediate",
  );
  const [dataByGame, setDataByGame] = useState<Partial<Record<CompletionGame, CompletionData>>>({});
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await currentUser();
      if (!user) {
        if (!cancelled) setView({ status: "needs-login" });
        return;
      }
      const userId = targetUserId ?? user.id;
      const isSelf = userId === user.id;
      try {
        const profile = await fetchGameProfile(userId);
        // 他の人の記録はニックネームを設定している場合だけ読める(各テーブルのRLS)
        if (!isSelf && !profile?.nickname) {
          if (!cancelled) setView({ status: "private" });
          return;
        }
        if (!cancelled) setView({ status: "ready", userId, isSelf, nickname: profile?.nickname ?? null, iconItemId: profile?.iconItemId ?? null });
      } catch {
        if (!cancelled) setView({ status: "needs-login" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  const userId = view.status === "ready" ? view.userId : null;
  const data = dataByGame[game];

  useEffect(() => {
    if (!userId || dataByGame[game]) return;
    let cancelled = false;
    fetchCompletion(game, userId)
      .then((d) => {
        if (!cancelled) setDataByGame((prev) => ({ ...prev, [game]: d }));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, game, dataByGame]);

  const select = (g: CompletionGame, l: Difficulty) => {
    setGame(g);
    setLevel(l);
    setLoadError("");
    // 共有しやすいように、見ているタブをURLに残す
    router.replace(`?game=${g}&level=${l}`, { scroll: false });
  };

  if (view.status === "loading") return <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>;

  if (view.status === "needs-login") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
        <p className="text-sm text-[#3c2a14] mb-3">プロフィールを見るにはログインが必要です</p>
        <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
          ログインする →
        </Link>
      </div>
    );
  }

  if (view.status === "private") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
        <p className="text-sm text-[#78716c] leading-relaxed">
          このユーザーはニックネームを登録していないため、プロフィールを閲覧できません。
        </p>
      </div>
    );
  }

  const meta = GAME_META[game];

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-lg font-bold text-[#3c2a14] min-w-0">
            {view.iconItemId && <UserIcon iconItemId={view.iconItemId} size={30} />}
            <span className="truncate">{view.nickname ?? "ニックネーム未設定"}</span>
          </span>
          {view.isSelf ? (
            <Link href="/nickname" className="shrink-0 text-xs text-[#78716c] underline underline-offset-2">
              {view.nickname ? "編集" : "設定する"}
            </Link>
          ) : (
            <FollowButton targetUserId={view.userId} />
          )}
        </div>
        {view.isSelf && <FollowSummary />}
      </div>

      <div className="flex gap-2">
        {COMPLETION_GAMES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => select(g, level)}
            className={`flex-1 text-xs font-semibold rounded-xl py-2 transition-colors ${
              game === g ? `${GAME_META[g].tab} text-white` : "bg-white text-[#78716c] border border-gray-200"
            }`}
          >
            {GAME_META[g].label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {COMPLETION_LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => select(game, l)}
            className={`flex-1 text-[11px] font-semibold rounded-full py-1.5 border transition-colors ${
              level === l ? "text-white border-transparent" : "bg-white text-[#78716c] border-gray-200"
            }`}
            style={level === l ? { backgroundColor: meta.color } : undefined}
          >
            {completionLevelLabel(game, l)}
          </button>
        ))}
      </div>

      {loadError && <p className="text-sm text-red-600 text-center py-6">{loadError}</p>}
      {!loadError && !data && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}
      {!loadError && data && (
        <CompletionLevelView
          // ゲーム・レベルを切り替えたら選択や表示中の県をリセットする
          key={`${game}-${level}`}
          game={game}
          level={level}
          cleared={data[level]}
          color={meta.color}
          isSelf={view.isSelf}
        />
      )}
      {/* 地図パズルは点数があるので、合計スコアとベストスコアの一覧も出す(もとは地図パズルのマイプロフィール) */}
      {game === "map-puzzle" && <MapPuzzleScores userId={view.userId} />}
    </div>
  );
}

// ─── 1つのゲーム×レベルのコンプリート表示 ────────────────────────────────────

interface CompletionLevelViewProps {
  game: CompletionGame;
  level: Difficulty;
  cleared: ClearedArea[];
  color: string;
  isSelf: boolean;
}

function CompletionLevelView({ game, level, cleared, color, isSelf }: CompletionLevelViewProps) {
  const scope = completionScopeOf(game, level);

  if (scope === "nation") return <NationView game={game} cleared={cleared} color={color} isSelf={isSelf} />;
  if (scope === "prefecture") return <PrefectureView game={game} level={level} cleared={cleared} color={color} />;
  return <MunicipalityView game={game} level={level} cleared={cleared} color={color} />;
}

function PlayButton({ href, label, color }: { href: string; label: string; color: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </Link>
  );
}

function Summary({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] px-4 py-3 text-sm text-[#3c2a14]">
      {children}
    </div>
  );
}

function scoreText(area: ClearedArea | undefined): string {
  return area?.bestScore != null ? `ベスト ${area.bestScore.toLocaleString()}点` : "";
}

/** 初級: 全国で1エリア */
function NationView({ game, cleared, color, isSelf }: { game: CompletionGame; cleared: ClearedArea[]; color: string; isSelf: boolean }) {
  const done = cleared[0];
  const fillFor = useCallback((): FillStyle | null => (done ? { color, opacity: 0.7 } : null), [done, color]);

  return (
    <>
      <Summary>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold">{done ? "🎉 コンプリート！" : "まだ完成させていません"}</div>
            <div className="text-xs text-[#a8937a]">
              全国（47都道府県）{done ? `・${scoreText(done)}` : ""}
            </div>
          </div>
          <PlayButton href={completionPlayHref(game, "beginner")} label={done ? "▶ もう一度" : "▶ 遊ぶ"} color={color} />
        </div>
      </Summary>
      <CompletionMap geojsonUrl={PREFECTURES_URL} featureKey={prefFeatureKey} fillFor={fillFor} />
      {!done && isSelf && <p className="text-xs text-[#a8937a] text-center">完成させると日本地図が塗られます</p>}
    </>
  );
}

/** 中級(地図パズル・地図ポットン): 都道府県が1エリア */
function PrefectureView({ game, level, cleared, color }: { game: CompletionGame; level: Difficulty; cleared: ClearedArea[]; color: string }) {
  const byPref = useMemo(() => new Map(cleared.map((a) => [a.prefCode, a])), [cleared]);
  const [selected, setSelected] = useState<MapFeatureKey | null>(null);
  const fillFor = useCallback(
    (code: string): FillStyle | null => (byPref.has(code) ? { color, opacity: 0.7 } : null),
    [byPref, color],
  );
  const selectedArea = selected ? byPref.get(selected.code) : undefined;

  return (
    <>
      <Summary>
        <span className="text-2xl font-extrabold" style={{ color }}>
          {byPref.size}
        </span>
        <span className="text-[#a8937a]"> / 47 都道府県</span>
        {byPref.size >= 47 && <span className="ml-2 font-bold">🎉 コンプリート！</span>}
      </Summary>
      <CompletionMap
        geojsonUrl={PREFECTURES_URL}
        featureKey={prefFeatureKey}
        fillFor={fillFor}
        selectedCode={selected?.code}
        onSelect={setSelected}
      />
      {selected ? (
        <Summary>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{selected.name}</div>
              <div className="text-xs text-[#a8937a]">{selectedArea ? `✓ クリア済み・${scoreText(selectedArea)}` : "未クリア"}</div>
            </div>
            <PlayButton
              href={completionPlayHref(game, level, { prefCode: selected.code, prefName: selected.name })}
              label={selectedArea ? "▶ もう一度" : "▶ 遊ぶ"}
              color={color}
            />
          </div>
        </Summary>
      ) : (
        <p className="text-xs text-[#a8937a] text-center">都道府県をタップすると、そこから遊べます</p>
      )}
      <ClearedList areas={cleared} />
    </>
  );
}

/** 上級(地図パズル・地図ポットン): 市区町村が1エリア */
function MunicipalityView({ game, level, cleared, color }: { game: CompletionGame; level: Difficulty; cleared: ClearedArea[]; color: string }) {
  const byPref = useMemo(() => {
    const m = new Map<string, Map<string, ClearedArea>>();
    for (const a of cleared) {
      if (!a.cityCode) continue;
      const inPref = m.get(a.prefCode) ?? new Map<string, ClearedArea>();
      inPref.set(a.cityCode, a);
      m.set(a.prefCode, inPref);
    }
    return m;
  }, [cleared]);
  const [pref, setPref] = useState<MapFeatureKey | null>(null);
  const [selected, setSelected] = useState<MapFeatureKey | null>(null);
  const [cityTotal, setCityTotal] = useState<number | null>(null);

  const nationFill = useCallback(
    (code: string): FillStyle | null => {
      const n = byPref.get(code)?.size ?? 0;
      return n > 0 ? { color, opacity: countOpacity(n) } : null;
    },
    [byPref, color],
  );
  const inPref = pref ? byPref.get(pref.code) : undefined;
  const cityFill = useCallback(
    (code: string): FillStyle | null => (inPref?.has(code) ? { color, opacity: 0.7 } : null),
    [inPref, color],
  );
  const handleCitiesLoaded = useCallback((keys: MapFeatureKey[]) => setCityTotal(keys.length), []);

  const unit = "市区町村をクリア";

  if (!pref) {
    const selectedCount = selected ? (byPref.get(selected.code)?.size ?? 0) : 0;
    return (
      <>
        <Summary>
          <span className="text-2xl font-extrabold" style={{ color }}>
            {cleared.length.toLocaleString()}
          </span>
          <span className="text-[#a8937a]">
            {" "}
            {unit}（{byPref.size}都道府県）
          </span>
        </Summary>
        <CompletionMap
          geojsonUrl={PREFECTURES_URL}
          featureKey={prefFeatureKey}
          fillFor={nationFill}
          selectedCode={selected?.code}
          onSelect={setSelected}
        />
        {selected ? (
          <Summary>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{selected.name}</div>
                <div className="text-xs text-[#a8937a]">
                  {selectedCount}
                  {unit}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPref(selected);
                  setSelected(null);
                  setCityTotal(null);
                }}
                className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                市区町村を見る
              </button>
            </div>
          </Summary>
        ) : (
          <p className="text-xs text-[#a8937a] text-center">都道府県をタップすると、市区町村ごとの状況が見られます</p>
        )}
      </>
    );
  }

  const clearedHere = inPref?.size ?? 0;
  const selectedArea = selected ? inPref?.get(selected.code) : undefined;
  return (
    <>
      <Summary>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPref(null);
              setSelected(null);
            }}
            className="shrink-0 text-xs text-[#78716c] underline underline-offset-2"
          >
            ← 全国
          </button>
          <div className="flex-1 min-w-0 text-right">
            <span className="font-semibold">{pref.name}</span>{" "}
            <span className="text-2xl font-extrabold" style={{ color }}>
              {clearedHere}
            </span>
            <span className="text-[#a8937a]"> / {cityTotal ?? "…"}</span>
            {cityTotal != null && clearedHere >= cityTotal && <span className="ml-1 font-bold">🎉</span>}
          </div>
        </div>
      </Summary>
      <CompletionMap
        key={pref.code}
        geojsonUrl={municipalitiesUrl(pref.code)}
        featureKey={cityFeatureKey}
        fillFor={cityFill}
        selectedCode={selected?.code}
        onSelect={setSelected}
        onLoaded={handleCitiesLoaded}
      />
      {selected ? (
        <Summary>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{selected.name}</div>
              <div className="text-xs text-[#a8937a]">
                {selectedArea ? `✓ クリア済み${selectedArea.bestScore != null ? `・${scoreText(selectedArea)}` : ""}` : "未クリア"}
              </div>
            </div>
            <PlayButton
              href={completionPlayHref(game, level, {
                prefCode: pref.code,
                prefName: pref.name,
                cityCode: selected.code,
                cityName: selected.name,
              })}
              label={selectedArea ? "▶ もう一度" : "▶ 遊ぶ"}
              color={color}
            />
          </div>
        </Summary>
      ) : (
        <p className="text-xs text-[#a8937a] text-center">市区町村をタップすると、そこから遊べます</p>
      )}
      <ClearedList areas={inPref ? [...inPref.values()] : []} />
    </>
  );
}

function ClearedList({ areas }: { areas: ClearedArea[] }) {
  if (areas.length === 0) return null;
  const sorted = [...areas].sort((a, b) =>
    a.prefCode === b.prefCode ? (a.cityCode ?? "").localeCompare(b.cityCode ?? "") : a.prefCode.localeCompare(b.prefCode),
  );
  return (
    <details className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] px-4 py-3">
      <summary className="text-sm font-semibold text-[#3c2a14] cursor-pointer">クリアしたエリア（{areas.length}）</summary>
      <ul className="mt-2 flex flex-col divide-y divide-[#f3ece0]">
        {sorted.map((a) => (
          <li key={`${a.prefCode}-${a.cityCode ?? ""}`} className="py-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="text-[#3c2a14] truncate">{areaLabelOf(a)}</span>
            {a.bestScore != null && <span className="text-xs text-amber-600 font-semibold shrink-0">{a.bestScore.toLocaleString()}点</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
