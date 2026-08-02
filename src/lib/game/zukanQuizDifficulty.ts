import type { ZukanQuizDifficulty } from "@/lib/game/zukanQuizData";

export const ZUKAN_DIFFICULTIES: ZukanQuizDifficulty[] = ["beginner", "intermediate", "advanced"];

interface ZukanDifficultyMeta {
  label: string;
  description: string;
  badgeClass: string;
}

// 難易度の表示ラベル・配色。トップページの選択カード・ゲーム内の結果表示・
// 図鑑グリッドのバッジ・カード詳細のバッジで共通利用する
export const ZUKAN_DIFFICULTY_META: Record<ZukanQuizDifficulty, ZukanDifficultyMeta> = {
  beginner: {
    label: "かんたん",
    description: "ヒント最大5件・選択肢は見分けやすい自治体",
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  intermediate: {
    label: "ふつう",
    description: "ヒント最大3件・人口が近い自治体から選択肢を出題",
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200",
  },
  advanced: {
    label: "むずかしい",
    description: "ヒントなし・人口が近い自治体から出題",
    badgeClass: "bg-rose-100 text-rose-700 border-rose-200",
  },
};
