"use client";

import { useDisplaySize } from "@/lib/displaySize";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  TANE_ITEM_BY_ID,
  TANE_BASE_TYPE_BY_ID,
  TANE_COURSES,
  TANE_COURSE_BY_ID,
  taneMaxLevel,
  MAX_LEVEL_PRODUCTION,
  levelFor,
  levelVisitCount,
  seedsForLevel,
  type TaneCourse,
} from "@/lib/game/chizuTane/courses";
import {
  fetchCourseCounts,
  fetchMyBases,
  fetchMyPlantedItemIds,
  fetchMySeeds,
  fetchVisitedCount,
  isLocationOverrideAllowed,
  openGarden,
  taneDayMs,
  waterRemotely,
  startTane,
  type GardenState,
  type TaneBase,
  type TaneSeedCount,
} from "@/lib/game/chizuTaneData";
import GardenSvg from "./GardenSvg";
import { houseTierFor } from "@/lib/game/chizuTane/garden";
import { TANE_LOCAL_ITEM_BY_ID, nextLocalItem } from "@/lib/game/chizuTane/localItems";
import SwipePages from "./SwipePages";
import ReplantPicker from "./ReplantPicker";
import InstallHint from "./InstallHint";
import OfficialFields from "./OfficialFields";
import { ErrorText, GrowthBadge, ItemIcon, Loading, NextLevelHint, NoSeedsHelp, SeedIcon, TaneScreen, WaterHint } from "./TaneParts";
import { slotKey, slotLabel } from "@/lib/game/chizuTane/geo";
import { useTanePlayer } from "./useTanePlayer";

// 地図タネのトップ。初めてならコース選び、2回目からは自分のガーデンの絵と「おでかけ」(いまいる地区)への入口、自分のタネの一覧
export default function TaneHome() {
  const [state, reload] = useTanePlayer();
  // 開発環境(devgame.usapo.net・手元)だけ注意書きを出す。サーバーでの描画では出さない(ホスト名はブラウザでしか分からない)
  const isDev = useSyncExternalStore(noopSubscribe, isLocationOverrideAllowed, () => false);

  return (
    <TaneScreen>
      <div className="text-center mb-4">
        <div className="text-5xl mb-3">🌱</div>
        <h1 className="text-2xl font-bold text-[#3c2a14] tracking-wide">
          うさぽ農園
        </h1>
        <p className="text-sm text-[#78716c] mt-2 leading-relaxed">
          街のいろいろな地区にまかれたタネを訪ねて、
          <br />
          タネを分けてもらって、育てて収穫しよう
        </p>
        <p className="text-sm mt-2">
          <Link href="/game/chizu-tane/how-to-play" className="text-emerald-700 underline underline-offset-2">
            📖 あそびかた
          </Link>
        </p>
      </div>

      {/* お知らせ(本番はリリースなどの案内、開発環境は本番との違い) */}
      {isDev ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 mb-4 leading-relaxed">
          🚧 この画面は開発用です。時間の進み方（水やりは{Math.round(taneDayMs() / 60_000)}分ごと）や位置情報の取り方（地図をタップした場所にいることにできます）などが、本番とは違います。現在プレイできるレベルは{taneMaxLevel()}までです（本番は{MAX_LEVEL_PRODUCTION}まで）
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-800 mb-4 leading-relaxed">
          🎉 近くに畑が無くても遊べる「公式の畑」ができました！また知り合いを増やすと色々楽しめる機能も増えています！
        </div>
      )}

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {state.status === "signed-out" && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 text-center">
          <p className="text-sm text-[#78716c] mb-3">うさぽ農園で遊ぶにはログインが必要です。</p>
          <Link href="/login" className="text-sm font-semibold text-emerald-700 underline underline-offset-2">
            ログインする →
          </Link>
        </div>
      )}
      {state.status === "not-started" && <CoursePicker onStarted={reload} />}
      {state.status === "ready" && <Home course={state.player.course as TaneCourse} />}
    </TaneScreen>
  );
}

function CoursePicker({ onStarted }: { onStarted: () => void }) {
  const [selected, setSelected] = useState<TaneCourse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // コースごとの遊んでいる人数(出せなくても選べるので、失敗しても何も出さないだけ)
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchCourseCounts()
      .then((m) => !cancelled && setCounts(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      await startTane(selected);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-sm font-bold text-[#3c2a14] mb-1">コースを選んでください</h2>
      <p className="text-xs text-[#a8937a] mb-3">あとから変えることはできません。ほかのコースのものも、ほかの人のタネを訪ねれば手に入ります。</p>
      <div className="flex flex-col gap-2 mb-4">
        {TANE_COURSES.map((c) => {
          const firstSeeds = seedsForLevel(c.id, 1);
          const active = selected === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className={`text-left bg-white rounded-2xl border-2 p-4 transition-colors ${
                active ? "border-emerald-500" : "border-emerald-50 hover:border-emerald-200"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{c.emoji}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-[#3c2a14] text-sm">{c.label}コース</span>
                  {counts && <span className="ml-2 text-2xs text-emerald-700">👥 {counts.get(c.id) ?? 0}人が遊んでいます</span>}
                  <p className="text-xs text-[#78716c] mt-0.5">{c.description}</p>
                  <p className="text-xs text-[#a8937a] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    最初のタネ:
                    {firstSeeds.map((i) => (
                      <span key={i.itemId} className="inline-flex items-center gap-0.5">
                        <ItemIcon item={i} size={20} />
                        {i.name}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {error && <ErrorText message={error} />}
      <button
        type="button"
        onClick={handleStart}
        disabled={!selected || saving}
        className="w-full rounded-xl py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? "準備中..." : selected ? `${TANE_COURSE_BY_ID.get(selected)?.label}コースで始める` : "コースを選んでください"}
      </button>
    </div>
  );
}

function Home({ course }: { course: TaneCourse }) {
  const display = useDisplaySize();
  const [bases, setBases] = useState<TaneBase[] | null>(null);
  const [garden, setGarden] = useState<GardenState | null>(null);
  const [visits, setVisits] = useState<{ visited: number; official: number; helps: number } | null>(null);
  // レベルの条件に使う数(公式の畑は1か所ずつ、手伝いの水やりは HELPS_PER_VISIT 回で1か所)
  const visitedCount = visits ? levelVisitCount(visits.visited + visits.official, visits.helps) : null;
  const [seeds, setSeeds] = useState<TaneSeedCount[] | null>(null);
  const [error, setError] = useState("");
  const courseDef = TANE_COURSE_BY_ID.get(course);
  // まいたことのあるタネ(まき直す前のものも含む。レベルの条件「いまのタネを3つともまく」に使う)
  const [plantedIds, setPlantedIds] = useState<Set<string>>(new Set());

  // 新しく手に入れたものから順(fetchMySeeds で並べてある)
  const loadSeeds = () => fetchMySeeds().then(setSeeds);

  // タネ待ちの畑にまき直したあと: その畑と、持っているタネ・まいたことのあるタネを読み直す
  const handleReplanted = async (next: TaneBase) => {
    setBases((cur) => cur?.map((x) => (x.areaKey === next.areaKey ? next : x)) ?? null);
    await Promise.all([loadSeeds(), fetchMyPlantedItemIds().then(setPlantedIds)]).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    fetchMyBases()
      .then((b) => !cancelled && setBases(b))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    fetchVisitedCount()
      .then((v) => !cancelled && setVisits(v))
      .catch(() => {});
    fetchMyPlantedItemIds()
      .then((ids) => !cancelled && setPlantedIds(ids))
      .catch(() => {});
    loadSeeds().catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    openGarden()
      .then((g) => !cancelled && setGarden(g))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <p className="text-center text-xs text-[#a8937a] mb-4">
        {courseDef?.emoji} {courseDef?.label}コース
        {visitedCount !== null && (
          <>
            <span className="mx-2">·</span>
            <span className="font-bold text-emerald-700">Lv.{levelFor(course, visitedCount, plantedIds)}</span>
            （たずねたタネ {visits?.visited}か所{visits && visits.official > 0 && `・公式の畑 ${visits.official}か所`}
            {visits && visits.helps > 0 && `・水やりの手伝い ${visits.helps}回`}）
          </>
        )}
      </p>
      {visitedCount !== null && (
        <div className="bg-white rounded-xl px-3 py-2 mb-4 text-center">
          <NextLevelHint course={course} visitedCount={visitedCount} plantedItemIds={plantedIds} />
        </div>
      )}

      <Link href="/game/chizu-tane/garden" className="block bg-[#eaf6ea] rounded-2xl p-2 mb-1 active:scale-[0.99] transition-transform">
        {garden ? (
          <GardenSvg width={garden.width} height={garden.height} objects={garden.objects} houseTier={houseTierFor(garden.level).id} />
        ) : (
          <div className="aspect-[2/1] flex items-center justify-center text-sm text-[#a8937a]">ガーデンを読み込み中...</div>
        )}
      </Link>
      <p className="text-right text-xs mb-5">
        <Link href="/game/chizu-tane/garden" className="text-emerald-700 underline underline-offset-2">
          🏡 ガーデンを飾る →
        </Link>
      </p>

      <Link
        href="/game/chizu-tane/here"
        className="block text-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-5 mb-8 shadow-[0_4px_16px_rgba(5,150,105,0.25)] active:scale-[0.98] transition-all"
      >
        <span className="text-lg font-bold">🚶 おでかけ</span>
        <span className="block text-xs text-emerald-50 mt-1">いまいる地区でタネをまく・ほかの人のタネを訪ねる</span>
      </Link>


      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">持っているタネ</h2>
      {seeds === null ? (
        <Loading />
      ) : seeds.length === 0 ? (
        <div className="bg-white rounded-2xl p-4 mb-8">
          <NoSeedsHelp />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-8">
          {seeds.map((sd) => {
            const item = TANE_ITEM_BY_ID.get(sd.itemId);
            return (
              <span key={sd.itemId} className="inline-flex items-center gap-1.5 bg-white rounded-full pl-2 pr-3 py-1 text-xs text-[#3c2a14]">
                {item && <SeedIcon item={item} size={24} />}
                {item?.name ?? sd.itemId}のタネ
                <span className="text-[#a8937a]">×{sd.quantity}</span>
              </span>
            );
          })}
        </div>
      )}

      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">
        あなたの畑{bases && bases.length > 0 && <span className="ml-1 text-xs font-normal text-[#a8937a]">（{bases.length}か所）</span>}
      </h2>
      {error && <ErrorText message={error} />}
      {bases === null && !error && <Loading />}
      {bases?.length === 0 && (
        <p className="text-sm text-[#78716c] bg-white rounded-2xl p-4">
          まだありません。「おでかけ」で、まだタネの無い地区にタネをまけます。
        </p>
      )}
      {bases && bases.length > 0 && (
        <SwipePages
          items={bases}
          perPage={display.myFieldsPerPage}
          layout="rows"
          keyOf={(b) => b.areaKey}
          render={(b) => {
            const type = TANE_BASE_TYPE_BY_ID.get(b.baseTypeId);
            return (
              <div className="bg-white rounded-2xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{type?.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#3c2a14] truncate">
                      {b.townName}の{type?.name ?? "タネ"}
                    </p>
                    <p className="text-xs text-[#a8937a] truncate">
                      {b.cityName}・{TANE_ITEM_BY_ID.get(b.seedItemId)?.name ?? ""}
                    </p>
                  </div>
                  <span className="shrink-0">
                    <GrowthBadge base={b} />
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 pl-9">
                  <div className="flex-1 min-w-0">
                    <WaterHint base={b} />
                  </div>
                  <RemoteWaterButton
                    base={b}
                    onWatered={(next) => {
                      setBases((cur) => cur?.map((x) => (x.areaKey === next.areaKey ? next : x)) ?? null);
                      // ご当地の1個目の畑が実ると、次のご当地のタネが届いている
                      if ((next.fruits ?? 0) > 0) loadSeeds().catch(() => {});
                    }}
                  />
                </div>
                {b.waitingSince && (
                  <div className="pl-9">
                    <ReplantPicker base={b} seeds={seeds ?? []} onReplanted={handleReplanted} />
                  </div>
                )}
              </div>
            );
          }}
        />
      )}

      <OfficialFields course={course} />

      {/* ホーム画面への追加と通知の案内(状態ごとに出し分ける。済んでいれば出さない) */}
      <InstallHint />
    </div>
  );
}

const noopSubscribe = () => () => {};

/** 自分のタネに遠くから水をやるボタン(タネごとに朝・昼・夜に1回、効き目は現地の10分の1)。実っている間とタネ待ちの間は出さない */
function RemoteWaterButton({ base, onWatered }: { base: TaneBase; onWatered: (next: TaneBase) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if ((base.fruits ?? 0) > 0 || base.waitingSince) return null;
  const now = new Date();
  const done = base.lastRemoteWaterOn === slotKey(now, taneDayMs());
  const slot = slotLabel(now, taneDayMs());

  const handle = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await waterRemotely(base.areaKey);
      onWatered(next);
      // 実ったら、生産者の取り分の1個が届いている(実ったあとはこのボタンが消えるので、ここで知らせる)
      if ((next.fruits ?? 0) > 0) {
        const nextLocal = TANE_LOCAL_ITEM_BY_ID.get(base.seedItemId);
        const localSeed = nextLocal?.rank === 1 ? nextLocalItem(nextLocal) : undefined;
        window.alert(
          `実りました！ 生産者の取り分として、実が1個届きました${localSeed ? `。ご当地のタネ「${localSeed.name}」も届きました（どこでもまけます）` : ""}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="shrink-0 text-right">
      <button
        type="button"
        onClick={handle}
        disabled={busy || done}
        className="rounded-lg px-2.5 py-1 text-2xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 disabled:opacity-50"
      >
        {done ? `${slot ? `${slot}の` : ""}水やりは済み` : busy ? "水をやっています..." : "💧 遠くから水をやる"}
      </button>
      {error && <span className="block text-3xs text-red-600 mt-0.5">{error}</span>}
    </span>
  );
}
