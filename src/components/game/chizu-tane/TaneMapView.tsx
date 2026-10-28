"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { fetchAllBases, isLocationOverrideAllowed, type TaneBase } from "@/lib/game/chizuTaneData";
import { ErrorText, GrowthBadge, Loading, NeedStart, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

const OWN_COLOR = "#10b981";
const OTHER_COLOR = "#f59e0b";

// タネ地図: 全国のタネを、地区の代表点に点で出す(まいた人の実際の位置ではない)。持ち主の名前は出さない
export default function TaneMapView() {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <h1 className="text-xl font-bold text-[#3c2a14] mb-1">🗾 タネ地図</h1>
      <p className="text-xs text-[#a8937a] mb-4">全国のどこにタネがあるか見られます。点は地区の真ん中あたりに出しています</p>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <TaneMap userId={state.player.userId} />}
    </TaneScreen>
  );
}

type PlacedBase = TaneBase & { repLng: number; repLat: number };

function isPlaced(b: TaneBase): b is PlacedBase {
  return typeof b.repLng === "number" && typeof b.repLat === "number";
}

interface CityGroup {
  cityKey: string;
  label: string;
  bases: PlacedBase[];
  own: number;
}

function TaneMap({ userId }: { userId: string }) {
  const [bases, setBases] = useState<PlacedBase[] | null>(null);
  // 代表点を持たないタネ(地図に出せない)の数
  const [unplaced, setUnplaced] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const overrideAllowed = useMemo(() => isLocationOverrideAllowed(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ map: L.Map; Lmod: typeof L } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllBases()
      .then((list) => {
        if (cancelled) return;
        const placed = list.filter(isPlaced);
        setBases(placed);
        setUnplaced(list.length - placed.length);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // 地図に点を置く(タネを読み終えたら1回)
  useEffect(() => {
    if (!bases) return;
    let cancelled = false;
    let mapInstance: L.Map | null = null;
    (async () => {
      const leaflet = await import("leaflet");
      const Lmod = (leaflet as { default?: typeof L }).default ?? (leaflet as unknown as typeof L);
      if (cancelled || !containerRef.current) return;
      const map = Lmod.map(containerRef.current, { center: [36.5, 137.0], zoom: 5, attributionControl: false });
      mapInstance = map;
      mapRef.current = { map, Lmod };
      Lmod.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { opacity: 0.6 }).addTo(map);
      for (const b of bases) {
        // まかれたもの(梨の木など)の絵文字を、自分のタネは緑・ほかの人のタネは橙の丸で囲んで出す
        const own = b.ownerId === userId;
        const emoji = TANE_ITEM_BY_ID.get(b.seedItemId)?.emoji ?? TANE_BASE_TYPE_BY_ID.get(b.baseTypeId)?.emoji ?? "🌱";
        const icon = Lmod.divIcon({
          className: "",
          html: `<div style="width:30px;height:30px;border-radius:9999px;background:#fff;border:3px solid ${own ? OWN_COLOR : OTHER_COLOR};display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.25)">${emoji}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        Lmod.marker([b.repLat, b.repLng], { icon })
          .addTo(map)
          .on("click", () => setSelected(b.areaKey));
      }
      if (bases.length > 0) {
        map.fitBounds(Lmod.latLngBounds(bases.map((b) => [b.repLat, b.repLng] as [number, number])), { padding: [24, 24], maxZoom: 14 });
      }
    })();
    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapRef.current = null;
    };
  }, [bases, userId]);

  // 市区町村ごとの数(多い順)
  const cities = useMemo<CityGroup[]>(() => {
    const groups = new Map<string, CityGroup>();
    for (const b of bases ?? []) {
      const g = groups.get(b.cityKey) ?? { cityKey: b.cityKey, label: `${b.prefName}${b.cityName}`, bases: [], own: 0 };
      g.bases.push(b);
      if (b.ownerId === userId) g.own++;
      groups.set(b.cityKey, g);
    }
    return [...groups.values()].sort((a, b) => b.bases.length - a.bases.length);
  }, [bases, userId]);

  const focusCity = (g: CityGroup) => {
    const m = mapRef.current;
    if (!m) return;
    m.map.fitBounds(m.Lmod.latLngBounds(g.bases.map((b) => [b.repLat, b.repLng] as [number, number])), { padding: [24, 24], maxZoom: 15 });
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const sel = selected ? bases?.find((b) => b.areaKey === selected) ?? null : null;
  const selType = sel ? TANE_BASE_TYPE_BY_ID.get(sel.baseTypeId) : undefined;

  if (error) return <ErrorText message={error} />;
  if (!bases) return <Loading />;

  return (
    <div>
      <div className="relative h-[400px] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(120,90,40,0.08)] bg-white mb-2">
        <div ref={containerRef} className="w-full h-full" />
      </div>
      <div className="flex items-center gap-4 text-[11px] text-[#78716c] mb-4">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border-[3px] bg-white" style={{ borderColor: OWN_COLOR }} />
          あなたのタネ
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border-[3px] bg-white" style={{ borderColor: OTHER_COLOR }} />
          ほかの人のタネ
        </span>
        <span>アイコンをタップすると詳しく見られます</span>
      </div>

      {unplaced > 0 && <p className="text-xs text-red-600 mb-3">場所が分からず地図に出せないタネが{unplaced}個あります</p>}

      {sel && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-4">
          <p className="text-xs text-[#a8937a]">
            {sel.prefName}
            {sel.cityName}
          </p>
          <p className="text-base font-bold text-[#3c2a14]">
            <span className="mr-1">{selType?.emoji}</span>
            {sel.townName}の{selType?.name ?? "タネ"}
            <span className="ml-1 text-xs font-normal text-[#a8937a]">（{TANE_ITEM_BY_ID.get(sel.seedItemId)?.name ?? ""}）</span>
          </p>
          <p className="mt-1">
            <GrowthBadge base={sel} />
            {sel.ownerId === userId && <span className="ml-2 text-xs text-[#a8937a]">あなたのタネ</span>}
          </p>
          {(sel.droppedSeeds ?? 0) > 0 && <p className="text-xs text-amber-700 mt-1">🌰 タネが{sel.droppedSeeds}個落ちています</p>}
          {overrideAllowed && (
            <Link
              href={`/game/chizu-tane/here?lat=${sel.repLat}&lng=${sel.repLng}`}
              className="inline-block mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-purple-600"
            >
              ここへ行く（開発用）
            </Link>
          )}
        </div>
      )}

      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">タネのある市区町村</h2>
      {cities.length === 0 ? (
        <p className="text-sm text-[#78716c] bg-white rounded-2xl p-4">まだどこにもタネがありません。</p>
      ) : (
        <ul className="bg-white rounded-2xl divide-y divide-[#f3ece0]">
          {cities.map((g) => (
            <li key={g.cityKey}>
              <button type="button" onClick={() => focusCity(g)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className="flex-1 text-sm text-[#3c2a14]">{g.label}</span>
                <span className="text-xs text-[#a8937a]">
                  {g.bases.length}個{g.own > 0 && `（あなたのタネ ${g.own}）`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
