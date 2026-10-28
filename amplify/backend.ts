import { defineBackend } from "@aws-amplify/backend";
import { Tags } from "aws-cdk-lib";
import { CfnManagedLoginBranding, CfnUserPoolDomain } from "aws-cdk-lib/aws-cognito";
import { auth, branch } from "./auth/resource";
import { data } from "./data/resource";
import { chizuTaneCheckin } from "./functions/chizu-tane-checkin/resource";
import { chizuTanePlace } from "./functions/chizu-tane-place/resource";
import { chizuTanePlayer } from "./functions/chizu-tane-player/resource";
import { claimZukanQuizAnswer } from "./functions/claim-zukan-quiz-answer/resource";
import { createGameProfile } from "./functions/create-game-profile/resource";
import { setFollowing } from "./functions/set-following/resource";
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
  setFollowing,
  chizuTanePlayer,
  chizuTanePlace,
  chizuTaneCheckin,
});

// 回答されなかった図鑑クイズの出題は、期限(expiresAt)が過ぎたら DynamoDB が消す
backend.data.resources.cfnResources.amplifyDynamoDbTables["GameZukanQuizSession"].timeToLiveAttribute = {
  attributeName: "expiresAt",
  enabled: true,
};

// 費用を Cost Explorer で見分けられるよう、バックエンドの全リソースに付ける
// (使うには Payer の請求コンソールでコスト配分タグとして有効にする)
Tags.of(backend.stack).add("project", "usapo-game");

// メール・パスワードでの自己登録を止める(Google でのログインはこの設定の影響を受けない)
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Cognito のドメインは Gen2 だと自動生成の名前になるので、決まった名前に上書きする。
// Google の承認済みリダイレクトURIに https://usapo-game-<ブランチ>.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse を登録している
//
// ドメインは managed login(バージョン2)にする。classic の hosted UI では prompt パラメータが使えず、
// ログインのたびに Google のアカウントを選ばせる(src/lib/auth.ts の prompt: "SELECT_ACCOUNT")ことができないため。
// managed login にはアプリクライアントごとのデザイン設定が要るので、Cognito 標準のものを付ける
// (ログインは Google の画面に直接飛ぶので、Cognito の画面はほとんど出ない)
for (const c of backend.auth.resources.userPool.node.findAll()) {
  if (c instanceof CfnUserPoolDomain) {
    c.domain = `usapo-game-${branch}`;
    c.managedLoginVersion = 2;
  }
}
new CfnManagedLoginBranding(backend.auth.resources.userPool, "ManagedLoginBranding", {
  userPoolId: backend.auth.resources.userPool.userPoolId,
  clientId: backend.auth.resources.userPoolClient.userPoolClientId,
  useCognitoProvidedValues: true,
});
