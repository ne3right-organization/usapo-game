import { defineFunction, secret } from "@aws-amplify/backend";

// 地図タネで、いまいる地区のタネ(拠点)にチェックインする(checkInTaneBase。水やり・実をもらう)と、自分のタネに遠くから水をやる
// (waterTaneBaseRemotely)。タネの持ち主に通知を送る(実った・誰かが来た)。町丁の geojson を読むので、既定の3秒では足りない
export const chizuTaneCheckin = defineFunction({
  name: "chizu-tane-checkin",
  resourceGroupName: "data",
  timeoutSeconds: 15,
  memoryMB: 512,
  environment: {
    // 全環境で prd の CloudFront を使う(CLAUDE.md 参照)
    NEXT_PUBLIC_CLOUDFRONT_URL: "https://dbr7d89af0fox.cloudfront.net",
    // 本番以外は移動の速さを確かめない(開発用の位置指定で一瞬で移れるように)
    CHIZU_TANE_SKIP_SPEED_CHECK: process.env.AWS_BRANCH === "main" ? "0" : "1",
    // チェックイン・遠くからの水やりの区切りの長さ(本番は朝・昼・夜の8時間で、日本時間の時間帯で区切る。
    // それ以外は試しやすいように5分。src/lib/game/chizuTane/geo.ts の DAY_MS_* と同じ値)
    CHIZU_TANE_DAY_MS: process.env.AWS_BRANCH === "main" ? String(8 * 3_600_000) : String(5 * 60_000),
    // PWA の通知を送るための秘密鍵(amplify/functions/shared/push.ts)
    VAPID_PRIVATE_KEY: secret("VAPID_PRIVATE_KEY"),
  },
});
