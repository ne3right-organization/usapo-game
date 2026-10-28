import { defineFunction } from "@aws-amplify/backend";

// 地図タネで、いまいる地区のタネ(拠点)にチェックインしてもらう(checkInTaneBase)。町丁の geojson を読むので、既定の3秒では足りない
export const chizuTaneCheckin = defineFunction({
  name: "chizu-tane-checkin",
  resourceGroupName: "data",
  timeoutSeconds: 15,
  memoryMB: 512,
  environment: {
    // 全環境で prd の CloudFront を使う(CLAUDE.md 参照)
    NEXT_PUBLIC_CLOUDFRONT_URL: "https://dbr7d89af0fox.cloudfront.net",
    // 本番以外は移動の速さを確かめない(開発用の位置指定で一瞬で移れるように)
    CHIZU_TANE_SKIP_SPEED_CHECK: process.env.AWS_BRANCH === "main" ? "0" : "1",
    // 芽が出るまでの時間(本番は24時間、それ以外は試しやすいように5分。src/lib/game/chizuTane/geo.ts と同じ値)
    CHIZU_TANE_SPROUT_MS: process.env.AWS_BRANCH === "main" ? String(24 * 3_600_000) : String(5 * 60_000),
  },
});
