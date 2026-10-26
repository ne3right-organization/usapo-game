# Supabase → Amplify Data 移行: アクセスパターンと設計案

Supabase(Postgres + RLS + トリガー/RPC)で持っているゲームのデータを、Amplify Gen2 の Data(AppSync + DynamoDB)に移すための洗い出し。
2026-10-26 時点のコード(`src/lib/game/*Data.ts` ほか)と `supabase/migrations/` から機械的に拾ったもの。

認証はすでに Cognito(Google のみ)に切り替え済み(`src/lib/auth.ts`)。ユーザーIDは Cognito の `sub`。

## 1. 方針

- **土台は本体リポジトリにあった旧スキーマ**: 地図パズルは元々本体(team-kokuusa-platform-frontend)の Gen2 で動いていた。削除コミット `3759990` の直前の `amplify/data/resource.ts` に `GameProfile` / `GameMapPuzzleChallenge` / `GameMapPuzzleProgress` / `GameMapPuzzleBest` が残っているので、名前と GSI の付け方はこれに揃える。
- **ただし旧スキーマの弱点は直す**:
  - 旧版は得点をクライアントが計算して送っていた → Supabase 版と同じく**サーバー側で計算し直す**(下の「カスタムミューテーション」)。
  - 旧版はベスト記録を1時間おきのLambdaで集計していた → **記録の送信時にその場で更新**する(Supabase 版のトリガーと同じ)。
  - 旧版は `allow.authenticated()` に create/update/delete を広く付けていた(他人のプロフィールも書き換えられる) → 本人のデータは `allow.owner()`、集計系はクライアントから書き込み不可にする。
- **「クライアントの自己申告を信用しない」処理は全部 Lambda のカスタムミューテーションに寄せる**: Supabase の security definer 関数・トリガーに当たるもの。テーブル直書きを許すのは、本人だけが使う中断データ・ニックネーム・フォロー・コメントのように、改ざんされても困らないものに限る。
- **SQL の集計(group by)は使えないので、書き込み時に集計用の項目を作っておく**: ランキング・最近のクリア・ユーザー別合計など。

## 2. 現在のアクセスパターン

### 2.1 共通: プロフィール(`game_profiles`)

| 操作 | 誰が | 条件 | 現在の実装 |
|---|---|---|---|
| 自分のプロフィールを読む | 本人 | user_id | `fetchGameProfile()` |
| 他人のプロフィールを読む | ログインユーザー | user_id、**ニックネーム設定済みの人だけ** | `fetchGameProfile(userId)`(RLS) |
| ニックネームを設定・変更 | 本人 | user_id | `updateNickname()` の upsert |
| ニックネームを各ベスト記録に反映 | DB | user_id | トリガー `game_profiles_propagate_nickname(_map_pack)` |
| 合計スコア・プレイエリア数を更新 | DB | user_id | 地図パズルの記録送信トリガー内で SUM/COUNT |

### 2.2 地図パズル

| 操作 | 誰が | キー・条件 | 並び | 現在の実装 |
|---|---|---|---|---|
| 記録を送る(得点はDBで再計算) | 本人 | — | — | `submitChallenge()` + トリガー |
| 自分の挑戦履歴 | 本人 | user_id | played_at 降順、カーソル | `fetchChallengeHistory()` |
| 中断データ 1件 | 本人 | user_id + difficulty + pref_code + city_code | — | `fetchSavedProgress()` |
| 中断データ 難易度ごと一覧 | 本人 | user_id + difficulty | — | `fetchAllSavedProgress()` |
| 中断データ 保存・削除 | 本人 | 同上 | — | `saveProgress()` / `discardProgress()` |
| クリア済みエリア | 本人 | user_id + difficulty | — | `fetchClearedAreas()` |
| ベスト記録一覧 | 本人・他人(ニックネーム設定済み) | user_id | best_score 降順 | `fetchBestList()` |
| モード内ランキング | ログインユーザー | difficulty | best_score 降順、カーソル | `fetchModeRanking()` |
| エリア別ランキング | ログインユーザー | (中級)difficulty + pref_code / (上級)city_code | best_score 降順、カーソル | `fetchAreaRanking()` |
| 最近クリアされたエリア | **未ログインも可** | — | 最終クリア日時 降順、最大8件 | RPC `fetch_recent_map_puzzle_clears` |
| コンプリート状況 | 本人・他人 | user_id(全難易度) | — | `completionData.ts` |

記録送信時に DB でやっていること: 得点計算(基本点・タイムボーナス・ミス減点)、自己ベスト判定、ベスト記録の upsert(play_count +1)、そのエリアの中断データ削除、プロフィールの合計スコア再計算。

### 2.3 地図ポットン(`game_map_pack_*`)

| 操作 | 誰が | キー・条件 | 並び | 現在の実装 |
|---|---|---|---|---|
| 記録を送る(得点はDBで再計算) | 本人 | — | — | `submitMapPackChallenge()` + トリガー |
| 自分の挑戦履歴 | 本人 | user_id | played_at 降順、カーソル | `fetchMapPackHistory()` |
| 中断データ 1件・保存・削除 | 本人 | user_id + difficulty + pref_code + city_code | — | `fetch/save/discardMapPackProgress()` |
| 中断データ 一覧 | 本人 | user_id | saved_at 降順 | `fetchMapPackSavedGames()` |
| モード内ランキング(**人ごと**) | ログインユーザー | difficulty | 合計点 降順、offset | RPC `fetch_map_pack_user_ranking`(group by user) |
| ある人のエリア一覧 | ログインユーザー | user_id + difficulty | best_score 降順 | `fetchMapPackUserAreas()` |
| エリア別ランキング | ログインユーザー | difficulty + pref_code + city_code | best_score 降順、カーソル | `fetchMapPackAreaRanking()` |
| 最近クリアされたエリア | **未ログインも可** | — | 最終クリア日時 降順 | RPC `fetch_recent_map_pack_clears` |
| コンプリート状況 | 本人・他人 | user_id、`first_cleared_at` が null でないもの | — | `completionData.ts` |

記録送信時に DB でやっていること: 得点計算、自己ベスト判定、ベスト記録の upsert(`first_cleared_at` は初めて完成した時だけ入れる)、そのエリアの中断データ削除。中断データの状態はクライアントが作る JSON(最大 500KB 程度)。

### 2.4 図鑑クイズ(`game_zukan_*`)

| 操作 | 誰が | キー・条件 | 並び | 現在の実装 |
|---|---|---|---|---|
| 出題(正答をサーバーに保存) | 誰でも | — | — | Route Handler `/api/zukan-quiz` が `game_zukan_quiz_sessions` に INSERT |
| 回答(正誤判定・図鑑登録・正答率集計) | 誰でも(登録はログイン時のみ) | session_id | — | RPC `claim_zukan_quiz_answer`(30分の期限・1回きり) |
| 図鑑一覧 | 本人・他人(ニックネーム設定済み) | user_id | last_acquired_at 降順 | `fetchZukanCollections()` |
| 図鑑の1枚 | 本人・他人 | user_id + pref_code + city_code | — | `fetchZukanCollectionEntry()` |
| 最近図鑑に登録された市区町村 | **未ログインも可** | — | 最終登録日時 降順 | RPC `fetch_recent_zukan_registrations` |
| ヒントの提案(コメント)一覧 | ログインユーザー | pref_code + city_code | created_at 降順 | `fetchZukanCollectionComments()` |
| ヒントの提案 投稿・編集・削除 | 本人、**そのカードを持っている人だけ** | user_id + pref_code + city_code | — | upsert/delete(RLS でカード所持を確認) |
| コンプリート状況 | 本人・他人 | user_id | — | `completionData.ts` |

正答率(`game_zukan_municipality_stats`)は回答の RPC の中だけで更新・参照している。

### 2.5 フォロー(`game_follows`)

| 操作 | 誰が | キー・条件 | 現在の実装 |
|---|---|---|---|
| フォローしているか | 本人 | follower + followee | `isFollowing()` |
| フォロー・解除 | 本人(双方ニックネーム設定済みのみ) | follower + followee | `follow()` / `unfollow()` |
| フォロワー数・フォロー数 | 本人 | followee / follower | `fetchFollowCounts()`(count) |
| フォロワー一覧・フォロー一覧(ニックネーム付き) | 本人 | followee / follower | created_at 降順 | `fetchFollowList()`(プロフィールと join) |

フォロー関係はフォローした本人とされた本人にしか見えない。

## 3. Amplify Data のモデル案

`a.model` のみで足りるものと、Lambda が書き込む集計用のものに分ける。認可は `owner` = 本人、`authenticated` = ログインユーザー、`guest` = 未ログイン(Identity Pool のゲスト)。

### 3.1 プロフィール

| モデル | 主キー / GSI | 認可 | 備考 |
|---|---|---|---|
| `GameProfile` | PK `userId` | owner: 作成・読む・更新 / authenticated: 読む | 合計スコア等は Lambda だけが更新。ニックネーム変更時のベスト記録への反映は DynamoDB Streams か、ニックネーム更新をカスタムミューテーションにして同時に書く |

### 3.2 地図パズル

| モデル | 主キー / GSI | 認可 | 備考 |
|---|---|---|---|
| `GameMapPuzzleChallenge` | PK `id`、GSI `userId`+`playedAt` | owner: 読む(書き込みは Lambda のみ) | 履歴 |
| `GameMapPuzzleProgress` | PK `userId`+`areaKey`(`difficulty#prefCode#cityCode`) | owner: 全部 | 難易度ごと一覧は `areaKey` の前方一致(`beginsWith`) |
| `GameMapPuzzleBest` | PK `userId`+`areaKey`、GSI `difficulty`+`bestScore`、GSI `rankingKey`+`bestScore` | authenticated: 読む(書き込みは Lambda のみ) | `rankingKey` はエリア別ランキング用の非正規化キー(中級 `intermediate#13`、上級 `advanced#13#101`) |

### 3.3 地図ポットン

地図パズルと同じ形(`GameMapPackChallenge` / `GameMapPackProgress` / `GameMapPackBest`)に加えて:

| モデル | 主キー / GSI | 認可 | 備考 |
|---|---|---|---|
| `GameMapPackUserTotal` | PK `userId`+`difficulty`、GSI `difficulty`+`totalScore` | authenticated: 読む | 人ごとランキング用。記録送信の Lambda が合計点・エリア数・最高点のエリアを書き直す(今の RPC の group by の代わり) |

### 3.4 図鑑クイズ

| モデル | 主キー / GSI | 認可 | 備考 |
|---|---|---|---|
| `GameZukanQuizSession` | PK `id`、TTL 30分 | クライアントからは一切不可 | 出題の Lambda(または Route Handler から IAM)だけが書く |
| `GameZukanCollection` | PK `userId`+`areaKey`(`prefCode#cityCode`)、GSI `userId`+`lastAcquiredAt` | authenticated: 読む(書き込みは Lambda のみ) | |
| `GameZukanMunicipalityStat` | PK `areaKey` | クライアントからは不可 | 回答の Lambda が ADD で加算して値を返す |
| `GameZukanComment` | PK `areaKey`+`userId`、GSI `areaKey`+`createdAt` | authenticated: 読む / 作成・更新・削除はカスタムミューテーション | 「カードを持っている人だけ」はモデルの認可で書けないので Lambda で確認する |

### 3.5 フォロー

| モデル | 主キー / GSI | 認可 | 備考 |
|---|---|---|---|
| `GameFollow` | PK `followerId`+`followeeId`、GSI `followeeId`+`createdAt` | 作成・削除はカスタムミューテーション / 読むは follower と followee の両方を owner に | 「双方ニックネーム設定済み」の確認は Lambda。一覧のニックネームは別途 `GameProfile` を引く(join が無いため) |

### 3.6 最近のクリア(未ログインも見られる集計)

| モデル | 主キー / GSI | 認可 | 備考 |
|---|---|---|---|
| `GameRecentClear` | PK `game`+`areaKey`、GSI `game`+`lastClearedAt` | guest・authenticated: 読む | 3ゲーム共通。記録送信・図鑑登録の Lambda が `lastClearedAt` を上書き。誰がクリアしたかは持たない |

## 4. カスタムミューテーション(Lambda)

| 名前 | 置き換える Supabase の処理 | やること |
|---|---|---|
| `submitMapPuzzleChallenge` | 地図パズルの before/after insert トリガー | 得点計算 → Challenge 作成 → Best 更新 → Progress 削除 → Profile の合計更新 → RecentClear 更新 |
| `submitMapPackChallenge` | 地図ポットンの before/after insert トリガー | 得点計算 → Challenge 作成 → Best 更新(first_cleared_at) → Progress 削除 → UserTotal 更新 → RecentClear 更新 |
| `startZukanQuiz` | `/api/zukan-quiz` の INSERT 部分 | 出題を作って Session に保存。問題の生成自体は今の Route Handler(`zukanQuizData.ts`)をそのまま使い、保存先だけ変える案もある |
| `claimZukanQuizAnswer` | RPC `claim_zukan_quiz_answer` | Session を条件付き更新で消費 → 正誤判定 → Stat 加算 → (ログイン時・正解時)Collection 更新 → RecentClear 更新 |
| `setNickname` | upsert + ニックネーム伝播トリガー | Profile 更新 → その人の Best・UserTotal のニックネームを書き直す |
| `follow` / `unfollow` | RLS の INSERT ポリシー | 双方ニックネーム設定済みを確認して作成・削除 |
| `upsertZukanComment` / `deleteZukanComment` | RLS のカード所持チェック | Collection があるか確認して書く |

複数テーブルをまとめて書くものは DynamoDB の `TransactWriteItems` を使えば、途中で失敗して中途半端になるのを防げる。

## 5. 決めておくこと

1. **「ニックネーム未設定の人は他人から非公開」の扱い** → **決定(2026-10-26)**: 初めてログインしたときに `GameProfile` を作り、ニックネームは空(画面では「未設定」)にしておく。ランキング・フォローなど人を出す画面は、ニックネームを設定した人だけを出す。認可で読めなくするところまではしない(シンプルさ優先)。
2. **ランキングのページ送り**: 今は best_score のカーソルや offset。DynamoDB では `nextToken` になるので、画面側もそれに合わせて直す。
3. **図鑑クイズの出題**: Route Handler に残して保存先だけ DynamoDB にするか(サーバーに IAM の権限が要る)、Lambda に移すか。
4. **既存データの移し替え**: Supabase の user_id(UUID)を Cognito の sub に付け替える。対応は Google の sub(Supabase `auth.identities.provider_id` ↔ Cognito のユーザー名 `google_<sub>`)。Cognito 側のユーザーは初回ログイン時に作られるので、移し替えは「全員が一度ログインした後」か「Post authentication トリガーで初回ログイン時に」行う。
5. **地図制覇ゲーム(map_conquest)のテーブル**: モック段階なので今回は移さない想定。

## 6. 進め方

1. 地図パズル: プロフィール + 地図パズル4モデル + `submitMapPuzzleChallenge` + `setNickname`(一番単純で、旧スキーマもある)
2. 地図ポットン: 同じ形を複製 + `GameMapPackUserTotal`
3. 図鑑クイズ: Session / Collection / Stat / Comment + 2つのミューテーション
4. フォロー・最近のクリア・コンプリート状況
5. 既存データの移し替えと本番切り替え
