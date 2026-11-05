import { defineFunction } from "@aws-amplify/backend";

// 管理画面(/admin)用に、うさぽ農園の利用者のデータをまとめて返す(adminTaneLocalStatus)。Cognito の admin グループの人だけが呼べる
export const chizuTaneAdmin = defineFunction({
  name: "chizu-tane-admin",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  memoryMB: 512,
});
