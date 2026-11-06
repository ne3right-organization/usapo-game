import { defineFunction } from "@aws-amplify/backend";

// 地図タネで、いまいる地区のタネに落ちているタネを拾う(pickUpTaneSeeds)・1個目のご当地のタネをもらう・毎日のガチャ(drawTaneGacha)。
// 町丁の geojson を読むので、既定の3秒では足りない
export const chizuTaneSeeds = defineFunction({
  name: "chizu-tane-seeds",
  resourceGroupName: "data",
  timeoutSeconds: 15,
  memoryMB: 512,
  environment: {
    // 全環境で prd の CloudFront を使う(CLAUDE.md 参照)
    NEXT_PUBLIC_CLOUDFRONT_URL: "https://dbr7d89af0fox.cloudfront.net",
    // 本番以外は移動の速さを確かめない(開発用の位置指定で一瞬で移れるように)
    CHIZU_TANE_SKIP_SPEED_CHECK: process.env.AWS_BRANCH === "main" ? "0" : "1",
    // 上がれるレベルの上限(src/lib/game/chizuTane/courses.ts の taneMaxLevel)。ガチャで出るもの(引く人のレベルまで)のレベルの計算に使う。本番は3、それ以外は10
    CHIZU_TANE_MAX_LEVEL: process.env.AWS_BRANCH === "main" ? "3" : "10",
    // 区切りの長さ(geo.ts の DAY_MS_*)。毎日のガチャは本番は日本時間の日付、それ以外はこの区切りで1回
    CHIZU_TANE_DAY_MS: process.env.AWS_BRANCH === "main" ? String(8 * 3_600_000) : String(5 * 60_000),
  },
});
