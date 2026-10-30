import { defineFunction } from "@aws-amplify/backend";

// 地図タネで、いまいる地区にタネ(拠点)をまく(placeTaneBase)・タネ待ちの自分の畑にまき直す(replantTaneBase)。町丁の geojson を読むので、既定の3秒では足りない
export const chizuTanePlace = defineFunction({
  name: "chizu-tane-place",
  resourceGroupName: "data",
  timeoutSeconds: 15,
  memoryMB: 512,
  environment: {
    // 全環境で prd の CloudFront を使う(CLAUDE.md 参照)
    NEXT_PUBLIC_CLOUDFRONT_URL: "https://dbr7d89af0fox.cloudfront.net",
    // 本番以外は移動の速さを確かめない(開発用の位置指定で一瞬で移れるように)
    CHIZU_TANE_SKIP_SPEED_CHECK: process.env.AWS_BRANCH === "main" ? "0" : "1",
    // 区切りの長さ(タネ待ちの畑が空き地に戻るまでの時間に使う)。chizu-tane-checkin と同じ値にする
    CHIZU_TANE_DAY_MS: process.env.AWS_BRANCH === "main" ? String(8 * 60 * 60 * 1000) : String(5 * 60 * 1000),
  },
});
