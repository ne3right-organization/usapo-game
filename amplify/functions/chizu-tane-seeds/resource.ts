import { defineFunction } from "@aws-amplify/backend";

// 地図タネで、いまいる地区のタネに落ちているタネを拾う(pickUpTaneSeeds)。町丁の geojson を読むので、既定の3秒では足りない
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
  },
});
