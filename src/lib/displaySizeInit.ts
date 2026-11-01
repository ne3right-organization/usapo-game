import { DISPLAY_SIZES } from "./displaySizes";

// 表示の大きさの、ページを描く前に動かす部分。サーバー側の layout.tsx から読むので、React(フック)を読み込まない
// (フックを使う部分は src/lib/displaySize.ts)

export const DISPLAY_SIZE_STORAGE_KEY = "usapo-game:display-size";

/** 選んでいる表示の大きさの文字の倍率を <html> に入れる小さなスクリプト(layout.tsx で描く前に動かす。ちらつかないように) */
export const DISPLAY_SIZE_INIT_SCRIPT = `try{var c=${JSON.stringify(
  Object.fromEntries(Object.entries(DISPLAY_SIZES).map(([k, v]) => [k, v.textScale]))
)};var s=localStorage.getItem(${JSON.stringify(DISPLAY_SIZE_STORAGE_KEY)});if(c[s])document.documentElement.style.setProperty("--text-scale",String(c[s]))}catch(e){}`;
