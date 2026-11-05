import { defineFunction, secret } from "@aws-amplify/backend";

// うさぽ農園の畑の終わり方(2026-11-05。src/lib/game/chizuTane/growth.ts)を定期実行で行う。期限を過ぎた畑(タネ待ちのまま1週間・腐り落ちた・枯れた)を
// 空き地に戻し、期限が近い畑(宅急便で回収できる・もうすぐ腐る・もうすぐ枯れる)の持ち主に知らせる。
// 水やりの区切りと同じ間隔で動かす: 本番は日本時間 4時・12時・20時(朝・昼・夜の始まり。src/lib/game/chizuTane/geo.ts)の1分後、それ以外は5分ごと
// (期限の長さは dev でも本番と同じ。dev は DynamoDB の日時を書き換えて試すので、すぐ反映されるよう細かく動かす)
const production = process.env.AWS_BRANCH === "main";

export const chizuTaneSweep = defineFunction({
  name: "chizu-tane-sweep",
  resourceGroupName: "data",
  timeoutSeconds: 120,
  // 日本時間 4:01・12:01・20:01 = UTC 19:01・3:01・11:01
  schedule: production ? "1 3,11,19 * * ?" : "every 5m",
  environment: {
    // PWA の通知を送るための秘密鍵(amplify/functions/shared/push.ts)
    VAPID_PRIVATE_KEY: secret("VAPID_PRIVATE_KEY"),
  },
});
