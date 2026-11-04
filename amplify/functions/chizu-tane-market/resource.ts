import { defineFunction } from "@aws-amplify/backend";

// うさぽ農園の市場(2026-11-05)。いまは実3個 → 1つ上のレベルのタネ1個の交換(exchangeTaneFruits)
export const chizuTaneMarket = defineFunction({
  name: "chizu-tane-market",
  resourceGroupName: "data",
  timeoutSeconds: 10,
  environment: {
    // 交換できるのは、いまの環境の上限レベルより下の種類の実だけ(本番は Lv.3 まで、それ以外は Lv.10 まで)
    CHIZU_TANE_MAX_LEVEL: process.env.AWS_BRANCH === "main" ? "3" : "10",
  },
});
