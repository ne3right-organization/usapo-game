import { defineFunction } from "@aws-amplify/backend";

// 初めてログインしたとき(Cognito の Post confirmation)にプロフィールを作る
export const createGameProfile = defineFunction({
  name: "create-game-profile",
  resourceGroupName: "auth",
});
