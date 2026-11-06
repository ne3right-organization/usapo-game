import { defineBackend } from "@aws-amplify/backend";
import { Tags } from "aws-cdk-lib";
import { CfnManagedLoginBranding, CfnUserPoolDomain } from "aws-cdk-lib/aws-cognito";
import { auth, branch } from "./auth/resource";
import { data } from "./data/resource";
import { chizuTaneCheckin } from "./functions/chizu-tane-checkin/resource";
import { chizuTaneMarket } from "./functions/chizu-tane-market/resource";
import { chizuTanePlace } from "./functions/chizu-tane-place/resource";
import { chizuTanePlayer } from "./functions/chizu-tane-player/resource";
import { chizuTaneSeeds } from "./functions/chizu-tane-seeds/resource";
import { chizuTaneShelf } from "./functions/chizu-tane-shelf/resource";
import { chizuTaneStats } from "./functions/chizu-tane-stats/resource";
import { chizuTaneSweep } from "./functions/chizu-tane-sweep/resource";
import { chizuTaneAdmin } from "./functions/chizu-tane-admin/resource";
import { createGameProfile } from "./functions/create-game-profile/resource";
import { setFollowing } from "./functions/set-following/resource";
import { setNickname } from "./functions/set-nickname/resource";
import { submitMapPackChallenge } from "./functions/submit-map-pack-challenge/resource";
import { submitMapPuzzleChallenge } from "./functions/submit-map-puzzle-challenge/resource";

const backend = defineBackend({
  auth,
  data,
  createGameProfile,
  setNickname,
  submitMapPuzzleChallenge,
  submitMapPackChallenge,
  setFollowing,
  chizuTanePlayer,
  chizuTanePlace,
  chizuTaneCheckin,
  chizuTaneMarket,
  chizuTaneSeeds,
  chizuTaneShelf,
  chizuTaneStats,
  chizuTaneSweep,
  chizuTaneAdmin,
});

// 地図タネの落ちているタネ・実は早い者勝ちなので、拾う・落とす・実をもらう Lambda は拠点のテーブルを DynamoDB で直接(条件付きで)書き換える
// (Amplify Data のクライアントでは条件付きの書き込みができないため。amplify/functions/shared/chizuTane.ts)
const taneBaseTable = backend.data.resources.tables["GameTaneBase"];
const taneHeldSeedTable = backend.data.resources.tables["GameTaneHeldSeed"];
const taneItemTable = backend.data.resources.tables["GameTaneItem"];
const taneHarvestTable = backend.data.resources.tables["GameTaneHarvest"];
const taneLocalFruitTable = backend.data.resources.tables["GameTaneLocalFruit"];
// 市場の交換(実を条件付きで減らし、タネを足す)も同じテーブルを使う
for (const fn of [backend.chizuTaneSeeds, backend.chizuTaneCheckin, backend.chizuTaneMarket]) {
  taneBaseTable.grantReadWriteData(fn.resources.lambda);
  taneHeldSeedTable.grantReadWriteData(fn.resources.lambda);
  taneItemTable.grantReadWriteData(fn.resources.lambda);
  taneHarvestTable.grantReadWriteData(fn.resources.lambda);
  taneLocalFruitTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment("CHIZU_TANE_BASE_TABLE", taneBaseTable.tableName);
  fn.addEnvironment("CHIZU_TANE_HELD_SEED_TABLE", taneHeldSeedTable.tableName);
  fn.addEnvironment("CHIZU_TANE_ITEM_TABLE", taneItemTable.tableName);
  fn.addEnvironment("CHIZU_TANE_HARVEST_TABLE", taneHarvestTable.tableName);
  fn.addEnvironment("CHIZU_TANE_LOCAL_FRUIT_TABLE", taneLocalFruitTable.tableName);
}

// タネをまく・まき直すのも「空き地か、空き地に戻った畑のときだけ」「タネ待ちのときだけ」の条件付きで拠点のテーブルに書く
taneBaseTable.grantReadWriteData(backend.chizuTanePlace.resources.lambda);
backend.chizuTanePlace.addEnvironment("CHIZU_TANE_BASE_TABLE", taneBaseTable.tableName);

// 畑の終わり方の定期実行も、期限を過ぎた畑の行を「読んだときのままなら」の条件で消し、知らせた印を書く(amplify/functions/chizu-tane-sweep)
taneBaseTable.grantReadWriteData(backend.chizuTaneSweep.resources.lambda);
backend.chizuTaneSweep.addEnvironment("CHIZU_TANE_BASE_TABLE", taneBaseTable.tableName);

// 市場のご当地の実(撤去したご当地の畑の残りの実)は早い者勝ちなので、条件付きで書き換える。
// 定期実行は撤去した畑の残りの実を並べ、市場は生産者どうしで取り替える(amplify/functions/shared/chizuTane.ts)
const taneMarketLocalTable = backend.data.resources.tables["GameTaneMarketLocal"];
for (const fn of [backend.chizuTaneMarket, backend.chizuTaneSweep]) {
  taneMarketLocalTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment("CHIZU_TANE_MARKET_LOCAL_TABLE", taneMarketLocalTable.tableName);
}

// 公式の畑の育ちと落ちているタネも、二重に押されても1回分だけ進むよう条件付きで書き換える(amplify/functions/chizu-tane-checkin/handler.ts)
const taneOfficialVisitTable = backend.data.resources.tables["GameTaneOfficialVisit"];
taneOfficialVisitTable.grantReadWriteData(backend.chizuTaneCheckin.resources.lambda);
backend.chizuTaneCheckin.addEnvironment("CHIZU_TANE_OFFICIAL_VISIT_TABLE", taneOfficialVisitTable.tableName);
// 本物の畑の訪問と手伝いの水やりも、「1つの時間帯に1回」の印を条件付きで書く(2台で同時にチェックインしても1回分だけ進む)
const taneVisitTable = backend.data.resources.tables["GameTaneVisit"];
const taneHelpTable = backend.data.resources.tables["GameTaneHelp"];
taneVisitTable.grantReadWriteData(backend.chizuTaneCheckin.resources.lambda);
taneHelpTable.grantReadWriteData(backend.chizuTaneCheckin.resources.lambda);
backend.chizuTaneCheckin.addEnvironment("CHIZU_TANE_VISIT_TABLE", taneVisitTable.tableName);
backend.chizuTaneCheckin.addEnvironment("CHIZU_TANE_HELP_TABLE", taneHelpTable.tableName);

// 毎日のガチャも、2台で同時に押しても1回分だけ引けるよう、プレイヤーの行に引いた印を条件付きで書く(amplify/functions/chizu-tane-seeds/handler.ts)
const tanePlayerTable = backend.data.resources.tables["GameTanePlayer"];
tanePlayerTable.grantReadWriteData(backend.chizuTaneSeeds.resources.lambda);
backend.chizuTaneSeeds.addEnvironment("CHIZU_TANE_PLAYER_TABLE", tanePlayerTable.tableName);

// おすそ分けの棚の数も早い者勝ちなので、棚のテーブルを条件付きで書き換える(amplify/functions/chizu-tane-shelf/handler.ts)
const taneShelfTable = backend.data.resources.tables["GameTaneShelf"];
taneShelfTable.grantReadWriteData(backend.chizuTaneShelf.resources.lambda);
backend.chizuTaneShelf.addEnvironment("CHIZU_TANE_SHELF_TABLE", taneShelfTable.tableName);

// 届いた通知は最新の1日分だけ残す。期限(expiresAt)が過ぎたら DynamoDB が消す
backend.data.resources.cfnResources.amplifyDynamoDbTables["GameNotification"].timeToLiveAttribute = {
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
