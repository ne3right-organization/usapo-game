import { defineFunction } from "@aws-amplify/backend";

// 地図タネの startTane・openTaneGarden・saveTaneGarden を受ける
export const chizuTanePlayer = defineFunction({
  name: "chizu-tane-player",
  resourceGroupName: "data",
});
