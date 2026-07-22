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
  - ログイン方式はマジックリンク（パスワードレス）を採用。X(Twitter)/Google等のOAuth追加も検討したが、実装済みのマジックリンクのまま進める方針に確定
  - 認証メールの送信はSupabaseのデフォルト共有SMTP（レート制限が低い）。利用者が増えてきたら独自SMTP（Resend等）への切り替えを検討
- [x] プレイ履歴・プロフィール・ランキング機能のデータ層・認証・チャレンジ送信を実装（元実装 team-kokuusa-platform-frontend の Cognito+AppSync 版を Supabase に置き換えて移植）:
  - `src/lib/game/mapPuzzleData.ts`: データアクセス層（履歴送信・進行保存・プロフィール・ランキング）。supabase-js直叩き、RLSでアクセス制御
  - `src/app/login/page.tsx` + `src/app/auth/callback/route.ts`: マジックリンク認証（実プロジェクトで送信確認済み）
  - `src/app/game/map-puzzle/nickname/page.tsx`: ニックネーム編集
  - `MapPuzzleGame.tsx`にチャレンジ送信(`submitChallenge`)・途中保存(`saveProgress`)を再接続、`[difficulty]/page.tsx`にサーバー側途中保存の再開フローを再接続（未ログインでもエラーを握りつぶしてゲストplayできるようフォールバック済み。実機確認済み）
- [ ] **残り3画面が未実装**（データ層は用意済みなので実装自体は比較的軽いはず）:
  - [ ] `/game/map-puzzle/history`（プレイ履歴一覧）
  - [ ] `/game/map-puzzle/profile`, `/game/map-puzzle/profile/[userId]`（プロフィール・ベストスコア一覧）
  - [ ] `/game/map-puzzle/ranking`, `/game/map-puzzle/ranking/area`（モード内・エリア別ランキング）
  - [ ] トップページ等への `NicknameBadge` 相当の導線
- [ ] 一時停止対策のcron設定
- [ ] 既存ユーザーの移行実施

## 新規ゲーム構想「地図制覇ゲーム」のプロトタイプ（2026-07-21 移設）

上記とは別に、新しいゲーム構想「地図制覇ゲーム」（カルドセプト風の陣取りゲーム、実データで町丁目を歩いて攻略する）のプロトタイピングも、ゲーム関連開発の集約方針によりこのリポジトリに移設した。

- 設計書: `docs/map_conquest_game_design.md`
- モック本体: `docs/map_conquest_game/`（`index.html` を開くと一覧、`README.md` に各モックの検証内容・暫定計算式・既知の限界、`test-story-ota.md` に大田区の実データを使ったテストウォークスルーがある）
- 全12モックは自己完結HTML（ビルド不要）。usapo.net本体側と同じCloudFront（geojson配信）に直接fetchする方式で、上記「決定したアーキテクチャ」の geojson配信方針（S3+CloudFrontのままfetch()で読む）と整合している
- **2026-07-16〜17にかけて、ユーザーの「残りをまとめて開発しておいて」という指示のもと5モックを自律的に追加しており、ユーザー本人のレビューが済んでいない部分がある**（詳細はREADME参照）
- この構想はまだ「大枠を固める」段階で、UIはデスクトップ・マウス操作前提（本番はスマホ想定だが未着手）
- 上記「決定したアーキテクチャ」（Next.js/Vercel/Supabase）は既存の町丁パズル移行の話であり、地図制覇ゲームを同じ技術スタックに乗せるかどうかはまだ未検討・未決定
