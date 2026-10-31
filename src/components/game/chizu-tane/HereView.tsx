"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID, fruitName, type TaneCourse } from "@/lib/game/chizuTane/courses";
import type { TownDistrict } from "@/lib/game/chizuTane/geo";
import { RIPE_STAGE, growthStage, waterUntilRipe } from "@/lib/game/chizuTane/growth";
import {
  HIDDEN_LOCAL_BASE,
  LOCAL_SEED_MIN_LEVEL,
  TANE_LOCAL_ITEM_BY_ID,
  isHiddenLocalBase,
  isLocalBaseTypeId,
  localItemFor,
} from "@/lib/game/chizuTane/localItems";
import {
  checkIn,
  claimLocalSeed,
  fetchBasesInCity,
  fetchMyAreaKeys,
  fetchMyLocalGrantPrefs,
  fetchMySeeds,
  getCurrentLocation,
  isLocationOverrideAllowed,
  locateTownDistrict,
  pickUpSeeds,
  placeBase,
  taneDayMs,
  townDistrictGeojsonUrl,
  type Location,
  type CheckInResult,
  type TaneBase,
  type TanePlayer,
  type TaneSeedCount,
} from "@/lib/game/chizuTaneData";
import { ErrorText, GrowthBadge, GrowthLegend, ItemIcon, Loading, NeedStart, NoSeedsHelp, SeedIcon, TaneHeading, TaneScreen, WaterHint } from "./TaneParts";
import HereMap from "./HereMap";
import SeedPicker from "./SeedPicker";
import ReplantPicker from "./ReplantPicker";
import { useTanePlayer } from "./useTanePlayer";


// itemId があれば絵を出す。seed ならタネの絵、そうでなければ実(もの)の絵
type Notice = { kind: "ok" | "info"; text: string; itemId?: string; seed?: boolean };

// おでかけ(いまいる地区): 現在地から地区を判定して、その市区町村の地図とタネを出し、タネをまく・チェックインする
export default function HereView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <TaneHeading title="🚶 おでかけ">いまいる地区でタネをまいたり、ほかの人のタネを訪ねたりできます</TaneHeading>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <Here player={state.player} />}
    </TaneScreen>
  );
}

/** 増えたタネを「梨の木のタネ ×2」のような文にする */
function describeSeeds(gains: CheckInResult["seedsGained"]): string {
  const byItem = new Map<string, number>();
  for (const g of gains) byItem.set(g.itemId, (byItem.get(g.itemId) ?? 0) + g.count);
  return [...byItem]
    .map(([id, n]) => {
      const item = TANE_ITEM_BY_ID.get(id);
      return `${item?.emoji ?? ""}${item?.name ?? id}のタネ ×${n}`;
    })
    .join("、");
}

function Here({ player }: { player: TanePlayer }) {
  const [loc, setLoc] = useState<Location | null>(null);
  const [district, setDistrict] = useState<TownDistrict | null>(null);
  const [bases, setBases] = useState<TaneBase[]>([]);
  // 自分のタネの地区(タネの行には持ち主を持たないので、本人しか読めない一覧から)。まいたら読み直す
  const [ownAreaKeys, setOwnAreaKeys] = useState<ReadonlySet<string>>(new Set());
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const overrideAllowed = useMemo(() => isLocationOverrideAllowed(), []);
  const [manualInput, setManualInput] = useState("");
  // 地区が分かったら、まく・チェックインのカードまで画面を動かす(地区名と地図はその上に見えている)
  const actionRef = useRef<HTMLDivElement>(null);
  const [located, setLocated] = useState(0);
  useEffect(() => {
    if (located > 0) actionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [located]);
  // 持っているタネ。まくと1つ減る(種類やレベルの制限は無い)
  const [seeds, setSeeds] = useState<TaneSeedCount[] | null>(null);
  const [chosenItemId, setChosenItemId] = useState<string | null>(null);
  const applySeeds = useCallback((list: TaneSeedCount[]) => {
    // 新しく手に入れたものから順(fetchMySeeds で並べてある)。はじめは一番新しいタネを選ぶ
    setSeeds(list);
    setChosenItemId((cur) => (cur && list.some((x) => x.itemId === cur) ? cur : list[0]?.itemId ?? null));
  }, []);
  const reloadSeeds = useCallback(async () => applySeeds(await fetchMySeeds()), [applySeeds]);
  // ご当地のタネ(1個目)をもらった都道府県と、いまのレベル(Lv.3 からもらえる。チェックインでレベルが上がったら書き換える)
  const [localPrefs, setLocalPrefs] = useState<ReadonlySet<string> | null>(null);
  const [level, setLevel] = useState(player.grantedLevel ?? 1);

  useEffect(() => {
    let cancelled = false;
    fetchMySeeds()
      .then((list) => !cancelled && applySeeds(list))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    fetchMyLocalGrantPrefs()
      .then((prefs) => !cancelled && setLocalPrefs(prefs))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [applySeeds]);

  const cityKey = district ? `${district.prefCode}${district.cityCode}` : null;

  const reloadBases = useCallback(async (d: TownDistrict) => {
    const [list, mine] = await Promise.all([fetchBasesInCity(d.prefCode, d.cityCode), fetchMyAreaKeys()]);
    setBases(list);
    setOwnAreaKeys(mine);
  }, []);

  // 市区町村が変わったら、その市区町村のタネを読み直す
  useEffect(() => {
    if (!district) return;
    let cancelled = false;
    Promise.all([fetchBasesInCity(district.prefCode, district.cityCode), fetchMyAreaKeys()])
      .then(([b, mine]) => {
        if (cancelled) return;
        setBases(b);
        setOwnAreaKeys(mine);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
    // 同じ市区町村の中で地区が変わっただけなら読み直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityKey]);

  const applyLocation = async (next: Location) => {
    setError("");
    setNotice(null);
    setLocating(true);
    try {
      const d = await locateTownDistrict(next);
      if (!d) throw new Error("この場所の地区が分かりませんでした（海の上など、地区のデータが無い場所かもしれません）");
      setLoc(next);
      setDistrict(d);
      setLocated((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocating(false);
    }
  };

  // 開発用: 全国農地の「ここへ行く」から ?lat=&lng= で来たら、その点にいることにする
  useEffect(() => {
    if (!overrideAllowed) return;
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get("lat"));
    const lng = Number(q.get("lng"));
    if (!q.get("lat") || !q.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    void Promise.resolve().then(() => applyLocation({ lat, lng }));
    // 開いたときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLocate = async () => {
    setLocating(true);
    try {
      await applyLocation(await getCurrentLocation());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLocating(false);
    }
  };

  // 開発用: 地図でタップした点にいることにする(地区の境界のあたりも、実際の位置情報と同じように試せる)
  const handleMapPoint = (lat: number, lng: number) => {
    if (!overrideAllowed || locating || busy) return;
    void applyLocation({ lat, lng });
  };

  const handleManual = async () => {
    const m = manualInput.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) {
      setError("「緯度,経度」の形で入力してください（例: 35.4007,139.5332）");
      return;
    }
    await applyLocation({ lat: Number(m[1]), lng: Number(m[2]) });
  };

  const baseHere = district ? bases.find((b) => b.areaKey === district.areaKey) ?? null : null;
  const isMine = baseHere ? ownAreaKeys.has(baseHere.areaKey) : false;
  // ほかの人のご当地の畑は、実るまでは現地でも何の畑かを出さない
  const hiddenHere = baseHere ? isHiddenLocalBase(baseHere, isMine) && growthStage(baseHere) < RIPE_STAGE : false;

  // この都道府県の1個目のご当地のタネ(自分のコースのもの。まだ決めていない都道府県では無い)
  const localFirst = district ? localItemFor(district.prefCode, player.course as TaneCourse, 1) : undefined;
  const canClaimLocal = !!localFirst && !!district && localPrefs !== null && !localPrefs.has(district.prefCode);

  // 選んでいるタネがご当地のものなら: 1個目はその都道府県でしかまけない、2個目・3個目はどこでもまけるが、誰でも訪ねられることを伝える
  const chosenLocal = chosenItemId ? TANE_LOCAL_ITEM_BY_ID.get(chosenItemId) : undefined;
  const wrongPref = !!chosenLocal && chosenLocal.rank === 1 && !!district && chosenLocal.local !== district.prefCode;

  const handleClaimLocal = async () => {
    if (!loc || !district || busy || !localFirst) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const itemId = await claimLocalSeed(loc, district);
      const item = TANE_ITEM_BY_ID.get(itemId);
      setNotice({
        kind: "ok",
        text: `${district.prefName}のご当地のタネ「${item?.name ?? ""}」をもらいました！ このタネは${district.prefName}の中でだけまけます。まいた畑が実ると、次のご当地のタネが届きます`,
        itemId,
        seed: true,
      });
      setLocalPrefs((cur) => new Set([...(cur ?? []), district.prefCode]));
      await reloadSeeds();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePlant = async () => {
    if (!loc || !district || busy || !chosenItemId) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const base = await placeBase(loc, district, chosenItemId);
      await reloadSeeds();
      const type = TANE_BASE_TYPE_BY_ID.get(base.baseTypeId);
      // まく前の地区には名前が無く、まいたことで「○○町の撮影スポット」のような名前が付く
      setNotice({ kind: "ok", text: `タネをまきました！ ここは「${district.townName}の${type?.emoji ?? ""}${type?.name ?? "タネ"}」になりました` });
      await reloadBases(district);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await reloadBases(district).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleCheckIn = async () => {
    if (!loc || !district || busy) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const res = await checkIn(loc, district);
      if (res.level) setLevel(res.level);
      const levelSeeds = res.seedsGained.filter((g) => g.reason === "level");
      const localSeeds = res.seedsGained.filter((g) => g.reason === "local");
      const local = isLocalBaseTypeId(res.baseTypeId);
      const item = res.itemId ? TANE_ITEM_BY_ID.get(res.itemId) : undefined;
      const parts: string[] = [];
      if (res.status === "fruit") {
        parts.push(`${item ? fruitName(district, item.name) : "実"}を1個もらいました！（${item?.name ?? "実"}は${res.quantity ?? 1}個目）`);
        parts.push(
          res.fruits > 0
            ? `ここの実は、あと${res.fruits}個です。`
            : local
              ? "実がなくなったので、このご当地の畑は役目を終えました。"
              : `実がなくなったので、畑のランクが${res.rank ?? ""}に上がりました。持ち主がタネをまき直すのを待ちます。`
        );
      } else if (res.status === "have") {
        parts.push(
          `${item?.name ?? "この実"}はもう持っています。ご当地の実は1つの品につき1人1個なので、ほかの人のために残しておきました（ここの実は、あと${res.fruits}個です）。`
        );
      } else if (res.status === "ripened") {
        parts.push(
          (res.gainedItems ?? 0) > 0
            ? `💧 水をやりました。実りました！ ${item ? fruitName(district, item.name) : "実"}を1個もらいました（${item?.name ?? "実"}は${res.quantity ?? 1}個目）。ここの実は、あと${res.fruits}個です。`
            : `💧 水をやりました。実りました！ 実が${res.fruits}個なっています。`
        );
      } else if (res.status === "waiting") {
        parts.push(
          local
            ? "このご当地の畑は実が全部収穫されて、役目を終えました。"
            : isMine
              ? "この畑はタネ待ちです。同じ種類の畑のタネをまき直すと、また育ちます。"
              : "この畑は実が全部収穫されて、持ち主がタネをまき直すのを待っています。"
        );
      } else if (res.status === "watered") {
        const need = waterUntilRipe({ water: res.water, fruits: res.fruits });
        parts.push(`💧 水をやりました。${need ? `あと現地で${need.onsite}回水をやると実ります。` : ""}`);
      } else {
        parts.push(
          `このタネには、この時間帯はもう来ました。朝（4〜12時）・昼（12〜20時）・夜（20〜翌4時）にそれぞれ1回来られます${overrideAllowed ? `（開発環境では${Math.round(taneDayMs() / 60_000)}分ごとに区切っているので、その区切りが変わればまた来られます）` : ""}`
        );
      }
      // ご当地の畑にはタネが落ちない
      if (res.firstVisit && !local) {
        parts.push(`初めて来たので、ここに${item?.name ?? ""}のタネが落ちました。欲しければ下から拾ってください。`);
      }
      if (localSeeds.length > 0) parts.push(`ご当地のタネが届きました！ ${describeSeeds(localSeeds)}。どこでもまけます。`);
      if (res.leveledUp && res.level) parts.push(`レベルが上がって Lv.${res.level} になりました！ ${describeSeeds(levelSeeds)}をもらいました。`);
      const gotFruit = res.status === "fruit" || (res.gainedItems ?? 0) > 0;
      setNotice({
        kind: res.status === "already" ? "info" : "ok",
        text: parts.join(" "),
        // 実ったあと(実をもらった・もう持っていた)か、タネが落ちたときだけ絵を出す(ご当地の畑は実るまで伏せる)
        itemId: gotFruit || res.status === "have" || (res.firstVisit && !local) ? res.itemId ?? undefined : undefined,
        seed: !gotFruit && res.status !== "have",
      });
      if (res.seedsGained.length > 0) await reloadSeeds();
      await reloadBases(district);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePickUp = async (count: number) => {
    if (!loc || !district || busy) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const n = await pickUpSeeds(loc, district, count);
      const item = baseHere ? TANE_ITEM_BY_ID.get(baseHere.seedItemId) : undefined;
      setNotice(
        n > 0
          ? { kind: "ok", text: `落ちていた${item?.name ?? ""}のタネを${n}個拾いました！` }
          : { kind: "info", text: "拾えませんでした（ほかの人が先に拾ったようです）。残っている数を確かめてください" }
      );
      await reloadSeeds();
      await reloadBases(district);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const typeHere = baseHere ? (hiddenHere ? HIDDEN_LOCAL_BASE : TANE_BASE_TYPE_BY_ID.get(baseHere.baseTypeId)) : null;
  const fruitHere = baseHere && !hiddenHere ? TANE_ITEM_BY_ID.get(baseHere.seedItemId) : undefined;

  return (
    <div>
      {/* 地区が分かったあとは、調べ直すボタンを地区名のカードの中に出す */}
      {!district && (
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating || busy}
          className="w-full rounded-xl py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 mb-3"
        >
          {locating ? "現在地を調べています..." : "📍 現在地を調べる"}
        </button>
      )}
      {!district && !locating && (
        <p className="text-xs text-[#a8937a] mb-3 leading-relaxed">
          ボタンを押すと、ブラウザから位置情報の利用を求められます。位置は地区を調べるのに使うだけで、保存はしません。
        </p>
      )}

      {error && <ErrorText message={error} />}

      {district && (
        <>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#a8937a]">{district.cityName}</p>
                <p className="text-lg font-bold text-[#3c2a14]">{district.townName}</p>
              </div>
              <button
                type="button"
                onClick={handleLocate}
                disabled={locating || busy}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-60"
              >
                {locating ? "調べています..." : "📍 調べ直す"}
              </button>
            </div>
            <p className="text-[11px] text-[#a8937a] mt-1">位置情報には誤差があります。違う地区になっていたら、少し動いてから調べ直してください。</p>
          </div>

          <HereMap
            geojsonUrl={townDistrictGeojsonUrl(district.prefCode, district.cityCode)}
            selectedCode={district.areaKey}
            location={loc}
            bases={bases}
            ownAreaKeys={ownAreaKeys}
            onPointSelect={overrideAllowed ? handleMapPoint : undefined}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#78716c] mt-2 mb-3">
            <GrowthLegend />
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow" />
              現在地
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm border-2 border-blue-700" />
              いまいる地区
            </span>
          </div>

          <div ref={actionRef} className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-4 scroll-mt-4">
            {/* ご当地のタネ(1個目)。その都道府県で初めておでかけしたときに、Lv.3 以上なら1回だけもらえる */}
            {canClaimLocal && localFirst && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-3 mb-3">
                {level >= LOCAL_SEED_MIN_LEVEL ? (
                  <>
                    <p className="text-sm text-amber-900 mb-2">🗾 {district.prefName}に来ました！ ご当地のタネを1つもらえます（1つの都道府県で1回だけ）</p>
                    <button
                      type="button"
                      onClick={handleClaimLocal}
                      disabled={busy}
                      className="w-full rounded-lg py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60"
                    >
                      {busy ? "もらっています..." : `${district.prefName}のご当地のタネをもらう`}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-amber-900">
                    🗾 Lv.{LOCAL_SEED_MIN_LEVEL} になると、{district.prefName}に来たときに、ここでしか手に入らないご当地のタネがもらえます
                  </p>
                )}
              </div>
            )}
            <div>
              {!baseHere && (
                <>
                  {seeds !== null && seeds.length === 0 ? (
                    <>
                      <p className="text-sm text-[#78716c] mb-2">この地区にはまだタネがありません。</p>
                      <NoSeedsHelp onMap />
                    </>
                  ) : (
                    <p className="text-sm text-[#78716c] mb-2">この地区にはまだタネがありません。どのタネをまきますか？</p>
                  )}
                  {seeds && seeds.length > 0 && (
                    <SeedPicker seeds={seeds} chosenItemId={chosenItemId} onChoose={setChosenItemId} disabled={busy} />
                  )}
                  {chosenLocal && (
                    <p className={`text-xs mb-2 ${wrongPref ? "text-red-600" : "text-amber-800"}`}>
                      {wrongPref
                        ? `「${chosenLocal.name}」のタネは、もらった都道府県の中でだけまけます`
                        : chosenLocal.rank === 1
                          ? "ご当地の畑は1回かぎりで、まき直せません。実ると、次のご当地のタネが届きます"
                          : "この畑は誰でも訪ねられます。家のすぐ近くは避けるのがおすすめです（ご当地の畑はまき直せない1回かぎりの畑です）"}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handlePlant}
                    disabled={busy || !chosenItemId || wrongPref}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busy ? "まいています..." : "🌱 この地区にタネをまく"}
                  </button>
                </>
              )}
              {baseHere && (
                <>
                  <p className="text-sm text-[#3c2a14] mb-2">
                    <span className="text-xl mr-1">{typeHere?.emoji}</span>
                    {district.townName}の{typeHere?.name ?? "タネ"}
                    {fruitHere && <span className="ml-1 text-xs text-[#a8937a]">（{fruitHere.name}）</span>}
                    {isMine && <span className="ml-2 text-xs text-[#a8937a]">（あなたのタネ）</span>}
                  </p>
                  {hiddenHere && <p className="text-xs text-[#a8937a] mb-1">何の畑かは、実ってからチェックインすると分かります</p>}
                  <div className="mb-2">
                    <GrowthBadge base={baseHere} hidden={hiddenHere} />
                    <WaterHint base={baseHere} remote={isMine} />
                  </div>
                  {/* 1人1つの時間帯(朝・昼・夜)に1回(dev は5分ごと)。チェックインは水やりと同じで、実っていれば実を1個もらう(誰でも)。
                      ほかの人のタネに初めて来たときは、そこにタネが1個落ちる(拾うかは選べる)。まいた直後から水をやれる */}
                  {/* タネ待ちの自分の畑は、チェックインの代わりにまき直す */}
                  {baseHere.waitingSince && isMine ? (
                    <ReplantPicker
                      base={baseHere}
                      seeds={seeds ?? []}
                      onReplanted={async () => {
                        setNotice({ kind: "ok", text: "タネをまき直しました！ またタネから育ちます" });
                        await Promise.all([reloadSeeds(), reloadBases(district)]);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={handleCheckIn}
                      disabled={busy}
                      className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60"
                    >
                      {busy
                        ? "チェックイン中..."
                        : baseHere.waitingSince
                          ? "📍 チェックインする（タネ待ち）"
                          : (baseHere.fruits ?? 0) > 0
                            ? (
                              <span className="inline-flex items-center justify-center gap-1.5">
                                {fruitHere && <ItemIcon item={fruitHere} size={24} />}
                                チェックインして実をもらう（残り{baseHere.fruits}個）
                              </span>
                            )
                            : "💧 チェックインして水をやる"}
                    </button>
                  )}
                  {(baseHere.droppedSeeds ?? 0) > 0 && (
                    <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-3">
                      <p className="text-sm text-amber-900 mb-2">
                        🌰 ここに{TANE_ITEM_BY_ID.get(baseHere.seedItemId)?.name ?? ""}のタネが{baseHere.droppedSeeds}個落ちています。
                        拾うか、次の人のために残しておくか選べます（早い者勝ち）
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: baseHere.droppedSeeds ?? 0 }, (_, i) => i + 1).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => handlePickUp(n)}
                            disabled={busy}
                            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-60"
                          >
                            {n}個拾う
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-amber-700 mt-2">拾わなければ、そのまま残ります</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {notice && (
              <div
                className={`mt-3 rounded-xl px-3 py-3 text-sm flex items-center gap-3 ${
                  notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-[#f8f3ea] text-[#78716c]"
                }`}
              >
                {notice.itemId &&
                  TANE_ITEM_BY_ID.get(notice.itemId) &&
                  (notice.seed ? (
                    <SeedIcon item={TANE_ITEM_BY_ID.get(notice.itemId)!} size={40} />
                  ) : (
                    <ItemIcon item={TANE_ITEM_BY_ID.get(notice.itemId)!} size={40} />
                  ))}
                <span>{notice.text}</span>
              </div>
            )}
          </div>

        </>
      )}

      {overrideAllowed && (
        <div className="border-2 border-dashed border-purple-200 rounded-2xl p-3 text-xs text-purple-800 bg-purple-50/50">
          <p className="font-bold mb-1">開発用（dev 環境と手元だけ）</p>
          <p className="mb-2">地図をタップすると、その点にいることにします（となりの市区町村の上をタップすれば、そちらに移ります）。遠くへは緯度・経度で移れます。</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="35.4007,139.5332"
              className="flex-1 min-w-0 border border-purple-200 rounded-lg px-2 py-1.5 bg-white text-[#3c2a14]"
            />
            <button type="button" onClick={handleManual} disabled={locating} className="rounded-lg px-3 py-1.5 bg-purple-600 text-white font-semibold">
              移動
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
