import { defineBackend } from "@aws-amplify/backend";
import { CfnUserPoolDomain } from "aws-cdk-lib/aws-cognito";
import { auth, branch } from "./auth/resource";
import { data } from "./data/resource";
import { claimZukanQuizAnswer } from "./functions/claim-zukan-quiz-answer/resource";
import { createGameProfile } from "./functions/create-game-profile/resource";
import { setNickname } from "./functions/set-nickname/resource";
import { submitMapPackChallenge } from "./functions/submit-map-pack-challenge/resource";
import { submitMapPuzzleChallenge } from "./functions/submit-map-puzzle-challenge/resource";
import { startZukanQuiz } from "./functions/start-zukan-quiz/resource";
import { zukanComment } from "./functions/zukan-comment/resource";

const backend = defineBackend({
  auth,
  data,
  createGameProfile,
  setNickname,
  submitMapPuzzleChallenge,
  submitMapPackChallenge,
  startZukanQuiz,
  claimZukanQuizAnswer,
  zukanComment,
});

// 回答されなかった図鑑クイズの出題は、期限(expiresAt)が過ぎたら DynamoDB が消す
backend.data.resources.cfnResources.amplifyDynamoDbTables["GameZukanQuizSession"].timeToLiveAttribute = {
  attributeName: "expiresAt",
  enabled: true,
};

// メール・パスワードでの自己登録を止める(Google でのログインはこの設定の影響を受けない)
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Cognito のドメインは Gen2 だと自動生成の名前になるので、決まった名前に上書きする。
// Google の承認済みリダイレクトURIに https://usapo-game-<ブランチ>.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse を登録している
for (const c of backend.auth.resources.userPool.node.findAll()) {
  if (c instanceof CfnUserPoolDomain) c.domain = `usapo-game-${branch}`;
}
