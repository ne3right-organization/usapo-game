"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TANE_ITEMS,
  TANE_ITEM_BY_ID,
  TANE_BASE_TYPE_BY_ID,
  TANE_COURSES,
  TANE_COURSE_BY_ID,
  levelForVisitCount,
  seedsForLevel,
  visitsToNextLevel,
  type TaneCourse,
} from "@/lib/game/chizuTane/courses";
import {
  collectSeeds,
  fetchMyBases,
  fetchMySeeds,
  fetchVisitedCount,
  openGarden,
  startTane,
  type GardenState,
  type TaneBase,
  type TaneSeedCount,
} from "@/lib/game/chizuTaneData";
import GardenSvg from "./GardenSvg";
import { ErrorText, Loading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// 地図タネのトップ。初めてならコース選び、2回目からは自分のタネニワの絵と「おでかけ」(いまいる地区)への入口、自分のタネの一覧
export default function TaneHome() {
  const [state, reload] = useTanePlayer();

  return (
    <TaneScreen>
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🌱</div>
        <h1 className="text-2xl font-bold text-[#3c2a14] tracking-wide">
          地図タネ
          <span className="ml-2 text-[10px] font-bold text-emerald-600 align-middle">プロトタイプ</span>
        </h1>
        <p className="text-sm text-[#78716c] mt-2 leading-relaxed">
          街のいろいろな地区にまかれたタネを訪ねて、
          <br />
          そこで育ったもののお裾分けを集めよう
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 mb-6 leading-relaxed">
        🚧 開発中のプロトタイプです。自由に遊んでかまいませんが、まいたタネや集めたものなどの記録は、正式リリースのときにすべて削除します。
      </div>

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {state.status === "signed-out" && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 text-center">
          <p className="text-sm text-[#78716c] mb-3">地図タネで遊ぶにはログインが必要です。</p>
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
                  <p className="text-xs text-[#78716c] mt-0.5">{c.description}</p>
                  <p className="text-xs text-[#a8937a] mt-0.5">
                    最初のタネ: {firstSeeds.map((i) => `${i.emoji}${i.name}`).join("・")}
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
  const [bases, setBases] = useState<TaneBase[] | null>(null);
  const [garden, setGarden] = useState<GardenState | null>(null);
  const [visitedCount, setVisitedCount] = useState<number | null>(null);
  const [seeds, setSeeds] = useState<TaneSeedCount[] | null>(null);
  const [collected, setCollected] = useState<{ itemId: string; count: number; townName: string }[]>([]);
  const [error, setError] = useState("");
  const courseDef = TANE_COURSE_BY_ID.get(course);

  useEffect(() => {
    let cancelled = false;
    fetchMyBases()
      .then((b) => !cancelled && setBases(b))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    fetchVisitedCount()
      .then((n) => !cancelled && setVisitedCount(n))
      .catch(() => {});
    // 誰も来ないまま時間がたった自分のタネからタネを受け取ってから、持っているタネを読む
    collectSeeds()
      .catch(() => [])
      .then((gains) => {
        if (!cancelled) setCollected(gains);
        return fetchMySeeds();
      })
      .then((list) => {
        if (cancelled) return;
        const order = new Map(TANE_ITEMS.map((t, i) => [t.itemId, i]));
        setSeeds([...list].sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0)));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
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
            <span className="font-bold text-emerald-700">Lv.{levelForVisitCount(visitedCount)}</span>
            （たずねたタネ {visitedCount}か所
            {(() => {
              const next = visitsToNextLevel(visitedCount);
              return next ? `・あと${next.remaining}か所で Lv.${next.nextLevel}` : "";
            })()}
            ）
          </>
        )}
      </p>

      <Link href="/game/chizu-tane/garden" className="block bg-[#eaf6ea] rounded-2xl p-2 mb-1 active:scale-[0.99] transition-transform">
        {garden ? (
          <GardenSvg width={garden.width} height={garden.height} objects={garden.objects} />
        ) : (
          <div className="aspect-[2/1] flex items-center justify-center text-sm text-[#a8937a]">タネニワを読み込み中...</div>
        )}
      </Link>
      <p className="text-right text-xs mb-5">
        <Link href="/game/chizu-tane/garden" className="text-emerald-700 underline underline-offset-2">
          🏡 タネニワを飾る →
        </Link>
      </p>

      <Link
        href="/game/chizu-tane/here"
        className="block text-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-5 mb-3 shadow-[0_4px_16px_rgba(5,150,105,0.25)] active:scale-[0.98] transition-all"
      >
        <span className="text-lg font-bold">🚶 おでかけ</span>
        <span className="block text-xs text-emerald-50 mt-1">いまいる地区でタネをまく・ほかの人のタネを訪ねる</span>
      </Link>

      <Link
        href="/game/chizu-tane/collection"
        className="block text-center bg-white rounded-2xl border-2 border-emerald-50 hover:border-emerald-200 py-3 mb-8"
      >
        <span className="text-sm font-bold text-[#3c2a14]">🧺 集めたもの</span>
      </Link>

      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">持っているタネ</h2>
      {collected.length > 0 && (
        <div className="bg-emerald-50 text-emerald-800 rounded-xl px-3 py-2 text-xs mb-2 leading-relaxed">
          {collected.map((g) => {
            const item = TANE_ITEM_BY_ID.get(g.itemId);
            const type = item ? TANE_BASE_TYPE_BY_ID.get(item.baseTypeId) : undefined;
            return (
              <p key={`${g.townName}-${g.itemId}`}>
                🌱 {g.townName}の{type?.name ?? "タネ"}から、{item?.name ?? ""}のタネが{g.count}個とれました
              </p>
            );
          })}
        </div>
      )}
      {seeds === null ? (
        <Loading />
      ) : seeds.length === 0 ? (
        <p className="text-sm text-[#78716c] bg-white rounded-2xl p-4 mb-8">
          いまはまけるタネがありません。ほかの人のタネを初めて訪ねたり、自分のタネに人が来てくれたりすると増えます。
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-8">
          {seeds.map((sd) => {
            const item = TANE_ITEM_BY_ID.get(sd.itemId);
            return (
              <span key={sd.itemId} className="inline-flex items-center gap-1 bg-white rounded-full px-3 py-1.5 text-xs text-[#3c2a14]">
                <span className="text-base">{item?.emoji}</span>
                {item?.name ?? sd.itemId}のタネ
                <span className="text-[#a8937a]">×{sd.quantity}</span>
              </span>
            );
          })}
        </div>
      )}

      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">あなたがまいたタネ</h2>
      {error && <ErrorText message={error} />}
      {bases === null && !error && <Loading />}
      {bases?.length === 0 && (
        <p className="text-sm text-[#78716c] bg-white rounded-2xl p-4">
          まだありません。「おでかけ」で、まだタネの無い地区にタネをまけます。
        </p>
      )}
      {bases && bases.length > 0 && (
        <ul className="bg-white rounded-2xl divide-y divide-[#f3ece0]">
          {bases.map((b) => {
            const type = TANE_BASE_TYPE_BY_ID.get(b.baseTypeId);
            return (
              <li key={b.areaKey} className="flex items-center gap-3 px-4 py-3">
                <span className="text-2xl">{type?.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#3c2a14] truncate">
                    {b.townName}の{type?.name ?? "タネ"}
                  </p>
                  <p className="text-xs text-[#a8937a] truncate">
                    {b.cityName}・{TANE_ITEM_BY_ID.get(b.seedItemId)?.name ?? ""}
                  </p>
                </div>
                <span className="text-xs font-bold text-emerald-700">Lv.{b.rank}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 bg-white rounded-2xl p-4 text-xs text-[#78716c] leading-relaxed">
        <h2 className="text-sm font-bold text-[#3c2a14] mb-2">あそびかた</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>「おでかけ」で現在地の地区を調べます</li>
          <li>まだタネの無い地区なら、持っているタネを1つまけます（1つの地区に1つ、早い者勝ち）</li>
          <li>ほかの人のタネがある地区では、チェックインするとお裾分けがもらえます（1つのタネから1日1回）。初めて訪ねたタネなら、そのタネも分けてもらえます</li>
          <li>自分のタネは、人が訪ねてくれたり、自分で訪ねたりするとタネが増えます。誰も来なくても3日ごとに1個増えます</li>
          <li>ほかの人のタネをたずねた数でレベルが上がり、新しい種類のタネがもらえます</li>
          <li>集めたものは「タネニワ」に飾れます</li>
        </ol>
      </div>
    </div>
  );
}
