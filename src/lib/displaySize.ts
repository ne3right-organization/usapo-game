import { useSyncExternalStore } from "react";
import { DISPLAY_SIZES, type DisplaySize, type DisplaySizeConfig } from "./displaySizes";
import { DISPLAY_SIZE_STORAGE_KEY } from "./displaySizeInit";

// 表示の大きさ(2026-11-02)。設定画面で端末ごとに選び、localStorage に覚えておく。値は src/lib/displaySizes.ts。
// - 文字: <html> の style に --text-scale を入れると、globals.css の @theme で Tailwind の文字の大きさに掛かる
// - 絵と並べる数: 画面の部品が useDisplaySize() で値を読む(選び直すと、開いている画面もすぐ変わる)
// フックを使うので、ブラウザ側の部品からだけ読む(描く前に動かすスクリプトは src/lib/displaySizeInit.ts)

function isDisplaySize(value: unknown): value is DisplaySize {
  return typeof value === "string" && value in DISPLAY_SIZES;
}

function loadDisplaySize(): DisplaySize {
  try {
    const value = localStorage.getItem(DISPLAY_SIZE_STORAGE_KEY);
    return isDisplaySize(value) ? value : "normal";
  } catch {
    return "normal";
  }
}

let current: DisplaySize = typeof window === "undefined" ? "normal" : loadDisplaySize();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 表示の大きさを変えて、この端末に覚えておく */
export function setDisplaySize(size: DisplaySize): void {
  current = size;
  document.documentElement.style.setProperty("--text-scale", String(DISPLAY_SIZES[size].textScale));
  try {
    localStorage.setItem(DISPLAY_SIZE_STORAGE_KEY, size);
  } catch {
    // 保存できなくても、この画面を開いている間は変わる
  }
  for (const listener of listeners) listener();
}

/** いま選んでいる表示の大きさ(サーバーで描くときと、描いた直後は「ふつう」) */
export function useDisplaySizeName(): DisplaySize {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "normal"
  );
}

/** いま選んでいる表示の大きさの値(絵の大きさ・並べる数) */
export function useDisplaySize(): DisplaySizeConfig {
  return DISPLAY_SIZES[useDisplaySizeName()];
}
