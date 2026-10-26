import { defineBackend } from "@aws-amplify/backend";
import { CfnUserPoolDomain } from "aws-cdk-lib/aws-cognito";
import { auth, branch } from "./auth/resource";

const backend = defineBackend({ auth });

// メール・パスワードでの自己登録を止める(Google でのログインはこの設定の影響を受けない)
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Cognito のドメインは Gen2 だと自動生成の名前になるので、決まった名前に上書きする。
// Google の承認済みリダイレクトURIに https://usapo-game-<ブランチ>.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse を登録している
for (const c of backend.auth.resources.userPool.node.findAll()) {
  if (c instanceof CfnUserPoolDomain) c.domain = `usapo-game-${branch}`;
}
