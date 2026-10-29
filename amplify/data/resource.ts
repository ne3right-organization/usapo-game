import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { chizuTaneCheckin } from "../functions/chizu-tane-checkin/resource";
import { chizuTanePlace } from "../functions/chizu-tane-place/resource";
import { chizuTanePlayer } from "../functions/chizu-tane-player/resource";
import { chizuTaneSeeds } from "../functions/chizu-tane-seeds/resource";
import { chizuTaneStats } from "../functions/chizu-tane-stats/resource";
import { createGameProfile } from "../functions/create-game-profile/resource";
import { setFollowing } from "../functions/set-following/resource";
import { setNickname } from "../functions/set-nickname/resource";
import { submitMapPackChallenge } from "../functions/submit-map-pack-challenge/resource";
import { submitMapPuzzleChallenge } from "../functions/submit-map-puzzle-challenge/resource";

// Supabase から移したゲームのデータ(Supabase 時代のスキーマは git 履歴の supabase/migrations)。設計は docs/amplify_data_migration.md。
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

    // ─── 最近のクリア(地図パズル・地図ポットン共通) ──────────────────────────
    // 各ゲームのトップに出す「最近クリアされたエリア」。誰がクリアしたかは持たない。未ログインでも読める。
    // game = map-puzzle / map-pack(図鑑クイズを消す前の zukan-quiz の行が残っていることがある)、areaKey はゲームごとのエリアのキー
    GameRecentClear: a
      .model({
        game: a.string().required(),
        areaKey: a.string().required(),
        difficulty: a.string(), // 図鑑クイズ(削除済み)の古い行には無い
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

    // ─── 地図タネ(初期試作) ─────────────────────────────────────────────────
    // 設計書は docs/地図タネ_全体設計書.md と docs/地図タネ_初期試作設計書.md。画面での呼び名は 拠点＝タネ、箱庭＝ガーデン、町丁＝地区。
    // コースの表とアイテムの定義はコードの中のマスターデータ(src/lib/game/chizuTane/courses.ts)。
    // 1地区1つ・1日1回・所持数などを守るため、どのモデルもクライアントからは読むだけにし、書くのは chizu-tane-* の Lambda だけ

    // プレイヤー。最後に位置を使った地区の代表点と日時は、移動の速さの確認に使う(実際の位置は保存しない)。
    // grantedLevel は「タネを渡し終えたレベル」(レベルが上がったときに、そのレベルのタネを1回だけ渡すため)
    GameTanePlayer: a
      .model({
        userId: a.id().required(),
        course: a.string().required(),
        grantedLevel: a.integer(),
        lastAreaKey: a.string(),
        lastLng: a.float(),
        lastLat: a.float(),
        lastMovedAt: a.datetime(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 拠点(画面では「タネ」)。1地区に1つで、主キーは町丁のコード(e-Stat 小地域の KEY_CODE)。
    // ログインしていれば誰でも読める(持ち主の ID は画面に出さない)。cityKey = `${prefCode}${cityCode}`
    GameTaneBase: a
      .model({
        areaKey: a.string().required(),
        ownerId: a.id().required(),
        cityKey: a.string().required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string().required(),
        cityName: a.string().required(),
        townName: a.string().required(),
        baseTypeId: a.string().required(),
        seedItemId: a.string().required(), // まいたタネのもの(梨の木など)。訪ねた人はこれをもらう
        rank: a.integer().required(), // 実が全部取られて芽に戻るたびに1つ上がる(10まで)
        plantedAt: a.datetime().required(),
        // 地区の代表点(geojson の X_CODE / Y_CODE)。全国のタネ地図に出す。まいた人の実際の位置は保存しない
        repLng: a.float(),
        repLat: a.float(),
        // 育ち方(src/lib/game/chizuTane/growth.ts)。water はたまった水(現地のチェックイン1回で10、遠くからの水やりで1)。
        // たまると実って fruits(残っている実の数)が10になり、実が全部取られると water を0に戻して芽から育ち直す
        water: a.integer(),
        fruits: a.integer(),
        // いまなっている実が実った日時(実が全部取られたら消す)。収穫の記録に「実がなった日」として写す
        ripenedAt: a.datetime(),
        // 持ち主が最後に遠くから水をやった日(1日1回。dev は「1日」が短い)
        lastRemoteWaterOn: a.string(),
        // 落ちているタネ(まかれたタネと同じもの)。ほかの人のチェックインのたびに1個落ち、3個まで。誰でも早い者勝ちで拾える
        droppedSeeds: a.integer(),
        // 持ち主が最後に自分のタネにチェックインした日(日本時間)。1日1回(自分のタネは訪問の記録に残さず、レベルにも数えない)
        lastOwnerVisitOn: a.string(),
      })
      .identifier(["areaKey"])
      .secondaryIndexes((index) => [
        index("ownerId").sortKeys(["plantedAt"]).queryField("listTaneBasesByOwner"),
        index("cityKey").queryField("listTaneBasesByCity"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // 訪問(ユーザー×拠点)。lastReceivedOn は最後にもらった日(日本時間の YYYY-MM-DD)で、1日1回の判定に使う。
    // のちにレベル(たずねた拠点の数)を数えるのにも使える
    GameTaneVisit: a
      .model({
        userId: a.id().required(),
        areaKey: a.string().required(),
        firstVisitedAt: a.datetime().required(),
        lastReceivedOn: a.string(),
        visitCount: a.integer().required(),
      })
      .identifier(["userId", "areaKey"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 持っているもの(実。ユーザー×アイテム)。収穫したときだけ増える(訪ねてもらえるのはタネだけ)。ガーデンに飾れる数はこれ。
    // firstAreaName は初めて収穫した地区(「○○区 ○○町」)。産地ごとの記録は GameTaneHarvest
    GameTaneItem: a
      .model({
        userId: a.id().required(),
        itemId: a.string().required(),
        quantity: a.integer().required(),
        firstAcquiredAt: a.datetime().required(),
        firstAreaName: a.string(),
      })
      .identifier(["userId", "itemId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 収穫の記録(実1個ごと。ユーザー×収穫した日時)。集めたもの画面で「戸塚区矢部町のりんご」のように産地ごとにまとめて出す。
    // 地名・持ち主(タネをまいた人。画面では「生産者」)は収穫したときのものを写しておく(生産者は、フレンドのときだけ画面に出す)
    GameTaneHarvest: a
      .model({
        userId: a.id().required(),
        harvestedAt: a.datetime().required(),
        itemId: a.string().required(),
        areaKey: a.string().required(),
        prefName: a.string().required(),
        cityName: a.string().required(),
        townName: a.string().required(),
        ripenedAt: a.datetime(),
        ownerId: a.id().required(),
      })
      .identifier(["userId", "harvestedAt"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 持っているタネ(ユーザー×もの。みかんの木のタネ、梨の木のタネ…)。まくと1つ減る
    GameTaneHeldSeed: a
      .model({
        userId: a.id().required(),
        itemId: a.string().required(),
        quantity: a.integer().required(),
      })
      .identifier(["userId", "itemId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 箱庭(画面では「ガーデン」。1人1つ)。objects は GardenObject(src/lib/game/chizuTane/garden.ts)の配列。
    // 10×10マスで1マス1個なら最大100個なので1行に収まり、保存も1回で済む
    GameTaneGarden: a
      .model({
        userId: a.id().required(),
        width: a.integer().required(),
        height: a.integer().required(),
        objects: a.json().required(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    TaneCheckInResult: a.customType({
      // watered(水をやった) / ripened(水をやって実った) / fruit(実をもらった) / already(今日はもう来た)
      status: a.string().required(),
      townName: a.string().required(),
      baseTypeId: a.string().required(),
      itemId: a.string(), // そのタネのもの(梨の木など)
      quantity: a.integer(), // 実をもらったとき: もらったあとに持っている数
      gainedItems: a.integer(), // このチェックインでもらった実の数(1か0)
      firstVisit: a.boolean(), // ほかの人のタネに初めてチェックインした(拠点にタネが1個落ちた)
      water: a.integer(), // チェックインのあとのたまった水
      fruits: a.integer(), // チェックインのあとに残っている実の数
      level: a.integer(), // もらえたときのレベル
      leveledUp: a.boolean(), // このチェックインでレベルが上がったか
      seedsGained: a.json(), // 増えたタネ: { itemId, count, reason }[](reason: checkin / level)
      droppedSeeds: a.integer(), // チェックインのあと、この拠点に落ちているタネの数
      stage: a.integer(), // チェックインのあとの育ちの段階(growth.ts)
      rank: a.integer(), // チェックインのあとのランク
    }),

    // コースごとの遊んでいる人数(コース選びの画面に出す)
    TaneCourseCount: a.customType({
      course: a.string().required(),
      players: a.integer().required(),
    }),

    TaneGardenState: a.customType({
      width: a.integer().required(),
      height: a.integer().required(),
      objects: a.json().required(), // GardenObject[]
      items: a.json().required(), // { itemId, quantity }[]
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

    // 地図タネ: コースを選んで始める(もう始めていればそのまま返す)
    startTane: a
      .mutation()
      .arguments({ course: a.string().required() })
      .returns(a.ref("GameTanePlayer"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlayer)),

    // 地図タネ: コースごとの遊んでいる人数
    taneCourseCounts: a
      .query()
      .returns(a.ref("TaneCourseCount").array())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneStats)),

    // 地図タネ: いまいる地区にタネをまく。位置と、ブラウザで調べた市区町村(探す範囲を絞るためだけに使う)と、
    // まくタネ(もの。持っているタネが1つ減る)を送る
    placeTaneBase: a
      .mutation()
      .arguments({
        lng: a.float().required(),
        lat: a.float().required(),
        prefCode: a.string().required(),
        cityCode: a.string().required(),
        itemId: a.string().required(),
      })
      .returns(a.ref("GameTaneBase"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlace)),

    // 地図タネ: いまいる地区のタネにチェックインする
    checkInTaneBase: a
      .mutation()
      .arguments({
        lng: a.float().required(),
        lat: a.float().required(),
        prefCode: a.string().required(),
        cityCode: a.string().required(),
      })
      .returns(a.ref("TaneCheckInResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneCheckin)),

    // 地図タネ: 自分のタネに遠くから水をやる(1日1回、現地の10分の1)
    waterTaneBaseRemotely: a
      .mutation()
      .arguments({ areaKey: a.string().required() })
      .returns(a.ref("GameTaneBase"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneCheckin)),

    // 地図タネ: いまいる地区のタネ(拠点)に落ちているタネを、選んだ数だけ拾う(誰でも早い者勝ち)。拾えた数を返す
    pickUpTaneSeeds: a
      .mutation()
      .arguments({
        lng: a.float().required(),
        lat: a.float().required(),
        prefCode: a.string().required(),
        cityCode: a.string().required(),
        count: a.integer().required(),
      })
      .returns(a.integer())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneSeeds)),

    openTaneGarden: a
      .mutation()
      .returns(a.ref("TaneGardenState"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlayer)),

    // 配置を丸ごと保存する(所持数・範囲・1マス1個を Lambda で確かめる)
    saveTaneGarden: a
      .mutation()
      .arguments({ objects: a.json().required() })
      .returns(a.ref("TaneGardenState"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlayer)),

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
    allow.resource(setFollowing),
    allow.resource(chizuTanePlayer),
    allow.resource(chizuTanePlace),
    allow.resource(chizuTaneCheckin),
    allow.resource(chizuTaneSeeds),
    allow.resource(chizuTaneStats),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});
