"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * perPage 件ずつのページに分けて、左右のスワイプ(パソコンでは ‹ › ボタン)でめくる。
 * layout が "cols" なら1ページに横に並べ、"rows" なら縦に積み、"grid" なら columns 列のます目に並べる(3列で perPage 9 なら 3×3)。
 * initialIndex の件があるページを最初に開く
 */
export default function SwipePages<T>({
  items,
  perPage,
  layout,
  columns = 3,
  keyOf,
  render,
  initialIndex = 0,
}: {
  items: T[];
  perPage: number;
  layout: "cols" | "rows" | "grid";
  columns?: number;
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  initialIndex?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));

  const goTo = (p: number, smooth = true) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: p * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    if (initialIndex >= perPage) goTo(Math.floor(initialIndex / perPage), false);
    // 開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const el = scroller.current;
    if (el && el.clientWidth > 0) setPage(Math.round(el.scrollLeft / el.clientWidth));
  };

  const pageClass =
    layout === "rows" ? "flex flex-col gap-2 w-full shrink-0 snap-start px-0.5 py-0.5" : "grid gap-2 w-full shrink-0 snap-start px-0.5 py-0.5";
  const gridColumns = layout === "cols" ? perPage : layout === "grid" ? columns : null;

  return (
    <div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={handleScroll}
          className="flex items-start overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {pages.map((group, p) => (
            <div key={p} className={pageClass} style={gridColumns ? { gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` } : undefined}>
              {group.map((item) => (
                <div key={keyOf(item)} className="min-w-0">
                  {render(item)}
                </div>
              ))}
            </div>
          ))}
        </div>
        {pages.length > 1 && (
          <>
            <button
              type="button"
              aria-label="前へ"
              onClick={() => goTo(Math.max(0, page - 1))}
              disabled={page === 0}
              className="hidden sm:flex absolute -left-3 top-1/2 -translate-y-1/2 w-7 h-7 items-center justify-center rounded-full bg-white shadow text-[#78716c] disabled:opacity-0"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="次へ"
              onClick={() => goTo(Math.min(pages.length - 1, page + 1))}
              disabled={page === pages.length - 1}
              className="hidden sm:flex absolute -right-3 top-1/2 -translate-y-1/2 w-7 h-7 items-center justify-center rounded-full bg-white shadow text-[#78716c] disabled:opacity-0"
            >
              ›
            </button>
          </>
        )}
      </div>
      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2" aria-hidden>
          {pages.map((_, p) => (
            <button
              key={p}
              type="button"
              tabIndex={-1}
              onClick={() => goTo(p)}
              className={`h-1.5 rounded-full transition-all ${p === page ? "w-4 bg-emerald-500" : "w-1.5 bg-[#e3d8c5]"}`}
            />
          ))}
          <span className="ml-1 text-[10px] text-[#a8937a]">
            {page + 1} / {pages.length}・左右にスワイプ
          </span>
        </div>
      )}
    </div>
  );
}
