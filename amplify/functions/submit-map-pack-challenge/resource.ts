import { defineFunction, secret } from "@aws-amplify/backend";

// 地図ポットンの記録を送る。クリアしたらフォロワーに通知を送る(送るのに時間がかかることがあるので、既定の3秒より長くする)
export const submitMapPackChallenge = defineFunction({
  name: "submit-map-pack-challenge",
  resourceGroupName: "data",
  timeoutSeconds: 10,
  environment: {
    // PWA の通知を送るための秘密鍵(amplify/functions/shared/push.ts)
    VAPID_PRIVATE_KEY: secret("VAPID_PRIVATE_KEY"),
  },
});
