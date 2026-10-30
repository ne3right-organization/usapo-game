import { defineFunction } from "@aws-amplify/backend";

// 地図タネの startTane・openTaneGarden・saveTaneGarden を受ける
export const chizuTanePlayer = defineFunction({
  name: "chizu-tane-player",
  resourceGroupName: "data",
  environment: {
    // 上がれるレベルの上限(src/lib/game/chizuTane/courses.ts の taneMaxLevel)。本番は3、それ以外は10
    CHIZU_TANE_MAX_LEVEL: process.env.AWS_BRANCH === "main" ? "3" : "10",
  },
});
