import { defineFunction } from "@aws-amplify/backend";

// 地図タネで、誰も来ないまま時間がたった自分のタネからタネを受け取る(collectTaneSeeds)
export const chizuTaneSeeds = defineFunction({
  name: "chizu-tane-seeds",
  resourceGroupName: "data",
  timeoutSeconds: 15,
});
