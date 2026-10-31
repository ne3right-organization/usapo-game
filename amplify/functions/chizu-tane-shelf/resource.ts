import { defineFunction, secret } from "@aws-amplify/backend";

// 地図タネのおすそ分けの棚(taneShelf・stockTaneShelf・takeFromTaneShelf)を受ける。もらわれたら持ち主に通知を送る
export const chizuTaneShelf = defineFunction({
  name: "chizu-tane-shelf",
  resourceGroupName: "data",
  timeoutSeconds: 10,
  environment: {
    // 「1日1個」の区切り。本番は日本時間の日付、それ以外は試しやすいように5分ごと(チェックインの区切りと同じ長さ)
    CHIZU_TANE_DAY_MS: process.env.AWS_BRANCH === "main" ? String(8 * 3_600_000) : String(5 * 60_000),
    // PWA の通知を送るための秘密鍵(amplify/functions/shared/push.ts)
    VAPID_PRIVATE_KEY: secret("VAPID_PRIVATE_KEY"),
  },
});
