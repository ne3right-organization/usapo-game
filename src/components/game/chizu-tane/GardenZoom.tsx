"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDisplaySize } from "@/lib/displaySize";
import { GARDEN_ZOOM_STEPS } from "@/lib/displaySizes";

// ガーデンの絵(GardenSvg)を拡大して出す枠。はじめの倍率は設定の「表示の大きさ」(src/lib/displaySizes.ts の gardenZoom)で、
// 右上の ＋ − で変えられる(この画面を開いている間だけ)。はみ出たところは横にスクロールし、倍率を変えても見ていた真ん中を保つ。
// 飾る画面(TaneGarden)と見せてもらう画面(FriendGardenView)で使う。トップの小さい絵には使わない。
// overlay を渡すと、− ＋ を右上に出す代わりに overlay に渡し、枠の上に重ねて出す(飾る画面で、矢印・保存と並べる。
// 斜め見下ろしのガーデンは四隅が空くので、そこに置く)

export default function GardenZoom({ children, overlay }: { children: ReactNode; overlay?: (zoomButtons: ReactNode) => ReactNode }) {
  const { gardenZoom } = useDisplaySize();
  const [chosen, setChosen] = useState<number | null>(null);
  const zoom = chosen ?? gardenZoom;
  const boxRef = useRef<HTMLDivElement>(null);
  // 見ている真ん中(横の位置を 0〜1 で)。はじめは真ん中(家のあたり)
  const centerRef = useRef(0.5);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollLeft = centerRef.current * el.scrollWidth - el.clientWidth / 2;
  }, [zoom]);

  const rememberCenter = () => {
    const el = boxRef.current;
    if (el && el.scrollWidth > 0) centerRef.current = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
  };

  const smaller = [...GARDEN_ZOOM_STEPS].reverse().find((z) => z < zoom - 0.01);
  const larger = GARDEN_ZOOM_STEPS.find((z) => z > zoom + 0.01);
  const change = (z: number | undefined) => {
    if (z === undefined) return;
    rememberCenter();
    setChosen(z);
  };

  const buttonClass =
    "w-9 h-9 rounded-full bg-white/90 border border-[#e7dccb] text-lg font-bold text-[#3c2a14] shadow-sm disabled:opacity-30";
  const zoomButtons = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => change(smaller)} disabled={smaller === undefined} className={buttonClass} aria-label="小さくする">
        −
      </button>
      <button type="button" onClick={() => change(larger)} disabled={larger === undefined} className={buttonClass} aria-label="大きくする">
        ＋
      </button>
    </div>
  );
  return (
    <div className="relative">
      <div ref={boxRef} className="overflow-x-auto" onScroll={rememberCenter}>
        <div style={{ width: `${zoom * 100}%` }}>{children}</div>
      </div>
      {overlay ? overlay(zoomButtons) : <div className="absolute top-1 right-1">{zoomButtons}</div>}
    </div>
  );
}
