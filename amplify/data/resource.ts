import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { claimZukanQuizAnswer } from "../functions/claim-zukan-quiz-answer/resource";
import { createGameProfile } from "../functions/create-game-profile/resource";
import { setFollowing } from "../functions/set-following/resource";
import { setNickname } from "../functions/set-nickname/resource";
import { submitMapPackChallenge } from "../functions/submit-map-pack-challenge/resource";
import { submitMapPuzzleChallenge } from "../functions/submit-map-puzzle-challenge/resource";
import { startZukanQuiz } from "../functions/start-zukan-quiz/resource";
import { zukanComment } from "../functions/zukan-comment/resource";

// Supabase(supabase/migrations)から移しているゲームのデータ。設計は docs/amplify_data_migration.md。
// ユーザーIDは Cognito の sub。得点・ベスト記録・合計など「クライアントの自己申告を信用しない」ものは
// クライアントから書き込めないようにし、Lambda のカスタムミューテーションだけが書く

const schema = a
  .schema({
    GameDifficulty: a.enum(["beginner", "intermediate", "advanced"]),

    // ─── プロフィール(全ゲーム共通) ───────────────────────────────────────────
    // 初めてログインしたときに作る(create-game-profile)。nickname が空なら「未設定」。ランキングには
    // 「未設定」のまま出し、他人のプロフィールやフォローはニックネームを設定した人だけ
    GameProfile: a
      .model({
        userId: a.id().required(),
        nickname: a.string(),
        // 地図パズルのベスト記録の合計とエリア数(submit-map-puzzle-challenge が更新する)
        totalScore: a.integer().required().default(0),
        areasPlayedCount: a.integer().required().default(0),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // ─── 地図パズル ─────────────────────────────────────────────────────────
    // 挑戦の記録(1回ごと)
    GameMapPuzzleChallenge: a
      .model({
        userId: a.id().required(),
        nickname: a.string(), // 記録した時点のニックネーム
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(), // 中級・上級のみ
        cityName: a.string(),
        totalPieces: a.integer().required(),
        missCount: a.integer().required(),
        elapsedSeconds: a.integer().required(),
        baseScore: a.integer().required(),
        timeBonus: a.integer().required(),
        missPenalty: a.integer().required(),
        score: a.integer().required(),
        isNewBest: a.boolean().required(),
        comment: a.string(),
        playedAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index("userId").sortKeys(["playedAt"]).queryField("listMapPuzzleChallengesByUser"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 中断データ(難易度×エリアごとに1件)。areaKey = `${difficulty}#${prefCode}#${cityCode ?? ""}`
    GameMapPuzzleProgress: a
      .model({
        userId: a.id().required(),
        areaKey: a.string().required(),
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        placedIds: a.integer().array().required(),
        missCount: a.integer().required(),
        elapsedSeconds: a.integer().required(),
        savedAt: a.datetime().required(),
      })
      .identifier(["userId", "areaKey"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub")]),

    // ユーザー×エリアの自己ベスト。rankingKey はエリア別ランキング用
    // (初級 `beginner#00` / 中級 `intermediate#<pref>` / 上級 `advanced#<pref>#<city>`)
    GameMapPuzzleBest: a
      .model({
        userId: a.id().required(),
        areaKey: a.string().required(),
        rankingKey: a.string().required(),
        nickname: a.string(), // ニックネームが空の人はランキングに出さない
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        bestScore: a.integer().required(),
        bestChallengeId: a.id().required(),
        playCount: a.integer().required(),
        firstPlayedAt: a.datetime().required(),
        lastPlayedAt: a.datetime().required(),
      })
      .identifier(["userId", "areaKey"])
      .secondaryIndexes((index) => [
        index("difficulty").sortKeys(["bestScore"]).queryField("listMapPuzzleBestByDifficulty"),
        index("rankingKey").sortKeys(["bestScore"]).queryField("listMapPuzzleBestByRankingKey"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // ─── 地図ポットン ───────────────────────────────────────────────────────
    // 地図パズルと同じ形。得点の尺度が違うので別に集計し、GameProfile の合計には入れない
    GameMapPackChallenge: a
      .model({
        userId: a.id().required(),
        nickname: a.string(),
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        totalPieces: a.integer().required(),
        mergePoints: a.integer().required(), // 合体で得た点の合計(減点前)
        restackCount: a.integer().required(),
        splitCount: a.integer().required(),
        cleared: a.boolean().required(), // あきらめた挑戦も記録する
        elapsedSeconds: a.integer().required(),
        clearBonus: a.integer().required(),
        score: a.integer().required(),
        isNewBest: a.boolean().required(),
        playedAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index("userId").sortKeys(["playedAt"]).queryField("listMapPackChallengesByUser"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 中断データ。state は MapPackGame が作る JSON(MapPackSnapshot)をそのまま入れる
    GameMapPackProgress: a
      .model({
        userId: a.id().required(),
        areaKey: a.string().required(),
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        state: a.json().required(),
        elapsedSeconds: a.integer().required(),
        savedAt: a.datetime().required(),
      })
      .identifier(["userId", "areaKey"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub")]),

    // あきらめた挑戦も入るので、完成させたかは firstClearedAt(初めて完成させた日時、未完成なら空)で見る
    GameMapPackBest: a
      .model({
        userId: a.id().required(),
        areaKey: a.string().required(),
        rankingKey: a.string().required(),
        nickname: a.string(),
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        bestScore: a.integer().required(),
        bestChallengeId: a.id().required(),
        playCount: a.integer().required(),
        firstPlayedAt: a.datetime().required(),
        lastPlayedAt: a.datetime().required(),
        firstClearedAt: a.datetime(),
      })
      .identifier(["userId", "areaKey"])
      .secondaryIndexes((index) => [
        index("rankingKey").sortKeys(["bestScore"]).queryField("listMapPackBestByRankingKey"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // 難易度別ランキング(1人1行)用。その人のその難易度のベスト記録の合計と、一番点の高いエリア。
    // Supabase 版の RPC(fetch_map_pack_user_ranking)の集計を、記録のたびに書いておく形にしたもの
    GameMapPackUserTotal: a
      .model({
        userId: a.id().required(),
        level: a.string().required(), // difficulty と同じ値。主キーに enum は使えないため文字列で持つ
        difficulty: a.ref("GameDifficulty").required(),
        nickname: a.string(),
        totalScore: a.integer().required(),
        areasCount: a.integer().required(),
        topPrefCode: a.string().required(),
        topPrefName: a.string().required(),
        topCityCode: a.string(),
        topCityName: a.string(),
        topScore: a.integer().required(),
        lastPlayedAt: a.datetime().required(),
      })
      .identifier(["userId", "level"])
      .secondaryIndexes((index) => [
        index("difficulty").sortKeys(["totalScore"]).queryField("listMapPackUserTotalsByDifficulty"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // ─── 図鑑クイズ ─────────────────────────────────────────────────────────
    // 出題1問ぶんの正答。クライアントからは読み書きできず、出題の Lambda が作り、回答の Lambda が
    // 消して(=1回きり)判定する。回答されなかったものは expiresAt(TTL)で消える
    GameZukanQuizSession: a
      .model({
      prefCode: a.string().required(),
      prefName: a.string().required(),
      cityCode: a.string().required(),
      cityName: a.string().required(),
      population: a.integer(),
      households: a.integer(),
      difficulty: a.string().required(),
      hintFields: a.string().array().required(), // 出題時に実際に見せたヒントの項目
      issuedAt: a.datetime().required(),
      expiresAt: a.integer().required(), // TTL(UNIX秒)
    })
      // モデルには認可ルールが1つ必要なので、誰も入っていない admin グループだけにしておく(=クライアントからは触れない)
      .authorization((allow) => [allow.group("admin")]),

    // 図鑑のカード(ユーザー×市区町村)。areaKey = `${prefCode}#${cityCode}`
    GameZukanCollection: a
      .model({
        userId: a.id().required(),
        areaKey: a.string().required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string().required(),
        cityName: a.string().required(),
        population: a.integer(),
        households: a.integer(),
        correctCount: a.integer().required(),
        bestDifficulty: a.string().required(), // 一番上の難易度で正解したもの
        hintFields: a.string().array().required(), // 直近に正解したときに見せたヒント(上書き)
        firstAcquiredAt: a.datetime().required(),
        lastAcquiredAt: a.datetime().required(),
      })
      .identifier(["userId", "areaKey"])
      .secondaryIndexes((index) => [
        index("userId").sortKeys(["lastAcquiredAt"]).queryField("listZukanCollectionsByUser"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // 市区町村ごとの全ユーザー横断の正答率(ゲストの回答も数える)。回答の Lambda だけが読み書きする
    GameZukanMunicipalityStat: a
      .model({
        areaKey: a.string().required(),
        attemptCount: a.integer().required(),
        correctCount: a.integer().required(),
      })
      .identifier(["areaKey"])
      .authorization((allow) => [allow.group("admin")]), // クライアントからは触れない(GameZukanQuizSession と同じ)

    // カードへの「ヒントの提案」(1ユーザー1カードにつき1件)。そのカードを持っている人だけ書ける
    // (確認が要るので書き込みはカスタムミューテーション経由)
    GameZukanComment: a
      .model({
        areaKey: a.string().required(),
        userId: a.id().required(),
        nickname: a.string(),
        body: a.string().required(),
        postedAt: a.datetime().required(),
        editedAt: a.datetime().required(),
      })
      .identifier(["areaKey", "userId"])
      .secondaryIndexes((index) => [
        index("areaKey").sortKeys(["postedAt"]).queryField("listZukanCommentsByArea"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // ─── フォロー ───────────────────────────────────────────────────────────
    // フォロー関係はフォローした本人とされた本人にしか見えない。フォロー・解除は「お互いにニックネーム設定済み」の
    // 確認が要るので、カスタムミューテーション(setFollowing)だけが書く
    GameFollow: a
      .model({
        followerId: a.id().required(),
        followeeId: a.id().required(),
        followedAt: a.datetime().required(),
      })
      .identifier(["followerId", "followeeId"])
      .secondaryIndexes((index) => [
        index("followerId").sortKeys(["followedAt"]).queryField("listFollowingByUser"),
        index("followeeId").sortKeys(["followedAt"]).queryField("listFollowersByUser"),
      ])
      .authorization((allow) => [
        allow.ownerDefinedIn("followerId").identityClaim("sub").to(["read"]),
        allow.ownerDefinedIn("followeeId").identityClaim("sub").to(["read"]),
      ]),

    // ─── 最近のクリア(3ゲーム共通) ──────────────────────────────────────────
    // 各ゲームのトップに出す「最近クリアされたエリア」。誰がクリアしたかは持たない。未ログインでも読める。
    // game = map-puzzle / map-pack / zukan-quiz、areaKey はゲームごとのエリアのキー
    GameRecentClear: a
      .model({
        game: a.string().required(),
        areaKey: a.string().required(),
        difficulty: a.string(), // 図鑑クイズは持たない
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        lastClearedAt: a.datetime().required(),
      })
      .identifier(["game", "areaKey"])
      .secondaryIndexes((index) => [
        index("game").sortKeys(["lastClearedAt"]).queryField("listRecentClearsByGame"),
      ])
      .authorization((allow) => [allow.guest().to(["read"]), allow.authenticated().to(["read"])]),

    ZukanQuizQuestion: a.customType({
      sessionId: a.id().required(),
      difficulty: a.string().required(),
      silhouette: a.json().required(),
      choices: a.json().required(),
      trivia: a.json().required(),
      population: a.integer().required(),
      households: a.integer().required(),
    }),

    ZukanQuizAnswerResult: a.customType({
      isCorrect: a.boolean().required(),
      prefCode: a.string().required(),
      prefName: a.string().required(),
      cityCode: a.string().required(),
      cityName: a.string().required(),
      population: a.integer(),
      households: a.integer(),
      attemptCount: a.integer().required(),
      correctCount: a.integer().required(),
      difficulty: a.string().required(),
    }),

    MapPackSubmitResult: a.customType({
      score: a.integer().required(),
      isNewBest: a.boolean().required(),
    }),

    // ─── カスタムミューテーション ───────────────────────────────────────────
    submitMapPuzzleChallenge: a
      .mutation()
      .arguments({
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        totalPieces: a.integer().required(),
        missCount: a.integer().required(),
        elapsedSeconds: a.integer().required(),
        comment: a.string(),
      })
      .returns(a.ref("GameMapPuzzleChallenge"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitMapPuzzleChallenge)),

    submitMapPackChallenge: a
      .mutation()
      .arguments({
        difficulty: a.ref("GameDifficulty").required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string(),
        cityName: a.string(),
        totalPieces: a.integer().required(),
        mergePoints: a.integer().required(),
        restackCount: a.integer().required(),
        splitCount: a.integer().required(),
        cleared: a.boolean().required(),
        elapsedSeconds: a.integer().required(),
      })
      .returns(a.ref("MapPackSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitMapPackChallenge)),

    // 図鑑クイズは未ログイン(ゲスト)でも遊べる。図鑑に登録されるのはログインしている時だけ
    startZukanQuiz: a
      .mutation()
      .arguments({
        difficulty: a.string().required(),
        // 同じセッションで出題済みの市区町村("prefCode:cityCode")。再出題を避ける
        excludeCityCodes: a.string().array(),
      })
      .returns(a.ref("ZukanQuizQuestion"))
      .authorization((allow) => [allow.guest(), allow.authenticated()])
      .handler(a.handler.function(startZukanQuiz)),

    claimZukanQuizAnswer: a
      .mutation()
      .arguments({
        sessionId: a.id().required(),
        prefCode: a.string().required(),
        cityCode: a.string().required(),
      })
      .returns(a.ref("ZukanQuizAnswerResult"))
      .authorization((allow) => [allow.guest(), allow.authenticated()])
      .handler(a.handler.function(claimZukanQuizAnswer)),

    upsertZukanComment: a
      .mutation()
      .arguments({ prefCode: a.string().required(), cityCode: a.string().required(), body: a.string().required() })
      .returns(a.ref("GameZukanComment"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(zukanComment)),

    deleteZukanComment: a
      .mutation()
      .arguments({ prefCode: a.string().required(), cityCode: a.string().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(zukanComment)),

    setFollowing: a
      .mutation()
      .arguments({ followeeId: a.id().required(), follow: a.boolean().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(setFollowing)),

    setNickname: a
      .mutation()
      .arguments({ nickname: a.string() })
      .returns(a.ref("GameProfile"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(setNickname)),
  })
  .authorization((allow) => [
    allow.resource(createGameProfile),
    allow.resource(setNickname),
    allow.resource(submitMapPuzzleChallenge),
    allow.resource(submitMapPackChallenge),
    allow.resource(startZukanQuiz),
    allow.resource(claimZukanQuizAnswer),
    allow.resource(zukanComment),
    allow.resource(setFollowing),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});
