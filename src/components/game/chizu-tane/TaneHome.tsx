"use client";

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
  deliverFruits,
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
import { TANE_LOCAL_ITEM_BY_ID } from "@/lib/game/chizuTane/localItems";
import SwipePages from "./SwipePages";
import { CardBody, useCardLayout } from "./TaneCards";
import { GROWTH_STAGES, RIPE_STAGE, deliveryFrom, growthStage, localMarketAt, rotAt, witherAt } from "@/lib/game/chizuTane/growth";
import ReplantPicker from "./ReplantPicker";
import InstallHint from "./InstallHint";
import OfficialFields from "./OfficialFields";
import TaneTipPopup from "./TaneTipPopup";
import { FOLLOW_LINK_ANCHOR, FollowingGardens } from "./FriendGardenView";
import {
  ErrorText,
  GrowthBadge,
  GrowthStageIcon,
  ItemIcon,
  Loading,
  NextLevelHint,
  NoSeedsHelp,
  SeedIcon,
  TaneScreen,
  WaitingIcon,
  WaterHint,
} from "./TaneParts";
import { slotKey, slotLabel } from "@/lib/game/chizuTane/geo";
import { useTanePlayer } from "./useTanePlayer";
import { TANE_NEWS } from "@/lib/game/chizuTane/news";

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

      {/* お知らせ(最新の1つ。src/lib/game/chizuTane/news.ts)。開発環境では、その下に本番との違いも出す */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-800 mb-4 leading-relaxed">
        {TANE_NEWS[0].text}
        <Link href="/game/chizu-tane/news" className="ml-1 underline underline-offset-2 whitespace-nowrap">
          前のお知らせを見る →
        </Link>
      </div>
      {isDev && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 mb-4 leading-relaxed">
          🚧 この画面は開発用です。時間の進み方（水やりは{Math.round(taneDayMs() / 60_000)}分ごと）や位置情報の取り方（地図をタップした場所にいることにできます）などが、本番とは違います。現在プレイできるレベルは{taneMaxLevel()}までです（本番は{MAX_LEVEL_PRODUCTION}まで）
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
      {/* 始めたばかりの人へのヒント(済んでいないことから1つ。全部済んだら出ない) */}
      {state.status === "ready" && <TaneTipPopup />}
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
  const cards = useCardLayout();
  const [bases, setBases] = useState<TaneBase[] | null>(null);
  // 詳しいことを出している畑
  const [openAreaKey, setOpenAreaKey] = useState<string | null>(null);
  const [garden, setGarden] = useState<GardenState | null>(null);
  const [visits, setVisits] = useState<{ visited: number; official: number; helps: number } | null>(null);
  // レベルの条件に使う数(公式の畑は1か所ずつ、手伝いの水やりは HELPS_PER_VISIT 回で1か所)
  const visitedCount = visits ? levelVisitCount(visits.visited + visits.official, visits.helps) : null;
  const [seeds, setSeeds] = useState<TaneSeedCount[] | null>(null);
  const [error, setError] = useState("");
  // 遠くから水をやったときの知らせ(あなたの畑の見出しの下に出す。手伝いの水やりと同じ形)
  const [waterNotice, setWaterNotice] = useState<WaterNotice>(NO_NOTICE);
  const courseDef = TANE_COURSE_BY_ID.get(course);
  // まいたことのあるタネ(まき直す前のものも含む。レベルの条件「いまのタネを3つともまく」に使う)
  const [plantedIds, setPlantedIds] = useState<Set<string>>(new Set());

  // 新しく手に入れたものから順(fetchMySeeds で並べてある)
  const loadSeeds = () => fetchMySeeds().then(setSeeds);

  // 遠くから水をやったあと: その畑を入れ替える
  const handleWatered = (next: TaneBase) => {
    setBases((cur) => cur?.map((x) => (x.areaKey === next.areaKey ? next : x)) ?? null);
  };

  // タネ待ちの畑にまき直したあと: その畑と、持っているタネ・まいたことのあるタネを読み直す
  // 宅急便で回収した畑は空き地に戻るので、一覧から消す
  const handleDelivered = (base: TaneBase, delivered: number) => {
    setBases((cur) => cur?.filter((x) => x.areaKey !== base.areaKey) ?? null);
    setOpenAreaKey(null);
    const place = `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "畑"}`;
    setWaterNotice({ message: `🚚 ${place}の実${delivered}個が、宅急便で届きました。畑は空き地に戻りました`, error: "" });
  };
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

      <div className="flex items-center gap-2 mb-2">
        <h2 className="flex-1 text-sm font-bold text-[#3c2a14]">
          あなたの畑{bases && bases.length > 0 && <span className="ml-1 text-xs font-normal text-[#a8937a]">（{bases.length}か所）</span>}
        </h2>
        {bases && bases.length > 0 && <WaterAllButton bases={bases} onWatered={handleWatered} onNotice={setWaterNotice} />}
      </div>
      {waterNotice.error && <ErrorText message={waterNotice.error} />}
      {waterNotice.message && (
        <p className="text-xs text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2 mb-2 whitespace-pre-line">{waterNotice.message}</p>
      )}
      {error && <ErrorText message={error} />}
      {bases === null && !error && <Loading />}
      {bases?.length === 0 && (
        <p className="text-sm text-[#78716c] bg-white rounded-2xl p-4">
          まだありません。「おでかけ」で、まだタネの無い地区にタネをまけます。
        </p>
      )}
      {bases && bases.length > 0 && (
        <>
          {/* ほかのカードと同じ形で並べ(TaneCards。ふつうは 3×3 でスワイプ)、遠くからの水やりはカードの中で押せる。
              タップすると下に詳しいこと(場所・タネ・あと何回・まき直し)を出す */}
          <SwipePages
            items={bases}
            perPage={cards.perPage}
            columns={cards.columns}
            layout="grid"
            keyOf={(b) => b.areaKey}
            render={(b) => {
              const type = TANE_BASE_TYPE_BY_ID.get(b.baseTypeId);
              const stage = growthStage(b);
              const active = openAreaKey === b.areaKey;
              // 宅急便で回収できる畑は、実の数の前にトラックを出す(タップすると回収のボタンが出る)
              const from = TANE_LOCAL_ITEM_BY_ID.has(b.seedItemId) ? null : deliveryFrom(b);
              const truck = from && from.getTime() <= new Date().getTime() ? "🚚" : "";
              // 絵の左に育ち(芽・花など)、右にランク(★)を出す。タネ待ちは短く「空き」(詳しくはタップで出す)
              const status = b.waitingSince
                ? { text: "空き", className: "text-[#a16207] font-bold" }
                : stage === RIPE_STAGE
                  ? { text: "実り", className: "text-amber-600 font-bold" }
                  : { text: GROWTH_STAGES[stage].label, className: "text-emerald-700" };
              return (
                <div
                  className={`relative h-full bg-white rounded-2xl p-2 border-2 shadow-[0_2px_8px_rgba(120,90,40,0.06)] ${
                    active ? "border-emerald-500" : "border-transparent"
                  }`}
                >
                  {/* 1列: 名前は2行まで、右端に「実○個」か水やりのボタン(ボタンはタップで開くところの外に置く) */}
                  <div className={cards.columns === 1 ? "flex items-center gap-2" : undefined}>
                    <button
                      type="button"
                      onClick={() => setOpenAreaKey(active ? null : b.areaKey)}
                      aria-expanded={active}
                      className={`relative block text-center ${cards.columns === 1 ? "flex-1 min-w-0" : "w-full"}`}
                    >
                      <CardBody
                        icon={
                          <span className="flex items-center gap-1">
                            {/* 1列は、育ちの言葉の長さで名前の位置がずれないよう、いちばん長い「つぼみ」の幅にそろえる */}
                            <span
                              className={`text-3xs leading-tight whitespace-nowrap text-right ${cards.columns === 1 ? "w-[3em]" : "min-w-7"} ${status.className}`}
                            >
                              {status.text}
                            </span>
                            {b.waitingSince ? (
                              <WaitingIcon size={30} />
                            ) : (
                              <GrowthStageIcon stage={stage} seedItemId={b.seedItemId} size={30} />
                            )}
                            <span className="text-3xs leading-tight min-w-7 whitespace-nowrap text-left text-amber-500" aria-label={`ランク${b.rank}`}>
                              ★{b.rank}
                            </span>
                          </span>
                        }
                        title={`${b.townName}の${type?.name ?? "タネ"}`}
                        // 大きめ(2列)では名前が2行・3行になるので、いつも3行ぶんの高さを取ってカードの見た目をそろえる。1列は2行まで
                        titleLines={cards.columns === 1 ? 2 : 3}
                        note={
                          cards.columns !== 1 &&
                          stage === RIPE_STAGE &&
                          !b.waitingSince && <span className="block text-3xs mt-0.5 text-amber-600 font-bold">{truck}実{b.fruits ?? 0}個</span>
                        }
                      />
                    </button>
                    {cards.columns === 1 ? (
                      // 右端は「実○個」でもボタンでも同じ幅にして、名前の折り返し方をそろえる
                      <span className="shrink-0 w-[7em] text-2xs text-center">
                        {stage === RIPE_STAGE && !b.waitingSince ? (
                          <span className="text-sm text-amber-600 font-bold">{truck}実{b.fruits ?? 0}個</span>
                        ) : (
                          <RemoteWaterButton base={b} compact="side" onWatered={handleWatered} onNotice={setWaterNotice} />
                        )}
                      </span>
                    ) : (
                      <RemoteWaterButton base={b} compact="card" onWatered={handleWatered} onNotice={setWaterNotice} />
                    )}
                  </div>
                </div>
              );
            }}
          />
          {(() => {
            const b = bases.find((x) => x.areaKey === openAreaKey);
            if (!b) return <p className="text-3xs text-[#a8937a] mt-1">畑をタップすると、くわしいことが出ます</p>;
            const type = TANE_BASE_TYPE_BY_ID.get(b.baseTypeId);
            return (
              <div className="bg-white rounded-2xl px-4 py-3 mt-2 border-2 border-emerald-500">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#3c2a14]">
                      {type?.emoji} {b.townName}の{type?.name ?? "タネ"}
                    </p>
                    <p className="text-xs text-[#a8937a]">
                      {b.cityName}・{TANE_ITEM_BY_ID.get(b.seedItemId)?.name ?? ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => setOpenAreaKey(null)} className="shrink-0 text-xs text-[#a8937a] underline underline-offset-2">
                    とじる
                  </button>
                </div>
                <div className="mt-1">
                  <GrowthBadge base={b} />
                </div>
                <div className="mt-1">
                  <WaterHint base={b} />
                </div>
                <FieldEndingNote base={b} onDelivered={handleDelivered} />
                {b.waitingSince && <ReplantPicker base={b} seeds={seeds ?? []} onReplanted={handleReplanted} />}
              </div>
            );
          })()}
        </>
      )}

      {/* ガーデンの画面と同じ「見に行けるガーデン」を、あなたの畑と同じ並べ方で */}
      <FollowingGardens grid />
      {/* 友達にフォローしてもらうリンクは、ガーデンの画面のいちばん下(MyFollowers)にある */}
      <Link href={`/game/chizu-tane/garden#${FOLLOW_LINK_ANCHOR}`} className="block text-right text-xs text-emerald-700 underline underline-offset-2 mt-2">
        友達にフォローしてもらう →
      </Link>

      <OfficialFields course={course} />

      {/* ホーム画面への追加と通知の案内(状態ごとに出し分ける。済んでいれば出さない) */}
      <InstallHint />
    </div>
  );
}

const noopSubscribe = () => () => {};

/** 日時を「11月2日 14:30」の形に(日本時間) */
function dateLabel(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * 畑の終わり方(growth.ts)の案内。実っている畑は、宅急便で回収できる日時(過ぎていれば回収のボタン)と腐り落ちる日時、
 * 育っている途中の畑は、水が入らないと枯れる日時を出す。ご当地の畑は宅急便で回収できず、実って1か月で撤去して残りの実を市場に並べる。
 * 腐る・枯れるは定期実行(chizu-tane-sweep。1日3回)で行うので、その日時の次の区切りまでに空き地に戻る(「ごろ」と出す)
 */
function FieldEndingNote({ base, onDelivered }: { base: TaneBase; onDelivered: (base: TaneBase, delivered: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = new Date();
  const local = TANE_LOCAL_ITEM_BY_ID.has(base.seedItemId);
  const from = deliveryFrom(base);
  const rot = rotAt(base);
  const wither = witherAt(base);

  if (wither) {
    return <p className="text-2xs text-[#a8937a] mt-1">🍂 {dateLabel(wither)}ごろまでに水が入らないと、枯れて空き地に戻ります</p>;
  }
  if (!from || !rot) return null;
  const canDeliver = !local && from.getTime() <= now.getTime();

  const handle = async () => {
    if (!window.confirm(`残りの実${base.fruits ?? 0}個を宅急便で回収しますか？
回収すると畑は空き地に戻り、ランクも無くなります`)) return;
    setBusy(true);
    setError("");
    try {
      onDelivered(base, await deliverFruits(base.areaKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const marketAt = localMarketAt(base);
  if (local && marketAt) {
    return (
      <p className="text-2xs text-[#78716c] mt-1">
        🏪 {dateLabel(marketAt)}ごろに畑を撤去して、残りの実を市場に並べます（市場で、ほかの人の育てたご当地の実と取り替えられます）
      </p>
    );
  }

  return (
    <div className="mt-2 text-2xs text-[#78716c] space-y-1">
      {!local && !canDeliver && <p>🚚 {dateLabel(from)}から、残りの実を宅急便で全部回収できます（畑は空き地に戻ります）</p>}
      {canDeliver && (
        <button
          type="button"
          onClick={handle}
          disabled={busy}
          className="w-full rounded-xl py-2 text-xs font-semibold text-white bg-amber-600 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {busy ? "回収しています..." : `🚚 宅急便で残りの実${base.fruits ?? 0}個を回収する`}
        </button>
      )}
      {canDeliver && <p>回収すると畑は空き地に戻り、ランクも無くなります</p>}
      <p className="text-[#a16207]">🍂 {dateLabel(rot)}ごろに実が腐り落ちて、畑は空き地に戻ります</p>
      {error && <ErrorText message={error} />}
    </div>
  );
}

/** 遠くから水をやったときの知らせ(message は緑の枠、error は赤い字) */
type WaterNotice = { message: string; error: string };
const NO_NOTICE: WaterNotice = { message: "", error: "" };

/** 遠くから水をやれる畑(実っていない・タネ待ちでない・この時間帯にまだ水をやっていない) */
const canWaterRemotely = (base: TaneBase, now: Date) =>
  (base.fruits ?? 0) === 0 && !base.waitingSince && base.lastRemoteWaterOn !== slotKey(now, taneDayMs());

/**
 * あなたの畑の見出しの横の「まとめて水をやる」。遠くから水をやれる畑に、1か所ずつ順に水をやる(1か所ずつのボタンと同じ)。
 * 終わったら、何か所に水をやって何か所が実ったかを見出しの下に知らせる(onNotice。手伝いの水やりと同じ形)
 */
function WaterAllButton({
  bases,
  onWatered,
  onNotice,
}: {
  bases: TaneBase[];
  onWatered: (next: TaneBase) => void;
  onNotice: (notice: WaterNotice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const targets = bases.filter((b) => canWaterRemotely(b, new Date()));

  const handle = async () => {
    setBusy(true);
    onNotice(NO_NOTICE);
    let watered = 0;
    const ripened: string[] = [];
    const errors: string[] = [];
    for (const base of targets) {
      try {
        const next = await waterRemotely(base.areaKey);
        onWatered(next);
        watered++;
        if ((next.fruits ?? 0) > 0) {
          ripened.push(`${base.townName}の${TANE_BASE_TYPE_BY_ID.get(next.baseTypeId)?.name ?? "畑"}`);
        }
      } catch (err) {
        errors.push(`${base.townName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(false);
    const lines = [`💧 ${watered}か所に水をやりました`];
    if (ripened.length > 0) lines.push(`${ripened.join("・")}が実りました！ 生産者の取り分として、実が${ripened.length}個届きました`);
    onNotice({ message: lines.join("\n"), error: errors.length > 0 ? `水をやれなかった畑: ${errors.join(" / ")}` : "" });
  };

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy || targets.length === 0}
      className="shrink-0 rounded-lg px-2.5 py-1 text-2xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 disabled:opacity-50"
    >
      {busy ? "水やり中..." : targets.length > 0 ? `💧 まとめて水をやる（${targets.length}か所）` : "💧 まとめて水をやる"}
    </button>
  );
}

/**
 * 自分のタネに遠くから水をやるボタン(タネごとに朝・昼・夜に1回、効き目は現地の10分の1)。実っている間とタネ待ちの間は出さない。
 * compact はあなたの畑のカードの中に出すとき(短い言葉で)。"card" はカードの下に幅いっぱい、"side" は1列のカードの右端。
 * 水をやったことと失敗は、あなたの畑の見出しの下に知らせる(onNotice。手伝いの水やりと同じ形)
 */
function RemoteWaterButton({
  base,
  onWatered,
  onNotice,
  compact,
}: {
  base: TaneBase;
  onWatered: (next: TaneBase) => void;
  onNotice: (notice: WaterNotice) => void;
  compact?: "card" | "side";
}) {
  const [busy, setBusy] = useState(false);
  if ((base.fruits ?? 0) > 0 || base.waitingSince) return null;
  const now = new Date();
  const done = base.lastRemoteWaterOn === slotKey(now, taneDayMs());
  const slot = slotLabel(now, taneDayMs());
  const place = `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "畑"}`;

  const handle = async () => {
    setBusy(true);
    onNotice(NO_NOTICE);
    try {
      const next = await waterRemotely(base.areaKey);
      onWatered(next);
      const lines = [`💧 ${place}に水をやりました`];
      // 実ったら、生産者の取り分の1個が届いている
      if ((next.fruits ?? 0) > 0) lines.push(`実りました！ 生産者の取り分として、実が1個届きました`);
      onNotice({ message: lines.join("\n"), error: "" });
    } catch (err) {
      onNotice({ message: "", error: `${place}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <span className={compact === "card" ? "block mt-1.5" : "block"}>
        <button
          type="button"
          onClick={handle}
          disabled={busy || done}
          className={`w-full rounded-lg py-1.5 text-2xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 disabled:opacity-50 ${
            compact === "card" ? "px-1" : "px-2"
          }`}
        >
          {/* 1列の右端は幅が決まっているので、朝・昼・夜を付けない */}
          {done ? `${slot && compact === "card" ? `${slot}の` : ""}水やり済み` : busy ? "水やり中..." : "💧 水をやる"}
        </button>
      </span>
    );
  }
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
    </span>
  );
}
