"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  TANE_ITEMS,
  TANE_ITEM_BY_ID,
  TANE_BASE_TYPE_BY_ID,
  TANE_COURSES,
  TANE_COURSE_BY_ID,
  levelFor,
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
import SwipePages from "./SwipePages";
import ReplantPicker from "./ReplantPicker";
import InstallHint from "./InstallHint";
import { ErrorText, GrowthBadge, Loading, NextLevelHint, NoSeedsHelp, SeedIcon, TaneScreen, WaterHint } from "./TaneParts";
import { slotKey, slotLabel } from "@/lib/game/chizuTane/geo";
import { useTanePlayer } from "./useTanePlayer";

// 地図タネのトップ。初めてならコース選び、2回目からは自分のガーデンの絵と「おでかけ」(いまいる地区)への入口、自分のタネの一覧
export default function TaneHome() {
  const [state, reload] = useTanePlayer();
  // 開発環境(devgame.usapo.net・手元)だけ注意書きを出す。サーバーでの描画では出さない(ホスト名はブラウザでしか分からない)
  const isDev = useSyncExternalStore(noopSubscribe, isLocationOverrideAllowed, () => false);

  return (
    <TaneScreen>
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🌱</div>
        <h1 className="text-2xl font-bold text-[#3c2a14] tracking-wide">
          うさぽ農園
        </h1>
        <p className="text-sm text-[#78716c] mt-2 leading-relaxed">
          街のいろいろな地区にまかれたタネを訪ねて、
          <br />
          タネを分けてもらって、育てて収穫しよう
        </p>
      </div>

      {isDev && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 mb-6 leading-relaxed">
          🚧 この画面は開発用です。時間の進み方（水やりは{Math.round(taneDayMs() / 60_000)}分ごと）や位置情報の取り方（地図をタップした場所にいることにできます）などが、本番とは違います。
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
                  {counts && <span className="ml-2 text-[11px] text-emerald-700">👥 {counts.get(c.id) ?? 0}人が遊んでいます</span>}
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
  const [error, setError] = useState("");
  const courseDef = TANE_COURSE_BY_ID.get(course);
  // まいたことのあるタネ(まき直す前のものも含む。レベルの条件「いまのタネを3つともまく」に使う)
  const [plantedIds, setPlantedIds] = useState<Set<string>>(new Set());

  const loadSeeds = () =>
    fetchMySeeds().then((list) => {
      const order = new Map(TANE_ITEMS.map((t, i) => [t.itemId, i]));
      setSeeds([...list].sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0)));
    });

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
      .then((n) => !cancelled && setVisitedCount(n))
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
            （たずねたタネ {visitedCount}か所）
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
        あなたがまいたタネ{bases && bases.length > 0 && <span className="ml-1 text-xs font-normal text-[#a8937a]">（{bases.length}か所）</span>}
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
          perPage={3}
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
                  <RemoteWaterButton base={b} onWatered={(next) => setBases((cur) => cur?.map((x) => (x.areaKey === next.areaKey ? next : x)) ?? null)} />
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

      <div className="mt-8 bg-white rounded-2xl p-4 text-xs text-[#78716c] leading-relaxed">
        <h2 className="text-sm font-bold text-[#3c2a14] mb-2">あそびかた</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>「おでかけ」で現在地の地区を調べます。位置情報が、その地区（○○一丁目のような町の区切り）の中にあるかどうかで判定します</li>
          <li>まだタネの無い地区なら、持っているタネを1つまけます（1つの地区に1つ、早い者勝ち）。タネをまいて開拓した地区の数で、ガーデンが増えます</li>
          <li>まいたタネは、水をやると タネ → 芽 → 若葉 → つぼみ → 花 → 実り と育ちます（時間がたつだけでは育ちません）</li>
          <li>現地でチェックインすると水やりになります（実っていれば、水やりの代わりに実をもらいます。自分のタネでもほかの人のタネでも、1つのタネに朝・昼・夜それぞれ1回）。自分のタネには、このページから遠くから水をやることもできます（朝・昼・夜それぞれ1回、効き目は現地の10分の1）</li>
          <li>実ると実がなり（ランク1は10個。ランクが上がるほど多くなります）、あなたの手元に生産者の取り分として1個届きます（遠くから水をやって実らせても、ほかの人が実らせても）。残りは現地でチェックインした人が誰でも1個もらえます（早い者勝ち。現地で水をやって実らせた人は、そのまま1個もらえます）</li>
          <li>実が全部収穫されると、畑のランクが1つ上がり（次はもっと多く実ります）、「タネ待ち」になります。同じ種類の畑のタネを、このページから（遠くからでも）まき直すと、またタネから育ちます。1週間まかないと空き地に戻り、誰でもまけるようになります</li>
          <li>ほかの人のタネに初めてチェックインすると、そこにタネが1個落ちます（3個まで）。欲しければ拾い、要らなければ次の人のために置いていけます（誰でも早い者勝ち）</li>
          <li>収穫した実が「集めたもの」になり、「ガーデン」に飾れます</li>
          <li>下の「全国農地」で、全国のどこにタネがあるか見られます</li>
          <li>ホーム画面に追加してアプリにし、設定で通知をオンにすると、タネが実った・誰かが来た・実が全部収穫された（まき直しは1週間以内）などを知らせます（iPhone はホーム画面のアプリでだけ通知を受け取れます）</li>
          <li>ほかの人のタネをたずねた数（自分のタネは数えません）と、今のレベルのタネを3つともまいたことで、レベルが上がります（Lv.10まで）。新しい種類のタネがもらえ、ガーデンの家と柵が立派になります</li>
        </ol>
      </div>

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
      if ((next.fruits ?? 0) > 0) window.alert("実りました！ 生産者の取り分として、実が1個届きました");
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
        className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 disabled:opacity-50"
      >
        {done ? `${slot ? `${slot}の` : ""}水やりは済み` : busy ? "水をやっています..." : "💧 遠くから水をやる"}
      </button>
      {error && <span className="block text-[10px] text-red-600 mt-0.5">{error}</span>}
    </span>
  );
}
