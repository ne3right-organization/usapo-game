import type { ZukanQuizTrivia } from "@/lib/game/zukanQuizClient";

// 表示ラベルの並び順(本体側のトリビア管理画面のデータモデルと合わせている)。
// クイズ本編(ZukanQuizGame)とカード詳細(ZukanCardDetail)の両方で共通利用する
export const TRIVIA_FIELD_LABELS: { key: keyof ZukanQuizTrivia; label: string }[] = [
  { key: "industry", label: "主な産業" },
  { key: "specialty", label: "名物・特産品" },
  { key: "historicalEvent", label: "歴史上有名な出来事" },
  { key: "touristSpot", label: "観光スポット" },
  { key: "notablePerson", label: "ゆかりの人物" },
  { key: "festival", label: "祭り・イベント" },
  { key: "natureFeature", label: "自然・地形の特徴" },
  { key: "localCuisine", label: "郷土料理・ご当地グルメ" },
];
