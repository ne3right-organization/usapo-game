"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEMS, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { formatRemaining, msUntilSprout, type TownDistrict } from "@/lib/game/chizuTane/geo";
import { HARVEST_ITEMS, RIPE_STAGE, growthStage } from "@/lib/game/chizuTane/growth";
import {
  checkIn,
  fetchBasesInCity,
  fetchMySeeds,
  getCurrentLocation,
  isLocationOverrideAllowed,
  locateTownDistrict,
  pickUpSeeds,
  placeBase,
  sproutMs,
  townDistrictGeojsonUrl,
  type Location,
  type CheckInResult,
  type TaneBase,
  type TaneSeedCount,
} from "@/lib/game/chizuTaneData";
import { ErrorText, GrowthBadge, ItemIcon, Loading, NeedStart, NoSeedsHelp, SeedIcon, TaneScreen } from "./TaneParts";
import HereMap from "./HereMap";
import { OTHER_COLOR, OWN_COLOR } from "./taneMarker";
import { useTanePlayer } from "./useTanePlayer";


// itemId があれば絵を出す。seed ならタネの絵、そうでなければ実(もの)の絵
type Notice = { kind: "ok" | "info"; text: string; itemId?: string; seed?: boolean };

// おでかけ(いまいる地区): 現在地から地区を判定して、その市区町村の地図とタネを出し、タネをまく・チェックインする
export default function HereView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <h1 className="text-xl font-bold text-[#3c2a14] mb-1">🚶 おでかけ</h1>
      <p className="text-xs text-[#a8937a] mb-4">いまいる地区でタネをまいたり、ほかの人のタネを訪ねたりできます</p>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <Here userId={state.player.userId} />}
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

function Here({ userId }: { userId: string }) {
  const [loc, setLoc] = useState<Location | null>(null);
  const [district, setDistrict] = useState<TownDistrict | null>(null);
  const [bases, setBases] = useState<TaneBase[]>([]);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const overrideAllowed = useMemo(() => isLocationOverrideAllowed(), []);
  const [manualInput, setManualInput] = useState("");
  // 持っているタネ。まくと1つ減る(種類やレベルの制限は無い)
  const [seeds, setSeeds] = useState<TaneSeedCount[] | null>(null);
  const [chosenItemId, setChosenItemId] = useState<string | null>(null);
  const applySeeds = useCallback((list: TaneSeedCount[]) => {
    // コースの表の順に並べる
    const order = new Map(TANE_ITEMS.map((t, i) => [t.itemId, i]));
    const sorted = [...list].sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0));
    setSeeds(sorted);
    setChosenItemId((cur) => (cur && sorted.some((x) => x.itemId === cur) ? cur : sorted[0]?.itemId ?? null));
  }, []);
  const reloadSeeds = useCallback(async () => applySeeds(await fetchMySeeds()), [applySeeds]);

  useEffect(() => {
    let cancelled = false;
    fetchMySeeds()
      .then((list) => !cancelled && applySeeds(list))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [applySeeds]);

  const cityKey = district ? `${district.prefCode}${district.cityCode}` : null;

  const reloadBases = useCallback(async (d: TownDistrict) => {
    setBases(await fetchBasesInCity(d.prefCode, d.cityCode));
  }, []);

  // 市区町村が変わったら、その市区町村のタネを読み直す
  useEffect(() => {
    if (!district) return;
    let cancelled = false;
    fetchBasesInCity(district.prefCode, district.cityCode)
      .then((b) => !cancelled && setBases(b))
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocating(false);
    }
  };

  // 開発用: タネ地図の「ここへ行く」から ?lat=&lng= で来たら、その点にいることにする
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
      const checkinSeeds = res.seedsGained.filter((g) => g.reason === "checkin" || g.reason === "harvest");
      const levelSeeds = res.seedsGained.filter((g) => g.reason === "level");
      const item = res.itemId ? TANE_ITEM_BY_ID.get(res.itemId) : undefined;
      if (res.status === "received" && res.itemId) {
        const parts = [`${describeSeeds(checkinSeeds)}をもらいました！ ここにもタネが1個落ちました。`];
        parts.push("チェックインで、このタネが1段階育ちました。もらったタネをまいて育てると、収穫で" + (item?.name ?? "実") + "が手に入ります。");
        if (res.leveledUp && res.level) parts.push(`レベルが上がって Lv.${res.level} になりました！ ${describeSeeds(levelSeeds)}をもらいました。`);
        setNotice({ kind: "ok", text: parts.join(" "), itemId: res.itemId, seed: true });
      } else if (res.status === "harvested" && res.itemId) {
        setNotice({
          kind: "ok",
          text: `🧺 収穫しました！ ${item?.name ?? ""}を${res.gainedItems ?? HARVEST_ITEMS}つと、${describeSeeds(checkinSeeds)}をもらいました。タネはランク${res.rank ?? ""}になって、また芽から育ちます`,
          itemId: res.itemId,
        });
      } else if (res.status === "watered") {
        setNotice({
          kind: "ok",
          text:
            res.stage === RIPE_STAGE
              ? "💧 水をやりました。実りました！ 明日また来ると収穫できます"
              : "💧 水をやりました。1段階育ちました。実ったら、ここで収穫できます",
        });
      } else {
        setNotice({ kind: "info", text: "このタネには今日はもう来ました。また明日来てください" });
      }
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

  const typeHere = baseHere ? TANE_BASE_TYPE_BY_ID.get(baseHere.baseTypeId) : null;

  return (
    <div>
      <button
        type="button"
        onClick={handleLocate}
        disabled={locating || busy}
        className="w-full rounded-xl py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 mb-3"
      >
        {locating ? "現在地を調べています..." : district ? "📍 現在地を調べ直す" : "📍 現在地を調べる"}
      </button>
      {!district && !locating && (
        <p className="text-xs text-[#a8937a] mb-3 leading-relaxed">
          ボタンを押すと、ブラウザから位置情報の利用を求められます。位置は地区を調べるのに使うだけで、保存はしません。
        </p>
      )}

      {error && <ErrorText message={error} />}

      {district && (
        <>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-3">
            <p className="text-xs text-[#a8937a]">{district.cityName}</p>
            <p className="text-lg font-bold text-[#3c2a14]">{district.townName}</p>
            <p className="text-[11px] text-[#a8937a] mt-1">位置情報には誤差があります。違う地区になっていたら、少し動いてから調べ直してください。</p>
          </div>

          <HereMap
            geojsonUrl={townDistrictGeojsonUrl(district.prefCode, district.cityCode)}
            selectedCode={district.areaKey}
            location={loc}
            bases={bases}
            userId={userId}
            onPointSelect={overrideAllowed ? handleMapPoint : undefined}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#78716c] mt-2 mb-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full border-[3px] bg-white" style={{ borderColor: OWN_COLOR }} />
              あなたのタネ
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full border-[3px] bg-white" style={{ borderColor: OTHER_COLOR }} />
              ほかの人のタネ
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow" />
              現在地
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm border-2 border-blue-700" />
              いまいる地区
            </span>
          </div>

          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-4">
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
                  <div className="flex flex-col gap-1.5 mb-3 max-h-[16.5rem] overflow-y-auto overscroll-contain pr-1">
                    {(seeds ?? []).map((sd) => {
                      const item = TANE_ITEM_BY_ID.get(sd.itemId);
                      const type = item ? TANE_BASE_TYPE_BY_ID.get(item.baseTypeId) : undefined;
                      const active = chosenItemId === sd.itemId;
                      return (
                        <button
                          key={sd.itemId}
                          type="button"
                          disabled={busy}
                          onClick={() => setChosenItemId(sd.itemId)}
                          className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm ${
                            active ? "border-emerald-500 bg-emerald-50" : "border-[#f3ece0] bg-white"
                          } disabled:opacity-50`}
                        >
                          {item ? <SeedIcon item={item} size={30} /> : null}
                          <span className="flex-1 text-[#3c2a14]">
                            {item?.name ?? sd.itemId}のタネ
                            {type && <span className="ml-1 text-[11px] text-[#a8937a]">（{type.name}になる）</span>}
                          </span>
                          <span className="text-xs text-[#a8937a]">×{sd.quantity}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handlePlant}
                    disabled={busy || !chosenItemId}
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
                    <span className="ml-1 text-xs text-[#a8937a]">（{TANE_ITEM_BY_ID.get(baseHere.seedItemId)?.name ?? ""}）</span>
                    {baseHere.ownerId === userId && <span className="ml-2 text-xs text-[#a8937a]">（あなたのタネ）</span>}
                  </p>
                  <p className="mb-2">
                    <GrowthBadge base={baseHere} />
                  </p>
                  {/* 1人1日1回。ほかの人のタネならもの1つとタネ1個(拠点にも1個落ちる)、自分のタネなら水やりか、実っていれば収穫。
                      どちらも1段階育つ。まいてから1日は芽が出ていないので、誰もチェックインできない */}
                  {msUntilSprout(baseHere.plantedAt, new Date(), sproutMs()) === 0 ? (
                    <button
                      type="button"
                      onClick={handleCheckIn}
                      disabled={busy}
                      className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60"
                    >
                      {busy
                        ? "チェックイン中..."
                        : baseHere.ownerId !== userId
                          ? "🎁 チェックインしてタネをもらう"
                          : growthStage(baseHere, new Date(), sproutMs()) === RIPE_STAGE
                            ? `🧺 収穫する（${TANE_ITEM_BY_ID.get(baseHere.seedItemId)?.name ?? ""}×${HARVEST_ITEMS}とタネ）`
                            : "💧 水をやる（チェックイン）"}
                    </button>
                  ) : (
                    <p className="rounded-xl bg-emerald-50 text-emerald-800 px-3 py-2.5 text-sm">
                      🌱 まだ芽が出ていません（{formatRemaining(msUntilSprout(baseHere.plantedAt, new Date(), sproutMs()))}で芽が出ます）
                    </p>
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
