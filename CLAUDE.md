# このプロジェクトについて

usapo.net本体の「ゲームコーナー」機能を、本体のAWS Amplify構成から切り離して独立させるプロジェクト。うさぽの境界データ（geojson）を使った地図ゲーム。

小規模なボランティアプロジェクトとして開発する。

## リポジトリ

- `git@github.com:ne3right-organization/usapo-game.git`
- 公開リポジトリ。認証情報や内部運用の詳細（利用者数、移行対象データの具体的な扱いなど）はこのファイルおよびリポジトリには書かない方針

## 分離の経緯・理由

- 本体はAWS Amplify Gen2（Cognito認証・AppSync/DynamoDB）で構築されているが、ゲームコーナーは本体と密結合させる必要がない
- 本体のリリースサイクル・障害対応とゲームコーナーの変更を切り離すことで、互いの影響範囲を小さくしたい

## 決定したアーキテクチャ

| レイヤ | 選定 | 理由 |
|---|---|---|
| Next.jsホスティング | **Vercel** | Next.jsをそのまま活かせる。App Router/SSR/ISRの制約なし |
| 認証 + DB | **Supabase**（1プロジェクトで両方） | 無料枠でDB 500MB・Auth 50,000 MAUまで無料。小規模利用なら大幅に余裕がある |
| geojson配信 | **S3 + CloudFront**（AWSのまま） | コストはボランティア側の別プロジェクトが負担するため、このプロジェクトのコスト試算からは除外 |

商用利用が絡む場合、VercelはHobby(無料)プランが規約上非商用限定なので、必要ならProプラン（$20/月）を検討する。

### Supabase Free枠の注意点

1週間アクセスがないとプロジェクトが一時停止する。運用開始後は、Vercel CronまたはGitHub Actionsのscheduled workflowで定期的に軽いヘルスチェック（`select 1`など）を投げて一時停止を回避する。

## システム構成（各サービスの参照情報）

キー・シークレットの類はここには書かない（`.env.local`はgitignore済みなので、個人の控えとして残す場合はそちら）。「どこで何が設定されているか」の参照のみ記録する。

### Vercel
- プロジェクト: `usapo-game`（スコープ: `usapo-game`）
- 本番URL: https://usapo-game.vercel.app
- 環境変数（Production/Preview/Development の3系統）: `NEXT_PUBLIC_CLOUDFRONT_URL`（全環境prd CloudFrontに統一）/ `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- GitHub連携済み（`develop`ブランチへのpushでPreviewが自動デプロイされる）。Custom Environments（ブランチ単位の名前付き環境）はHobbyプランでは使えないため、Previewは「Production Branch以外の全ブランチ」に一律適用される仕様
- **Production反映は現状CLIの手動`vercel deploy --prod`のみ**。`main`ブランチは初期コミットのままでほぼ更新しておらず、Production Branchの実体とは同期していない点に注意（本来はgit連携でmainへのマージ＝本番反映にするのが望ましいが、今のところ手動運用）

### Supabase
- プロジェクト名: `usapo-game`、project ref: `pctmohjcdtizoyalacts`、リージョン: ap-northeast-1(東京)、Free plan
- ダッシュボード: https://supabase.com/dashboard/project/pctmohjcdtizoyalacts
- DBスキーマは`supabase/migrations/`配下で管理し`supabase db push`で反映（ローカルDockerが無い環境だったため`db reset`によるローカル検証は未実施、本番プロジェクトに直接push）
- 認証: **Google OAuthのみ**（Authentication → Providers → Google に設定済み）。Client Secretは保存後Supabase側では再表示できないため、確認・再発行が必要な場合はGoogle Cloud Console側で行う
  - 当初マジックリンク（メールリンク）を実装したが、(a) Free tier既定の共有SMTPは1時間2通という強いレート制限がある、(b) 同じくFree tier+デフォルトSMTPではメールテンプレートのカスタマイズ自体が不可、(c) リンク方式はGmail等の自動先読みや、送信時と別のブラウザ/デバイスで開いた場合に失敗する、という3点が重なり、Google OAuthのみに切り替えた
  - 独自SMTP（Resendなど）を設定すればメールログイン（マジックリンク/OTP）も選択肢に戻る。ドメイン検証が絡むので本番ドメイン（`game.usapo.net`）設定と合わせて検討するのが自然

### Google OAuth
- Google Cloud Console側にOAuthクライアント（ウェブアプリケーション）を作成済み
- 承認済みリダイレクトURI: `https://pctmohjcdtizoyalacts.supabase.co/auth/v1/callback`
- Client ID/SecretはSupabaseダッシュボード側に設定済み（上記参照）

### CloudFront / S3（geojson配信、AWS）
- dev/prd 2つのAWSアカウントとも `team-kokuusa-platform-infra` リポジトリ（`C:\Users\user\develop\taihi\team-kokuusa-platform-infra`、CloudFormation）で管理
- usapo-gameは全環境prd CloudFront（`dbr7d89af0fox.cloudfront.net`）に統一。CORS許可ドメインは同リポジトリの`infra-s3-stack.yaml`の`FrontendDomains`パラメータに追加済み（`usapo-game.vercel.app` / `game.usapo.net`(予定・未設定) / `*-usapo-game.vercel.app`(Preview用) / `dev.usapo.net`）

### GitHub
- リポジトリ: `git@github.com:ne3right-organization/usapo-game.git`（公開）
- 作業は`develop`ブランチにコミット・push。`main`は現状ほぼ初期状態（上記Vercelの注意点も参照）

## 既存データの移行方針

現行データは本体側のAppSync/DynamoDBに、Cognito認証のユーザーに紐づく形で存在する。認証基盤がSupabaseに変わるため、自動移行ではなく手動での移行を想定している。具体的な移行手順・対象者の情報は、このリポジトリの外（社内の運用ドキュメント）で管理する。

## 次にやること

- [x] Next.jsプロジェクトの雛形作成
- [x] Vercelプロジェクトの作成・連携（dev/preview/productionともprd CloudFrontに統一。dev CloudFrontは廃止方針）
- [x] geojson（S3+CloudFront）への接続方法の実装（`fetch()`で読むだけ。地図パズルとして実装済み）
- [x] **Supabaseプロジェクトの作成**（プロジェクト名`usapo-game`、リージョン ap-northeast-1(東京)、Free plan、project ref `pctmohjcdtizoyalacts`）
  - `supabase db push`でマイグレーション適用済み: `game_profiles` / `game_map_puzzle_challenges` / `game_map_puzzle_progress` / `game_map_puzzle_best` の4テーブル + RLS + 集計トリガー
  - **重要**: Supabaseダッシュボードの「Automatically expose new tables」をOFFにしていても、SQLマイグレーション経由で作ったテーブルには`anon`ロールにデフォルト権限が付与される挙動を確認した（ダッシュボードのトグルはStudio UI経由の作成にしか効かない模様）。`20260722000000_revoke_anon_grants.sql`で明示的に`revoke all ... from anon`して対処済み。**今後新しいテーブルを追加する際も、この挙動を前提に毎回明示的なGRANT/REVOKEをマイグレーションに書くこと**（トグル設定を信用しない）
  - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（Publishable key）をVercel(Production/Preview/Development)と`.env.local`に設定済み
  - Dockerが動いていなかったため、ローカル`supabase db reset`での事前検証はできておらず本番プロジェクトに直接`db push`した。マイグレーションSQL自体は目視レビュー済み、pushも成功・grant/RLSの実機確認も完了
  - ログイン方式はGoogle OAuthのみ（詳細は「システム構成」参照。当初マジックリンクを実装したがFree tierの制約により切り替えた）
- [x] プレイ履歴・プロフィール・ランキング機能のデータ層・認証・チャレンジ送信を実装（元実装 team-kokuusa-platform-frontend の Cognito+AppSync 版を Supabase に置き換えて移植）:
  - `src/lib/game/mapPuzzleData.ts`: データアクセス層（履歴送信・進行保存・プロフィール・ランキング）。supabase-js直叩き、RLSでアクセス制御
  - `src/app/login/page.tsx` + `src/app/auth/callback/route.ts`: Google OAuthログイン（リダイレクトの実機確認済み。実際のGoogleアカウントでの完走はユーザー側で確認予定）
  - `src/app/game/map-puzzle/nickname/page.tsx`: ニックネーム編集
  - `MapPuzzleGame.tsx`にチャレンジ送信(`submitChallenge`)・途中保存(`saveProgress`)を再接続、`[difficulty]/page.tsx`にサーバー側途中保存の再開フローを再接続（未ログインでもエラーを握りつぶしてゲストplayできるようフォールバック済み。実機確認済み）
- [x] 履歴・プロフィール・ランキング画面を実装:
  - `/game/map-puzzle/history`（プレイ履歴一覧、カーソルページネーション）
  - `/game/map-puzzle/profile`, `/game/map-puzzle/profile/[userId]`（共通コンポーネント`GameProfileView`。他人のプロフィールはnickname未登録だと非公開）
  - `/game/map-puzzle/ranking`, `/game/map-puzzle/ranking/area`（共通コンポーネント`RankingList`。モード内・エリア別、どちらも要ログイン＝元実装のCognito版と同様の仕様）
  - ルート`/`とゲームハブページに`AuthStatus`（ログイン状態表示）、履歴・プロフィール・ランキングへの導線を追加
  - **注意点**: `fetchModeRanking`/`fetchAreaRanking`は明示的に`requireUserId()`を呼ぶようにしている。呼ばないと未ログイン時に生の`permission denied for table ...`というPostgresエラーがそのまま画面に出てしまう不具合があったため(anonロールの権限を剥奪済みなのが原因)。今後同様の「ログイン必須の一覧系」データ取得関数を追加する際は、実際にログアウト状態でも動作確認すること
- [ ] 一時停止対策のcron設定
- [ ] 既存ユーザーの移行実施

## 市区町村図鑑クイズ（2026-07-24 実装、MVP範囲）

設計書: `docs/市区町村図鑑クイズ_設計ドキュメント.md`（ただし「7. データモデル」はDynamoDB想定のたたき台のため無視し、実際は以下の通りSupabase/Postgresで作り直した）。地図パズルと同一サイト内の新ミニゲームとして`/game/zukan-quiz`配下に実装。MVPは「ふつう」難易度のみ・4択クイズ・1セッション5問・正解した市区町村の図鑑登録（都道府県別コンプリート率表示まで）。

- **データソース**: ポリゴンは既存と同じCloudFront配信geojson（`/geojson/municipality/2020/{prefCode}.geojson`。`prefCode/cityCode/cityName`のみでシルエット描画用に十分）。人口・世帯数は新規に`stat.usapo.net`（国勢調査統計API、`GET /statistics/census/2020/population/{prefCode}/{cityCode}.json`、`areas[]`の`hyosyo===1`要素が市区計）を利用。設計書にある「静岡県を除く」は現時点では実データ上は解消済み（両APIとも静岡県のデータが存在することを実機確認済み）
  - stat.usapo.netには面積データが無く、CloudFrontのgeojsonにも市区町村レベルの面積プロパティが無いため、人口密度・世帯数増減率のヒントはMVPスコープ外（人口・世帯数のみ表示、ユーザー確認済み）
- **正答を隠す設計**: 出題(ポリゴン取得・統計値取得・ダミー選択肢生成)は新規Route Handler `src/app/api/zukan-quiz/route.ts`が担当し、`src/lib/game/zukanQuizData.ts`（`server-only`パッケージでクライアントからの誤importを防止）が実処理を行う。クライアントへ返すシルエットは**プロパティを剥がした座標のみ**で、正答自体は`game_zukan_quiz_sessions`テーブル（INSERTのみ許可、SELECT/UPDATEはanon/authenticatedどちらにも許可しない）にサーバー側で保存する。回答判定は`claim_zukan_quiz_answer`関数(security definer)をクライアントから直接RPC呼び出しし、正誤判定と図鑑(`game_zukan_collections`)への登録までDB側で完結させる(地図パズルのスコア再計算トリガーと同じ「クライアントの自己申告を信用しない」設計)
  - `game_zukan_collections`はauthenticatedにSELECTのみ許可し、INSERT/UPDATEは一切許可していない（許可すると、クイズを解かずに直接カードを自己付与できてしまうため）。書き込みは`claim_zukan_quiz_answer`経由のみ
  - マイグレーション: `20260724000000_zukan_quiz_schema.sql` / `20260724000001_zukan_quiz_revoke_grants.sql`（実機確認したところ今回も新テーブルにanonへの暗黙GRANTが付いていたため明示的にREVOKEし直した。既存の教訓通りの再発） / `20260724000002_zukan_quiz_sessions_insert_policy.sql`（RLS有効化とINSERTポリシー自体を書き忘れていたのを実機確認で発見・修正） / `20260725000000_zukan_quiz_answer_variable_conflict_fix.sql`（ログイン中に正解した時だけ`column reference "pref_code" is ambiguous`エラーが発生する不具合を修正。原因は`RETURNS TABLE(pref_code text, ...)`の戻り値列名がPL/pgSQL変数としても存在し、`INSERT ... ON CONFLICT (pref_code, city_code)`の対象列リストが式として解釈されるため同名のテーブル列と衝突していたこと。`#variable_conflict use_column`で解決。**今後`RETURNS TABLE`を使う関数で、戻り値の列名がINSERT/UPDATE対象テーブルの列名と一致する場合は同じ問題が起きうるので注意**）
- **ダミー選択肢生成ロジック（決定した基準）**: 同一都道府県内から人口が対象の概ね1/3〜3倍のレンジの自治体を優先候補にし、3件に満たなければレンジを1/10〜10倍→無制限の順に広げる。それでも足りなければ別の都道府県からも補充する。地理的近さは「同一都道府県」を代理指標として使い、重心間の距離計算などは行っていない

### トリビアヒント・正答率（2026-07-26 追加、ユーザーからのフィードバック対応）

実際に遊んでみた結果「シルエットだけだと絶対無理」というフィードバックを受け、正答前のヒントとして「主な産業」「名物・特産品」を追加した。あわせて「正答率も要素として入れてほしい」という要望で、自治体ごとの全ユーザー横断の出題数・正解数も追加した。

- **出題対象をトリビア登録済み自治体に限定**（ユーザー確認済み）。データが無い自治体は出題プールに入らない
  - 当初はSupabaseの`game_zukan_municipality_trivia`テーブルに直接データ投入する方式（産業・名物の2項目、出典URL付き、12自治体分をWikipedia→自治体公式サイトの順で調査）で試験導入したが、**2026-07-27にトリビアのデータソースを本体側(team-kokuusa-platform-frontend, AWS Amplify)の管理画面経由に切り替えた**。理由は「geojsonと同じくCloudFrontで配信し、本体側の管理画面から編集できる方が良い」というユーザー判断（詳細設計は本体側リポジトリの`docs/municipality-trivia-management-design.md`参照。このリポジトリには実装しない）
  - 現在の出題ロジック(`src/lib/game/zukanQuizData.ts`の`fetchTriviaCandidates`)は、47都道府県分の`{NEXT_PUBLIC_CLOUDFRONT_URL}/municipality-trivia/{prefCode}.json`を並行fetchし(トリビア未公開の都道府県は404を返すだけで正常)、まとめて出題候補プールにする。Supabaseの`game_zukan_municipality_trivia`テーブルは`20260727000000_zukan_quiz_drop_municipality_trivia.sql`で削除済み
  - トリビア項目は本体側の設計変更に伴い8種類に拡張された: `industry`(主な産業) / `specialty`(名物・特産品) / `historicalEvent`(歴史上有名な出来事) / `touristSpot`(観光スポット) / `notablePerson`(ゆかりの人物) / `festival`(祭り・イベント) / `natureFeature`(自然・地形の特徴) / `localCuisine`(郷土料理・ご当地グルメ)。**出典URLは廃止**（本体側で「運用コストに見合わない」と判断されたため）。1項目以上あれば出題対象になる
  - トリビアJSONは本体側の管理画面から随時追加・編集される運用中のデータのため、統計API(1週間)より大幅に短い5分キャッシュ(`TRIVIA_REVALIDATE_SECONDS`)にしている
  - ダミー選択肢生成ロジック自体は変更なし(トリビアの有無を問わず同一都道府県内から人口が近いものを選ぶ)
  - セッション内で同じ自治体が再出題されないよう、クライアント(`ZukanQuizGame.tsx`)が出題済みの`"prefCode:cityCode"`一覧を`/api/zukan-quiz`に毎回送り、Route Handler側で候補から除外している(トリビア公開自治体数が少ないうちは対策しないと同一セッション内で重複が起きやすいため)
  - **表示するヒントは8項目のうちランダムに最大3件のみ**（ユーザー指示、2026-07-27）。`zukanQuizData.ts`の`pickTriviaSubset`が出題生成時(サーバー側)に選び、選ばれなかった項目は`null`にしてクライアントへ渡す(全部見せると簡単すぎるため)
  - **人口・世帯数は出題時(回答前)に表示するよう変更**（ユーザー指示、2026-07-27。当初は回答後の答え合わせとして表示していた）。`ZukanQuizQuestion`(question)に`population`/`households`を追加し、シルエット・ヒントと同じタイミングでクライアントに渡す。ダミー選択肢は元々「人口が近い自治体」を選ぶ設計のため、人口を先に見せても4択の正解が自明になりすぎない
- **正答率の集計**: `game_zukan_municipality_stats`テーブル(`pref_code, city_code, attempt_count, correct_count`)に、ログイン有無を問わず全回答を集計する。`claim_zukan_quiz_answer`関数内で`INSERT ... ON CONFLICT ... RETURNING ... INTO`によりUPSERTと同時に最新の集計値を取得し、そのままRPCの戻り値に含めて返す(直接のGRANTは一切行わず、書き込み・参照は同関数のsecurity definer経由のみ)
  - この変更で`claim_zukan_quiz_answer`の`RETURNS TABLE`列を追加する必要があったが、Postgresでは`create or replace function`だけでは戻り値の型(列構成)を変更できない(`cannot change return type of existing function`エラー)。`drop function`してから`create function`し直す必要がある点に注意
- geojson・統計APIのfetchはNext.jsのData Cache（`next: { revalidate }`、1週間）でキャッシュし、外部APIへの負荷を抑えている（国勢調査2020年データはほぼ更新されないため長めに設定）。トリビアJSONのみ5分キャッシュ（上記参照）
- 画面: `/game/zukan-quiz`（トップ）、`/game/zukan-quiz/play`（クイズ本体、`ZukanQuizGame.tsx`）、`/game/zukan-quiz/collection`（図鑑一覧、都道府県別コンプリート率は`/api/zukan-quiz/prefectures`で分母を取得）

## 新規ゲーム構想「地図制覇ゲーム」のプロトタイプ（2026-07-21 移設）

上記とは別に、新しいゲーム構想「地図制覇ゲーム」（カルドセプト風の陣取りゲーム、実データで町丁目を歩いて攻略する）のプロトタイピングも、ゲーム関連開発の集約方針によりこのリポジトリに移設した。

- 設計書: `docs/map_conquest_game_design.md`
- モック本体: `docs/map_conquest_game/`（`index.html` を開くと一覧、`README.md` に各モックの検証内容・暫定計算式・既知の限界、`test-story-ota.md` に大田区の実データを使ったテストウォークスルーがある）
- 全12モックは自己完結HTML（ビルド不要）。usapo.net本体側と同じCloudFront（geojson配信）に直接fetchする方式で、上記「決定したアーキテクチャ」の geojson配信方針（S3+CloudFrontのままfetch()で読む）と整合している
- **2026-07-16〜17にかけて、ユーザーの「残りをまとめて開発しておいて」という指示のもと5モックを自律的に追加しており、ユーザー本人のレビューが済んでいない部分がある**（詳細はREADME参照）
- この構想はまだ「大枠を固める」段階で、UIはデスクトップ・マウス操作前提（本番はスマホ想定だが未着手）
- 上記「決定したアーキテクチャ」（Next.js/Vercel/Supabase）は既存の町丁パズル移行の話であり、地図制覇ゲームを同じ技術スタックに乗せるかどうかはまだ未検討・未決定
