import { defineFunction } from "@aws-amplify/backend";

// 出題(src/lib/game/zukanQuizGenerator.ts)は geojson・統計API・トリビアJSONを何本も取りに行くので、
// 既定の3秒では足りない
export const startZukanQuiz = defineFunction({
  name: "start-zukan-quiz",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  memoryMB: 1024,
  environment: {
    // 全環境で prd の CloudFront を使う(CLAUDE.md 参照)
    NEXT_PUBLIC_CLOUDFRONT_URL: "https://dbr7d89af0fox.cloudfront.net",
  },
});
