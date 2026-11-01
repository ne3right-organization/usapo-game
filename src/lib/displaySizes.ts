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
  /** ます目に並べる列の数と、スワイプ1ページの段の数(おすそ分けの棚・ガーデンの持っているもの) */
  itemGrid: { columns: number; rows: number };
  /** 公式の畑(12か所。スワイプしない)の列の数 */
  officialFieldColumns: number;
  /** 集めたものの列の数 */
  collectionColumns: number;
  /** 持っているタネを選ぶところ(おでかけ)の、1ページに横に並べる数 */
  seedPickerPerPage: number;
  /** ホームの「あなたの畑」の、1ページに縦に並べる数 */
  myFieldsPerPage: number;
  /** ガーデンの画面のフォロワーの、1ページに横に並べる数 */
  followersPerPage: number;
}

export const DISPLAY_SIZES: Record<DisplaySize, DisplaySizeConfig> = {
  normal: {
    label: "ふつう",
    note: "これまでの大きさ",
    textScale: 1,
    iconScale: 1,
    itemGrid: { columns: 3, rows: 3 },
    officialFieldColumns: 3,
    collectionColumns: 3,
    seedPickerPerPage: 3,
    myFieldsPerPage: 3,
    followersPerPage: 3,
  },
  large: {
    label: "大きめ",
    note: "文字と絵が少し大きい",
    textScale: 1.15,
    iconScale: 1.15,
    itemGrid: { columns: 3, rows: 3 },
    officialFieldColumns: 3,
    collectionColumns: 3,
    seedPickerPerPage: 3,
    myFieldsPerPage: 3,
    followersPerPage: 3,
  },
  xlarge: {
    label: "とても大きい",
    note: "並べる数を減らす",
    textScale: 1.3,
    iconScale: 1.3,
    itemGrid: { columns: 2, rows: 3 },
    officialFieldColumns: 2,
    collectionColumns: 2,
    seedPickerPerPage: 2,
    myFieldsPerPage: 3,
    followersPerPage: 2,
  },
};

/** 設定画面に並べる順 */
export const DISPLAY_SIZE_ORDER: DisplaySize[] = ["normal", "large", "xlarge"];
