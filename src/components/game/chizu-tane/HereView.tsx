"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CompletionMap, { type FillStyle, type MapFeatureKey } from "@/components/profile/CompletionMap";
import { TANE_BASE_TYPES, TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import type { TownDistrict } from "@/lib/game/chizuTane/geo";
import {
  checkIn,
  fetchBasesInCity,
  fetchMySeeds,
  getCurrentLocation,
  isLocationOverrideAllowed,
  locateTownDistrict,
  placeBase,
  townDistrictGeojsonUrl,
  type Location,
  type CheckInResult,
  type TaneBase,
  type TaneSeedCount,
} from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, TaneBackLink, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

const OWN_FILL: FillStyle = { color: "#10b981", opacity: 0.55 };
const OTHER_FILL: FillStyle = { color: "#f59e0b", opacity: 0.55 };

type Notice = { kind: "ok" | "info"; text: string; itemId?: string };

// おでかけ(いまいる地区): 現在地から地区を判定して、その市区町村の地図とタネを出し、タネをまく・チェックインする
export default function HereView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <TaneBackLink />
      <h1 className="text-xl font-bold text-[#3c2a14] mb-1">🚶 おでかけ</h1>
      <p className="text-xs text-[#a8937a] mb-4">いまいる地区でタネをまいたり、ほかの人のタネを訪ねたりできます</p>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <Here userId={state.player.userId} />}
    </TaneScreen>
  );
}

/** 増えたタネを「○○のタネ ×2」のような文にする */
function describeSeeds(gains: CheckInResult["seedsGained"]): string {
  const byType = new Map<string, number>();
  for (const g of gains) byType.set(g.baseTypeId, (byType.get(g.baseTypeId) ?? 0) + g.count);
  return [...byType]
    .map(([id, n]) => {
      const t = TANE_BASE_TYPE_BY_ID.get(id);
      return `${t?.emoji ?? ""}${t?.name ?? id}のタネ ×${n}`;
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
  const [chosenTypeId, setChosenTypeId] = useState<string | null>(null);
  const applySeeds = useCallback((list: TaneSeedCount[]) => {
    // コースの表の順に並べる
    const order = new Map(TANE_BASE_TYPES.map((t, i) => [t.id, i]));
    const sorted = [...list].sort((a, b) => (order.get(a.baseTypeId) ?? 0) - (order.get(b.baseTypeId) ?? 0));
    setSeeds(sorted);
    setChosenTypeId((cur) => (cur && sorted.some((x) => x.baseTypeId === cur) ? cur : sorted[0]?.baseTypeId ?? null));
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
  const baseByArea = useMemo(() => new Map(bases.map((b) => [b.areaKey, b])), [bases]);

  const fillFor = useCallback(
    (code: string): FillStyle | null => {
      const b = baseByArea.get(code);
      if (!b) return null;
      return b.ownerId === userId ? OWN_FILL : OTHER_FILL;
    },
    [baseByArea, userId]
  );
  const featureKey = useCallback((feature: unknown): MapFeatureKey | null => {
    const p = (feature as { properties?: Record<string, unknown> })?.properties;
    return typeof p?.KEY_CODE === "string" ? { code: p.KEY_CODE, name: String(p.S_NAME ?? "") } : null;
  }, []);

  const handlePlant = async () => {
    if (!loc || !district || busy || !chosenTypeId) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const base = await placeBase(loc, district, chosenTypeId);
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
      const visitSeeds = res.seedsGained.filter((g) => g.reason === "visit");
      const levelSeeds = res.seedsGained.filter((g) => g.reason === "level");
      if (res.status === "received" && res.itemId) {
        const item = TANE_ITEM_BY_ID.get(res.itemId);
        const parts = [`${item?.name ?? "おすそわけ"}をもらいました！（${res.quantity ?? 1}個目）`];
        if (visitSeeds.length > 0) parts.push(`はじめて訪ねたので、${describeSeeds(visitSeeds)}を分けてもらいました。`);
        if (res.leveledUp && res.level) parts.push(`レベルが上がって Lv.${res.level} になりました！ ${describeSeeds(levelSeeds)}をもらいました。`);
        setNotice({ kind: "ok", text: parts.join(" "), itemId: res.itemId });
      } else if (res.status === "already") {
        setNotice({ kind: "info", text: "このタネからは今日はもうもらいました。また明日来てください" });
      } else if (res.seedsGained.length > 0) {
        setNotice({ kind: "ok", text: `あなたのタネです。${describeSeeds(res.seedsGained)}がとれました（1日1回）` });
      } else {
        setNotice({ kind: "info", text: "あなたのタネです。今日はもうタネをとりました" });
      }
      if (res.seedsGained.length > 0) await reloadSeeds();
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

            <div className="mt-3 pt-3 border-t border-[#f3ece0]">
              {!baseHere && (
                <>
                  {seeds !== null && seeds.length === 0 ? (
                    <p className="text-sm text-[#78716c]">
                      この地区にはまだタネがありません。いまはまけるタネを持っていません（ほかの人のタネを初めて訪ねたり、自分のタネに人が来てくれたりすると増えます）。
                    </p>
                  ) : (
                    <p className="text-sm text-[#78716c] mb-2">この地区にはまだタネがありません。どのタネをまきますか？</p>
                  )}
                  <div className="flex flex-col gap-1.5 mb-3">
                    {(seeds ?? []).map((sd) => {
                      const t = TANE_BASE_TYPE_BY_ID.get(sd.baseTypeId);
                      const active = chosenTypeId === sd.baseTypeId;
                      return (
                        <button
                          key={sd.baseTypeId}
                          type="button"
                          disabled={busy}
                          onClick={() => setChosenTypeId(sd.baseTypeId)}
                          className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm ${
                            active ? "border-emerald-500 bg-emerald-50" : "border-[#f3ece0] bg-white"
                          } disabled:opacity-50`}
                        >
                          <span className="text-xl">{t?.emoji}</span>
                          <span className="flex-1 text-[#3c2a14]">{t?.name ?? sd.baseTypeId}のタネ</span>
                          <span className="text-xs text-[#a8937a]">×{sd.quantity}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handlePlant}
                    disabled={busy || !chosenTypeId}
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
                    <span className="ml-2 text-xs font-bold text-emerald-700">Lv.{baseHere.rank}</span>
                    {baseHere.ownerId === userId && <span className="ml-2 text-xs text-[#a8937a]">（あなたのタネ）</span>}
                  </p>
                  {baseHere.ownerId !== userId && (
                    <button
                      type="button"
                      onClick={handleCheckIn}
                      disabled={busy}
                      className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60"
                    >
                      {busy ? "チェックイン中..." : "🎁 チェックインしておすそわけをもらう"}
                    </button>
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
                {notice.itemId && TANE_ITEM_BY_ID.get(notice.itemId) && <ItemIcon item={TANE_ITEM_BY_ID.get(notice.itemId)!} size={40} />}
                <span>{notice.text}</span>
              </div>
            )}
          </div>

          <CompletionMap
            geojsonUrl={townDistrictGeojsonUrl(district.prefCode, district.cityCode)}
            featureKey={featureKey}
            fillFor={fillFor}
            selectedCode={district.areaKey}
            onPointSelect={overrideAllowed ? handleMapPoint : undefined}
          />
          <div className="flex items-center gap-4 text-[11px] text-[#78716c] mt-2 mb-4">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: OWN_FILL.color }} />
              あなたのタネ
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: OTHER_FILL.color }} />
              ほかの人のタネ
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm border-2 border-blue-700" />
              いまいる地区
            </span>
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
