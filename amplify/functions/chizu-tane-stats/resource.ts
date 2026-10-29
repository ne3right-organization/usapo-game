import { defineFunction } from "@aws-amplify/backend";

// 地図タネの taneCourseCounts(コースごとの遊んでいる人数)を受ける
export const chizuTaneStats = defineFunction({
  name: "chizu-tane-stats",
  resourceGroupName: "data",
});
