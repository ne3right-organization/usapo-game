"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TANE_COURSES } from "@/lib/game/chizuTane/courses";
import { TANE_LOCAL_ITEMS, type TaneLocalItem } from "@/lib/game/chizuTane/localItems";
import { fetchMyLocalItemIds } from "@/lib/game/chizuTaneData";
import CompletionMap, { type FillStyle, type MapFeatureKey } from "@/components/profile/CompletionMap";
import { ItemIcon } from "@/components/game/chizu-tane/TaneParts";

// プロフィールのコンプリート状況の「うさぽ農園」。集めたご当地の実を、何個目(現地・お土産・記念品)ごとに全国の地図に塗って絵を出す。
// 都道府県をタップすると、その県の5コース分を出す(持っていない現地のものは名前だけ、お土産・記念品は「？？？」)。
// 自分のプロフィールだけに出す(ほかの人のものは、どこへ旅したかが分かるので、いまは出さない)

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";
const PREFECTURES_URL = `${CLOUDFRONT_URL}/geojson/prefecture/prefectures.geojson`;
/** 地図に出す絵の大きさ(px) */
const MARKER_SIZE = 30;

function prefFeatureKey(feature: unknown): MapFeatureKey | null {
  const props = (feature as { properties?: Record<string, unknown> })?.properties;
  if (props?.pref == null) return null;
  const code = String(props.pref).padStart(2, "0");
  return { code, name: String(props.name ?? code) };
}

/** 地図に出す絵(その県で持っているもののうち、コースの順で最初のもの)。2つ以上なら数も添える */
function markerHtml(items: TaneLocalItem[], color: string): string {
  const top = items[0];
  const picture = top.imageUrl
    ? `<img src="${top.imageUrl}" width="${MARKER_SIZE}" height="${MARKER_SIZE}" alt="" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))">`
    : `<span style="font-size:${MARKER_SIZE * 0.75}px;line-height:${MARKER_SIZE}px">${top.emoji}</span>`;
  const badge =
    items.length > 1
      ? `<span style="position:absolute;right:-6px;bottom:-4px;background:${color};color:#fff;border-radius:9999px;font-size:10px;line-height:14px;min-width:14px;padding:0 3px;text-align:center;font-weight:700">${items.length}</span>`
      : "";
  return `<div style="position:relative;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;display:flex;align-items:center;justify-content:center">${picture}${badge}</div>`;
}

type LoadState = { status: "loading" } | { status: "ready"; ids: Set<string> } | { status: "error"; message: string };

export default function TaneLocalCompletion({
  rank,
  color,
}: {
  /** 1: 現地 / 2: お土産 / 3: 記念品 */
  rank: number;
  color: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<MapFeatureKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyLocalItemIds()
      .then((ids) => !cancelled && setState({ status: "ready", ids: new Set(ids) }))
      .catch((err) => !cancelled && setState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const ids = state.status === "ready" ? state.ids : null;
  // この何個目のもののうち、持っているものを都道府県ごとに(コースの順)
  const byPref = useMemo(() => {
    const m = new Map<string, TaneLocalItem[]>();
    if (!ids) return m;
    for (const item of TANE_LOCAL_ITEMS) {
      if (item.rank === rank && ids.has(item.itemId)) m.set(item.local, [...(m.get(item.local) ?? []), item]);
    }
    return m;
  }, [ids, rank]);
  const fillFor = useCallback(
    (code: string): FillStyle | null => {
      const n = byPref.get(code)?.length ?? 0;
      return n > 0 ? { color, opacity: 0.25 + (0.6 * n) / TANE_COURSES.length } : null;
    },
    [byPref, color],
  );
  const markerFor = useCallback(
    (code: string) => {
      const items = byPref.get(code);
      return items ? { html: markerHtml(items, color), size: MARKER_SIZE } : null;
    },
    [byPref, color],
  );

  if (state.status === "loading") return <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>;
  if (state.status === "error") return <p className="text-sm text-red-600 text-center py-6">{state.message}</p>;

  const total = [...byPref.values()].reduce((sum, items) => sum + items.length, 0);
  const all = TANE_LOCAL_ITEMS.filter((i) => i.rank === rank).length;
  return (
    <>
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] px-4 py-3 text-sm text-[#3c2a14]">
        <span className="text-2xl font-extrabold" style={{ color }}>
          {total}
        </span>
        <span className="text-[#a8937a]">
          {" "}
          / {all}（{byPref.size} / 47 都道府県）
        </span>
      </div>
      <CompletionMap
        geojsonUrl={PREFECTURES_URL}
        featureKey={prefFeatureKey}
        fillFor={fillFor}
        markerFor={markerFor}
        selectedCode={selected?.code}
        onSelect={setSelected}
      />
      {selected ? (
        <PrefItems prefCode={selected.code} prefName={selected.name} rank={rank} owned={ids ?? new Set()} />
      ) : (
        <p className="text-xs text-[#a8937a] text-center">都道府県をタップすると、その県のご当地のものが見られます</p>
      )}
    </>
  );
}

/** 1つの都道府県の、この何個目のもの(5コース分) */
function PrefItems({ prefCode, prefName, rank, owned }: { prefCode: string; prefName: string; rank: number; owned: Set<string> }) {
  const items = TANE_LOCAL_ITEMS.filter((i) => i.local === prefCode && i.rank === rank);
  const count = items.filter((i) => owned.has(i.itemId)).length;
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] px-4 py-3">
      <p className="text-sm text-[#3c2a14] mb-2">
        <span className="font-semibold">{prefName}</span>{" "}
        <span className="text-[#a8937a]">
          {count} / {items.length}
        </span>
        {items.length > 0 && count >= items.length && <span className="ml-1 font-bold">🎉</span>}
      </p>
      <div className="grid grid-cols-5 gap-1 text-2xs">
        {TANE_COURSES.map((course) => {
          const item = items.find((i) => i.course === course.id);
          if (!item) return <div key={course.id} />;
          const mine = owned.has(item.itemId);
          return (
            <div key={course.id} className="flex flex-col items-center gap-0.5 text-center">
              <ItemIcon item={item} size={36} silhouette={!mine} />
              {/* 持っていない現地のものは、旅の目当てになるよう名前を出す。お土産・記念品は手に入れてからのお楽しみ */}
              <span className={`leading-tight ${mine ? "text-[#3c2a14]" : "text-[#c8b8a0]"}`}>{mine || rank === 1 ? item.name : "？？？"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
