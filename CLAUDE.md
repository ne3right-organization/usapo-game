# このプロジェクトについて

usapo.net本体の「ゲームコーナー」機能を、本体のAWS Amplify構成から切り離して独立させたプロジェクト。うさぽの境界データ（geojson）を使った地図ゲーム（地図パズル・地図ポットン・市区町村図鑑クイズ）。

小規模なボランティアプロジェクトとして開発する。

## リポジトリ

- `git@github.com:ne3right-organization/usapo-game.git`
- 公開リポジトリ。認証情報や内部運用の詳細（利用者数、移行対象データの具体的な扱い、AWSのアカウント番号など）はこのファイルおよびリポジトリには書かない方針
- ブランチ: `develop`（開発。push で dev 環境に自動デプロイ）→ `main`（本番。push で本番に自動デプロイ）。作業は `develop` にコミットし、リリースは `develop` を `main` に早送りマージする

## 経緯

- 本体は AWS Amplify Gen2（Cognito・AppSync/DynamoDB）で構築されている。ゲームコーナーは本体と密結合させる必要がなく、リリースサイクル・障害の影響範囲を分けたいので別にした
- 2026-07〜10 は Vercel（ホスティング）+ Supabase（認証・DB）で運用していた（Vercel は学習目的での採用。どちらも 2026-10-28 に削除済み）。運用を AWS にまとめるため、**2026-10-27 に Amplify Gen2 へ移行した**（本番は `game.usapo.net`）
  - 移行の設計とアクセスパターンの洗い出しは `docs/amplify_data_migration.md`
  - 本体とは別の AWS アカウント（Organization のメンバーアカウント）に置いている。影響範囲と IAM 権限を本体と分けるため（タグでは費用を見分けられても影響範囲は分けられない）
  - Supabase 時代のスキーマ（`supabase/migrations`）は git 履歴にある

## アーキテクチャ

| レイヤ | 選定 | 備考 |
|---|---|---|
| ホスティング | Amplify Hosting（Next.js 16 の SSR） | `amplify.yml`。Next.js 16 と `proxy.ts` 無しの構成で動作確認済み |
| 認証 | Cognito（Google ログインのみ） | `amplify/auth/resource.ts`。ブラウザ側の `signInWithRedirect` |
| データ | Amplify Data（AppSync + DynamoDB） | `amplify/data/resource.ts`。信用が要る書き込みは Lambda のカスタムミューテーション |
| geojson・トリビア配信 | S3 + CloudFront（本体側のインフラ） | `NEXT_PUBLIC_CLOUDFRONT_URL`。全環境 prd の CloudFront を使う |
| 国勢調査統計 | `stat.usapo.net` | 図鑑クイズの人口・世帯数 |

費用は小規模なのでほぼ無料枠内。Cognito は Google（標準のソーシャルログイン）なので MAU 1万の枠に入る（本体の LINE ログインは OIDC 扱いで 50 MAU の別枠なので混同しないこと）。無料枠は Organization 全体で1つ分。

## システム構成（参照情報）

キー・シークレットの類はここには書かない（`.env.local` は gitignore 済み）。「どこで何が設定されているか」の参照のみ記録する。

### Amplify

| 環境 | ブランチ | アプリID | ドメイン | AWSアカウント |
|---|---|---|---|---|
| dev | `develop` | `d2x3bvza761vf5` | `https://devgame.usapo.net` | 本体の dev と同居 |
| 本番 | `main` | `d312w90schmrzl` | `https://game.usapo.net` | ゲーム専用のメンバーアカウント |

- 環境変数は `NEXT_PUBLIC_CLOUDFRONT_URL` のみ（ビルド時に埋め込まれるので、変えたら再ビルド）
- シークレット: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（Cognito 用の Google OAuth クライアント）
- サービスロールに `AmplifyBackendDeployFullAccess` が要る（無いとバックエンドのデプロイが失敗する）
- **Gen2 ではバックエンド（ユーザープール・テーブル・Lambda）がブランチごとに別**。ブランチを変えるとデータもユーザーも引き継がれない。テーブル名は `<モデル名>-<AppSyncのAPI ID>-NONE`
- バックエンドの全リソースに `project=usapo-game` タグ（`amplify/backend.ts`。Cost Explorer で使うには Payer でコスト配分タグとして有効化する）

### Cognito / Google ログイン

- ログインは Google のみ。Gen2 の `defineAuth` は email の指定が必須なので入れているが、メール・パスワードの自己登録は止めている（`allowAdminCreateUserOnly`）
- Cognito のドメインは `usapo-game-<ブランチ名>`（Gen2 は自動生成の名前になるので `backend.ts` で上書きしている）
- **ドメインは managed login（バージョン2）**（2026-10-28〜。`backend.ts` で設定し、Cognito 標準のデザイン設定 `CfnManagedLoginBranding` を付けている）。ログインのたびに Google のアカウントを選ばせる `prompt: "SELECT_ACCOUNT"`（`src/lib/auth.ts`）は classic の hosted UI では使えないため。複数の Google アカウントを持っていても切り替えられる。managed login はユーザープールのプランが Essentials 以上で使える
- Google OAuth クライアント（Cognito 用、ウェブアプリケーション）の承認済みリダイレクトURIに、各ブランチの `https://usapo-game-<ブランチ>.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse` を登録している
- Cognito の戻り先（ログイン後 `/login`、ログアウト後 `/`）は `amplify/auth/resource.ts` の `CUSTOM_DOMAINS`（ブランチ→独自ドメイン）・`*.amplifyapp.com`・`localhost:3000`。**独自ドメインを足したら `CUSTOM_DOMAINS` にも足す**（足さないと「redirect is coming from a different origin」で失敗する）
- 初めてログインしたときに Post confirmation トリガー（`create-game-profile`）がプロフィール（ニックネーム空）を作る。各 Lambda も `ensureProfile` で保険をかけている
- ユーザーIDは Cognito の `sub`

### CloudFront / S3（geojson配信）

- 本体側のインフラ用リポジトリ（`team-kokuusa-platform-infra`、CloudFormation）で管理。usapo-game は全環境 prd の CloudFront（`dbr7d89af0fox.cloudfront.net`）を使う
- CORS 許可ドメインは同リポジトリ `infra-s3-stack.yaml` の `FrontendDomains`。`game.usapo.net` / `devgame.usapo.net` を許可済み（`*.amplifyapp.com` のドメインは許可していないので、amplifyapp.com の URL では地図が出ない）
- `usapo.net` の DNS は Route 53（ゲーム用アカウントには無いので、レコードは手で足す）

## 開発の注意点

### データ層の作り

- 画面からは `src/lib/game/*Data.ts`・`zukanQuizClient.ts`・`followData.ts`・`completionData.ts`・`recentClears.ts` の関数を呼ぶだけ。中身は Amplify Data のクライアント（`src/lib/amplify/data.ts`）
- **「クライアントの自己申告を信用しない」書き込みは Lambda のカスタムミューテーション**（`amplify/functions/`）。得点計算・ベスト記録・合計・図鑑登録・フォロー可否の確認など。モデル自体はクライアントから読み取り専用にしている
- 得点の式はクライアント（`MapPuzzleGame.tsx` / `MapPackGame.tsx`）と Lambda（`submit-map-puzzle-challenge` / `submit-map-pack-challenge`）の両方にある。変えるときは両方そろえる
- 未ログインでも使う API（図鑑クイズの出題・回答、最近のクリア）は Identity Pool のゲスト（`guestOrUserAuthMode()`）で呼ぶ
- ランキング・履歴のページ送りの cursor は Amplify Data の `nextToken`
- ランキングにはログインして遊んだ人を全員出し、ニックネームが無ければ「未設定」と表示する。他人のプロフィール・フォローはニックネームを設定した人だけ（認可で読めなくするところまではしていない）

### バックエンドを変えたら

- **push する前に手元で組み立てを確かめる**（Amplify のビルドログには本当のエラーが出ず、「`$amplify/env/…` が見つからない」型エラーだけになることがある）:
  ```
  CDK_OUTDIR=<一時フォルダ> CDK_CONTEXT_JSON='{"amplify-backend-namespace":"local","amplify-backend-name":"synthcheck","amplify-backend-type":"sandbox"}' AWS_REGION=ap-northeast-1 npx tsx amplify/backend.ts
  ```
  `data/<関数名>-lambda` が全部 Bundling されれば OK。型チェックは `npx tsc --noEmit -p amplify/tsconfig.json`（`$amplify/env/…` のエラーはデプロイ時に生成される型なので手元では出て当然）
- つまずいた点:
  - enum（`a.ref("GameDifficulty")`）は主キー（identifier）に使えない → 文字列の項目を別に持つ（`GameMapPackUserTotal.level`）
  - モデルには認可ルールが1つ必要。クライアントから触らせないモデルは `allow.group("admin")`（誰も入っていないグループ）にしている
  - Gen2 の Lambda の event には `info`（`fieldName`）が来ない
  - `a.json()` の値は AppSync で二重に文字列化されて返ることがある → 文字列である限り `JSON.parse` し続ける
  - `npm ci` は `@aws-amplify/data-construct` が同梱する semver とロックファイルが合わず失敗する → `amplify.yml` は `npm install`
  - `createAuthRouteHandlers`（サーバー側ログイン）はトークンが httpOnly の Cookie に強制され、ブラウザから Amplify API を呼べなくなるので使っていない

### 独自ドメイン（Amplify）

- Amplify の「カスタムドメイン」で手動設定（DNS が別アカウントの Route 53 のため）。証明書の確認用 CNAME は先に足して問題ない
- **CAA に注意**: CNAME で別サービス（例: Vercel）に向いている名前は、CNAME 先の CAA が使われて Amazon の証明書が出せない。CNAME のある名前には CAA を置けないので、A レコードにして CAA（`amazontrust.com` を含む）を置くか、Amplify 向けの CNAME に切り替えてから発行する
- **ドメインを追加し直すたびにサブドメインの CNAME の値（`xxxx.cloudfront.net`）が変わる**。Route 53 の値は Amplify の画面の最新の値に合わせる（2026-10-27 のリリースでこれに引っかかった）

## 既存データの移行（2026-10-27 完了）

Supabase のデータを本番の Amplify に移した。Supabase のユーザーごとに Cognito のユーザーを先に作って Google を紐づけ（`AdminLinkProviderForUser`）、記録をその `sub` に付け替えて DynamoDB に入れた（AWS CloudShell で実行）。スクリプトと具体的な手順・対象者の情報はリポジトリの外（`.local/`、gitignore 済み）で管理する。

## 次にやること（後片付け）

- [x] Vercel・Supabase のプロジェクトを削除（2026-10-28）。リリース後に旧サイトで記録された1件（新規の利用者）は移さなかった
- [ ] 本番アカウントの権限セットから移行用に足した Cognito の権限を外す
- [ ] Supabase 用だった Google OAuth クライアントを削除
- [ ] インフラ用リポジトリの `FrontendDomains` に、実際には許可している `devgame.usapo.net` を書き足す（ファイルと実際の設定がずれている）

## 市区町村図鑑クイズ（2026-07-24 実装、MVP範囲）

設計書: `docs/市区町村図鑑クイズ_設計ドキュメント.md`（ただし「7. データモデル」はDynamoDB想定のたたき台で、実装とは違う。今のモデルは `amplify/data/resource.ts`）。`/game/zukan-quiz` 配下。4択クイズ・1セッション5問・正解した市区町村を図鑑に登録する。

- **データソース**: ポリゴンは CloudFront 配信の geojson（`/geojson/municipality/2020/{prefCode}.geojson`）。人口・世帯数は `stat.usapo.net`（国勢調査統計API、`GET /statistics/census/2020/population/{prefCode}/{cityCode}.json`、`areas[]` の `hyosyo===1` が市区計）
  - stat.usapo.net に面積データが無いため、人口密度などのヒントはスコープ外
- **正答を隠す設計**: 出題は Lambda `start-zukan-quiz` が行い、正答は `GameZukanQuizSession`（クライアントからは触れない。30分の TTL）に保存する。クライアントへ返すシルエットはプロパティを剥がした座標のみ。回答は Lambda `claim-zukan-quiz-answer` が出題を消して（＝1回きり）判定し、正答率（`GameZukanMunicipalityStat`）を数え、ログイン中に正解なら図鑑（`GameZukanCollection`）に登録する
  - 出題の組み立ては `src/lib/game/zukanQuizGenerator.ts`。Next.js（図鑑クイズのトップ、`server-only` の `zukanQuizData.ts` 経由）と Lambda の両方から使う。外部データは Next.js では Data Cache、Lambda では同じコンテナの中のメモリにキャッシュする（geojson・統計は1週間、トリビアは5分。404 も「データが無い」として持つ）
  - Supabase 時代は Route Handler `/api/zukan-quiz` とRPC `claim_zukan_quiz_answer` だった
- **ダミー選択肢の基準**: 同一都道府県内から人口が対象の概ね1/3〜3倍の自治体を優先し、3件に満たなければ1/10〜10倍→無制限と広げ、それでも足りなければ別の都道府県から補充する（地理的近さは「同一都道府県」で代用）

### トリビアヒント・正答率（2026-07-26 追加）

「シルエットだけだと絶対無理」というフィードバックで、正答前のヒントにトリビアを出すようにした。

- **出題対象はトリビア登録済みの自治体に限定**（ユーザー確認済み）。トリビアは本体側（team-kokuusa-platform-frontend）の管理画面で編集し、CloudFront の `/municipality-trivia/{prefCode}.json` で配信される（2026-07-27〜。設計は本体側の `docs/municipality-trivia-management-design.md`）。47都道府県分を並行 fetch し、未公開の都道府県は 404 になるだけ
- トリビア項目は8種類: `industry` / `specialty` / `historicalEvent` / `touristSpot` / `notablePerson` / `festival` / `natureFeature` / `localCuisine`。出典URLは無い
- セッション内で同じ自治体を再出題しないよう、クライアントが出題済みの `"prefCode:cityCode"` を毎回送る
- 見せるヒントは難易度別の件数だけランダムに選ぶ（出題時にサーバー側で選ぶ）。人口・世帯数は出題時から見せる
- 正答率はログイン有無を問わず全回答を数える

### 難易度3段階・カードグリッド・トリビア提案（2026-07-28〜29 追加）

- **難易度**（`beginner`/`intermediate`/`advanced`、表示は かんたん/ふつう/むずかしい）: ①ヒント件数（5/3/0件）②ダミー選択肢の人口の近さ（`POPULATION_BAND_RATIOS_BY_DIFFICULTY`）。難易度と実際に見せたヒント項目は出題時にサーバー側で保存し、回答の判定でそこから読む（自己申告で高難易度を詐称できないように）
- 図鑑カードは自治体1枚＋**最高難易度クリアのラベル**（`bestDifficulty`）。カード詳細には直近に正解したときのヒント（`hintFields`、上書き）を出す
- 図鑑はシルエット付きのカードグリッド（`ZukanCardGrid`）、詳細は `ZukanCardDetail`。他の人の図鑑は `/game/zukan-quiz/profile/[userId]`
- **カードの「コメント」は実質「ヒントの提案」**（UI文言も「ヒントの提案」）。採用は自動ではなく、本体側のトリビア管理画面での人力キュレーション前提。そのカードを持っている人だけ投稿でき（Lambda `zukan-comment` で確認）、1ユーザー1カード1件。モデレーション機能は未実装
- 都道府県別コンプリート率表示は、47都道府県ぶんの geojson を毎回読んで遅かったので廃止した（2026-07-29）

### シルエットに陰影起伏図（2026-08-01）

クイズ本体のシルエットの内側だけに国土地理院の陰影起伏図（hillshademap）を重ねている（`src/lib/game/hillshadeRaster.ts`、`MunicipalitySilhouette` の `showTerrain`）。図鑑のカード一覧・詳細には付けていない。

- 輪郭の外は見せない（周辺の地形まで見せると位置が割れてしまうため）
- ズームレベルは目標ピクセルサイズから log2 で逆算する（高ズームから探すと常に最大ズームになりタイルが爆発した）
- GSI タイルは CORS 対応（`Origin` ヘッダを送ったときだけ `Access-Control-Allow-Origin` が付く）。取得に失敗したら単色のシルエットに戻す
- 出典表示「地形: 国土地理院」を出している

### むずかしいの難易度設計（2026-08-01〜02）

- ヒントなし。トリビア登録の有無を問わず全自治体から出題する。都道府県を1つランダムに選び、その中の全自治体を候補にする
  - **47都道府県分の geojson をまとめて取る実装は、2MB 超の geojson がキャッシュに乗らず負荷が高すぎてクラッシュした**。この規模で「全都道府県ぶんまとめて fetch」を書きたくなったら、1都道府県ずつ遅延取得できないか先に考えること
- ダミー選択肢を全国から選ぶ方式は、「他の3件と毛色が違う1件が正答」と一目で分かる問題があり撤回した。他の難易度と同じ「同一都道府県優先」

## サイト共通の機能（2026-10-20〜）

- **サイト共通ヘッダー**（`src/components/SiteHeader.tsx`）
- **遊んだ履歴**（`/history`、`?game=map-puzzle|map-pack|zukan-quiz`）。図鑑クイズは1問ごとの履歴を残していないので図鑑登録を出す
- **ニックネーム設定**（`/nickname`）: 全ゲーム共通。Lambda `set-nickname` がベスト記録・合計のニックネームも書き直す
- **エリアを指定してプレイ画面に直接飛ぶURL**（`src/lib/game/playLinks.ts`）: `/game/{map-puzzle|map-pack}/{difficulty}?prefCode=&prefName=&cityCode=&cityName=`
- **最近クリアされたエリア**（各ゲームのトップ）: `GameRecentClear`（3ゲーム共通、誰がクリアしたかは持たない、未ログインでも読める）。記録を送る Lambda が更新する
- **コンプリート状況**（`/profile`・`/profile/[userId]`、`src/components/profile/`・`src/lib/game/completionData.ts`）: ゲーム×レベルごとにクリアしたエリアを地図で塗る。市区町村は**全国ぶんの geojson を一度に読まない**（全国の地図では都道府県ごとのクリア数を濃淡で出し、県を選ぶとその県だけ読む）。地図ポットンは `firstClearedAt` で完成済みかを見る。図鑑クイズは上の難易度で登録したものを下の難易度でもクリア扱い
- **フォロー**（`GameFollow`）: フォロー関係はフォローした本人とされた本人にしか見えない（2つの所有者ルール）。フォローは Lambda `set-following` が「お互いにニックネーム設定済み」を確認してから行う。クリア時の通知は見送った
- **PWA**: `src/app/manifest.ts`・アイコン・`public/sw.js`。サービスワーカーは**オフライン時に `/offline` を出すだけで、ほかは一切キャッシュしない**（ランキング・記録・ログイン状態が古いまま見えないように）。登録は本番ビルドのみ
- **Xシェア**（`src/lib/game/share.ts`）

## 地図ポットン（旧称: 地図パック。2026-10-19〜）

表示名は「地図ポットン」、レベル名は 都道府県ポットン（初級）/ 自治体ポットン（中級）/ ご近所ポットン（上級）。URL（`/game/map-pack`）・モデル名（`GameMapPack*`）・コード上の名前（`mapPack`）は「地図パック」時代のまま。

地域のピースを箱に落とし、隣接するピース同士が触れると実際の位置関係のまま固まる、スイカゲーム型の落下パズル。全ピースが1つに固まったら完成。「新・都道府県ゲーム」（https://sns.dopagamelab.com/pref-pack/）に着想を得た（ゲーム本体のコードにはライセンス表記がないため**コードは流用せず仕組みだけ参考にした**。Matter.js / poly-decomp は MIT なので使用）。画面に着想元のクレジットを入れている。

- 設計メモ: `docs/map_pack_game_design.md`
- 画面: `/game/map-pack`、`/game/map-pack/[difficulty]`（エリア選択は地図パズルの `MapAreaSelector` を流用）、`/game/map-pack/ranking`、`/game/map-pack/ranking/area`
- 実装: `src/lib/game/mapPack/{regions,shapes}.ts`、`src/components/game/map-pack/MapPackGame.tsx`、`src/lib/game/mapPackData.ts`
- 参考ゲームとの違い: あふれても終了しない、箱を揺らすボタンは無し（代わりにピースが時々ポンと跳ねる・「積み直す」ボタン）、町丁など3レベルで遊べる
- 中断・再開は地図パズルと同じ2段構え（同じタブの sessionStorage への自動保存＋「中断」ボタンでサーバーの `GameMapPackProgress` に保存）。状態はクライアントが作る JSON をそのまま保存する（大きい町丁でも数十KBで、DynamoDB の 400KB に収まる）
- **ランキングは地図パズルとは別集計**。難易度別ランキングは1人1行（`GameMapPackUserTotal`、記録のたびに Lambda が合計を書き直す）。あきらめた挑戦も記録する
- **既知の課題**: ピース数が多いエリアは合体が起きにくく、クリアがかなり難しい（設計メモ参照）

## 地図タネ（2026-10-28〜、初期試作）

現実の地区（町丁）にタネ（拠点）をまき、ほかの人のタネを現地で訪ねてお裾分け（アイテム）を集める位置情報ゲーム。集めたものはタネニワ（箱庭、おまけ）に飾れる。**メインは訪ねること**。

- 設計書: `docs/地図タネ_全体設計書.md`（ルール・決定事項・コースの表）、`docs/地図タネ_初期試作設計書.md`（いま作っている範囲）。検討のときは「箱庭コレクションゲーム」「地図コロ」と呼んでいた（名前の経緯は全体設計書の0章）
- 画面での呼び名: 拠点＝タネ（種類ごとに果樹園・サイクルポート…）、箱庭＝タネニワ、町丁＝実際の地名と「地区」。**画面で「町丁」とは言わない**
- 画面: `/game/chizu-tane`（トップ。タネニワの絵・コース選び）、`/here`（おでかけ＝いまいる地区）、`/collection`、`/garden`。ログイン必須
- 実装: `src/lib/game/chizuTane/`（コースの表 `courses.ts`・地区の判定 `geo.ts`・箱庭の検証 `garden.ts`。画面と Lambda の両方から使う）、`src/lib/game/chizuTaneData.ts`、`src/components/game/chizu-tane/`
- バックエンド: モデル `GameTane*`（クライアントは読むだけ）、Lambda `chizu-tane-player` / `chizu-tane-place` / `chizu-tane-checkin` / `chizu-tane-seeds`（共通処理は `amplify/functions/shared/chizuTane.ts`）
- **タネは持ち物**（`GameTaneHeldSeed`、もの単位: みかんの木のタネ…）で、まくと1つ減り、そのものの種類の拠点ができる。拠点の種類は1レベルに1つで、それぞれタネが3つ（色違いでもよい）。増え方（始めたとき・レベルアップ・初めて訪ねたタネ・自分のタネに人が来る/自分で訪ねる/3日たつ）は全体設計書 6.4、数は `courses.ts`
- **地区の判定**: 位置 → 市区町村ごとの範囲の一覧（`public/chizu-tane/municipality-bounds.json`、作り方は `scripts/chizu-tane/build-municipality-bounds.mjs`）で候補を絞る → その市区町村の町丁 geojson だけを読む。都道府県・市区町村の geojson は重い（3.7MB / 北海道 7MB 超）ので毎回は読まない。Lambda はブラウザが言う地区を信用せず、位置から判定し直す。町丁のキーは `KEY_CODE`、町丁 geojson の市区町村コードは3桁
- 位置はプレイヤーの実際の緯度・経度を保存せず、地区の代表点（`X_CODE` / `Y_CODE`）だけを持つ（移動の速さの確認用）
- **開発用の位置指定**: devgame.usapo.net と localhost だけ、地図をタップした点にいることにできる（代表点に寄せない。`CompletionMap` の `onPointSelect`）。dev の Lambda は速さを確かめない（`resource.ts` で `AWS_BRANCH` を見て切り替え）
- 絵は未作成で、アイテムごとの絵文字を出している。絵ができたら `courses.ts` のアイテムに `imageUrl` を足す
