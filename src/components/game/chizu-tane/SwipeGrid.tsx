"use client";

import { useRef, useState, type ReactNode } from "react";

// 3×3 ずつのページに分けて、横にスワイプでめくる一覧(棚・ガーデンの持っているもの)。
// めくるのはブラウザの横スクロール(scroll-snap)にまかせ、下の点で何ページ目かを出す(点を押してもめくれる)
export default function SwipeGrid({ children, pageSize = 9, className = "" }: { children: ReactNode[]; pageSize?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pages: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += pageSize) pages.push(children.slice(i, i + pageSize));
  const current = Math.min(page, Math.max(pages.length - 1, 0));

  const handleScroll = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goTo = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className={className}>
      <div
        ref={ref}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((items, i) => (
          <ul key={i} className="grid grid-cols-3 gap-2 w-full shrink-0 snap-start content-start">
            {items}
          </ul>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2" aria-label="ページ">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`${i + 1}ページ目`}
              className={`w-2 h-2 rounded-full ${i === current ? "bg-emerald-600" : "bg-[#e7dccb]"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
