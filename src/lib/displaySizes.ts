// 表示の大きさ(設定画面で端末ごとに選ぶ)ごとの値。画面を見ながら、ここの数字を変えて調整する。
// 仕組みは src/lib/displaySize.ts。地図パズルの画面には効かない(globals.css の .display-size-reset)

export type DisplaySize = "normal" | "large" | "xlarge";

export interface DisplaySizeConfig {
  /** 設定画面に出す名前と、その下の小さい説明 */
  label: string;
  note: string;
  /** 文字の大きさの倍率(Tailwind の text-xs などすべて) */
  textScale: number;
  /** うさぽ農園の絵(実・タネ・育ちの絵・人のアイコン)の大きさの倍率 */
  iconScale: number;
  /** うさぽ農園のカード(あなたの畑・集めたもの・公式の畑・棚・ガーデンの持っているもの・タネを選ぶところ・フォロワー・手伝いの畑)の列の数。
   *  2 以下にすると、カードが横長(絵が左・名前や数や説明が右)になる(src/components/game/chizu-tane/TaneCards.tsx) */
  cardColumns: number;
  /** スワイプでめくるカードの、1ページの段の数(あなたの畑・棚・ガーデンの持っているもの・手伝いの畑) */
  cardRows: number;
  /** ガーデン(飾る画面・見せてもらう画面)の絵を、画面の幅の何倍で出すか(はみ出たところは横にスクロール。画面の ＋ − でも変えられる) */
  gardenZoom: number;
}

export const DISPLAY_SIZES: Record<DisplaySize, DisplaySizeConfig> = {
  normal: {
    label: "ふつう",
    note: "これまでの大きさ",
    textScale: 1,
    iconScale: 1,
    cardColumns: 3,
    cardRows: 3,
    gardenZoom: 1,
  },
  large: {
    label: "大きめ",
    note: "並べる数を減らす",
    textScale: 1.3,
    iconScale: 1.3,
    cardColumns: 2,
    cardRows: 3,
    gardenZoom: 1.3,
  },
  xlarge: {
    label: "とても大きい",
    note: "1列ずつ並べる",
    textScale: 1.5,
    iconScale: 1.5,
    cardColumns: 1,
    cardRows: 4,
    gardenZoom: 1.6,
  },
};

/** ガーデンの ＋ − で選べる倍率 */
export const GARDEN_ZOOM_STEPS = [1, 1.3, 1.6, 2, 2.5];

/** 設定画面に並べる順 */
export const DISPLAY_SIZE_ORDER: DisplaySize[] = ["normal", "large", "xlarge"];
