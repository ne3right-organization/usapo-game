import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { createGameProfile } from "../functions/create-game-profile/resource";
import { setNickname } from "../functions/set-nickname/resource";
import { submitMapPackChallenge } from "../functions/submit-map-pack-challenge/resource";
import { submitMapPuzzleChallenge } from "../functions/submit-map-puzzle-challenge/resource";

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
      .identifier(["userId", "difficulty"])
      .secondaryIndexes((index) => [
        index("difficulty").sortKeys(["totalScore"]).queryField("listMapPackUserTotalsByDifficulty"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

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
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});
