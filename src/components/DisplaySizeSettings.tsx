"use client";

import { setDisplaySize, useDisplaySizeName } from "@/lib/displaySize";
import { DISPLAY_SIZES, DISPLAY_SIZE_ORDER } from "@/lib/displaySizes";

// 設定画面の「表示の大きさ」。端末ごと(この端末のブラウザに覚えておく)。選ぶとすぐ変わる。値は src/lib/displaySizes.ts
export default function DisplaySizeSettings() {
  return (
    <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 mt-4">
      <h2 className="text-lg font-bold text-[#3c2a14] mb-2">🔠 表示の大きさ</h2>
      <p className="text-xs text-[#78716c] leading-relaxed mb-3">
        文字や絵の大きさを変えます。この端末だけの設定です（地図パズルの画面は変わりません）。
      </p>
      <DisplaySizeChooser />
    </div>
  );
}

/** 表示の大きさを選ぶボタン(設定画面と、うさぽ農園のトップの「快適に遊ぶために」で使う) */
export function DisplaySizeChooser() {
  const size = useDisplaySizeName();
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="表示の大きさ">
      {DISPLAY_SIZE_ORDER.map((value) => {
        const t = DISPLAY_SIZES[value];
        const active = size === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setDisplaySize(value)}
            className={`rounded-xl border px-2 py-2.5 text-center ${
              active ? "border-amber-500 bg-amber-50 text-amber-900 font-bold" : "border-gray-200 text-[#3c2a14]"
            }`}
          >
            <span className="block text-sm">{t.label}</span>
            <span className="block text-3xs text-[#a8937a] mt-0.5 leading-tight">{t.note}</span>
          </button>
        );
      })}
    </div>
  );
}
