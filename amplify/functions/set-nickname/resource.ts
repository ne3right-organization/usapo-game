import { defineFunction } from "@aws-amplify/backend";

// ニックネームを変え、ベスト記録・合計のニックネームも書き直す。記録が多い人だと書き直しに時間がかかり、
// 既定の3秒では起動直後(コールドスタート)に間に合わず失敗することがあるので長くする
export const setNickname = defineFunction({
  name: "set-nickname",
  resourceGroupName: "data",
  timeoutSeconds: 30,
});
