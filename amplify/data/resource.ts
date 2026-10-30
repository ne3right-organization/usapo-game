import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { chizuTaneCheckin } from "../functions/chizu-tane-checkin/resource";
import { chizuTanePlace } from "../functions/chizu-tane-place/resource";
import { chizuTanePlayer } from "../functions/chizu-tane-player/resource";
import { chizuTaneSeeds } from "../functions/chizu-tane-seeds/resource";
import { chizuTaneShelf } from "../functions/chizu-tane-shelf/resource";
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
        // アイコン(うさぽ農園で集めたもの1つの itemId。2026-10-31)。フォローの一覧などで、ニックネームの横に出す。
        // 書くのは chizu-tane-player の setTaneIcon(集めたことのあるものかを確かめる)
        iconItemId: a.string(),
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

    // ─── PWA の通知 ─────────────────────────────────────────────────────────
    // 通知の購読(ブラウザ・端末ごと)。endpoint は通知の届け先の URL。本人が画面から作る・消す(自分の分しか触れない)。
    // update は許さない(userId をほかの人に書き換えて、その人宛ての通知を自分の端末で受け取れてしまうため)。
    // 送るのは Lambda(amplify/functions/shared/push.ts)で、期限切れの購読はそこで消す
    GamePushSubscription: a
      .model({
        userId: a.id().required(),
        endpoint: a.string().required(),
        p256dh: a.string().required(),
        auth: a.string().required(),
      })
      .identifier(["userId", "endpoint"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["create", "read", "delete"])]),

    // 届いた通知(ユーザーごと)。通知の一覧(/notifications)に出す。端末で通知を受け取っていなくても残す。
    // 書くのは通知を送る Lambda(amplify/functions/shared/push.ts)。最新の1日分だけ残し、古いものは expiresAt(TTL)で DynamoDB が消す
    // (消えるまで少し時間がかかることがあるので、画面でも1日より古いものは出さない)。noticeId = `${送った日時}#${乱数}`
    GameNotification: a
      .model({
        userId: a.id().required(),
        noticeId: a.string().required(),
        title: a.string().required(),
        body: a.string().required(),
        url: a.string().required(),
        notifiedAt: a.datetime().required(),
        expiresAt: a.integer().required(), // TTL(UNIX秒)
      })
      .identifier(["userId", "noticeId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

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
        // フォローしている人の畑に遠くから水をやった回数(手伝い)。HELPS_PER_VISIT 回で、たずねたタネ1か所と数える(courses.ts の levelVisitCount)
        helpCount: a.integer(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 拠点(画面では「タネ」)。1地区に1つで、主キーは町丁のコード(e-Stat 小地域の KEY_CODE)。cityKey = `${prefCode}${cityCode}`
    // ログインしていれば誰でも読めるので、**持ち主の ID は持たない**(持たせると、プロフィールの URL などから分かる ID で
    // その人のタネの場所を全部たどれてしまう。生活圏が分かる)。持ち主は本人しか読めない GameTaneOwnership に持つ
    GameTaneBase: a
      .model({
        areaKey: a.string().required(),
        cityKey: a.string().required(),
        prefCode: a.string().required(),
        prefName: a.string().required(),
        cityCode: a.string().required(),
        cityName: a.string().required(),
        townName: a.string().required(),
        baseTypeId: a.string().required(),
        seedItemId: a.string().required(), // まいたタネのもの(梨の木など)。訪ねた人はこれをもらう
        rank: a.integer().required(), // 実が全部取られてタネ待ちになるたびに1つ上がる(10まで)
        plantedAt: a.datetime().required(),
        // 地区の代表点(geojson の X_CODE / Y_CODE)。全国のタネ地図に出す。まいた人の実際の位置は保存しない
        repLng: a.float(),
        repLat: a.float(),
        // 育ち方(src/lib/game/chizuTane/growth.ts)。water はたまった水(現地のチェックイン1回で10、遠くからの水やりで1)。
        // たまると実って fruits(残っている実の数)がランク×10になり、実が全部取られると water を0に戻してタネ待ちになる
        water: a.integer(),
        fruits: a.integer(),
        // いまなっている実が実った日時(実が全部取られたら消す)。収穫の記録に「実がなった日」として写す
        ripenedAt: a.datetime(),
        // 持ち主が最後に遠くから水をやった時間帯(朝・昼・夜に1回。src/lib/game/chizuTane/geo.ts の slotKey。dev は5分ごと)
        lastRemoteWaterOn: a.string(),
        // 落ちているタネ(まかれたタネと同じもの)。ほかの人のチェックインのたびに1個落ち、3個まで。誰でも早い者勝ちで拾える
        droppedSeeds: a.integer(),
        // 持ち主が最後に自分のタネにチェックインした時間帯(slotKey)。朝・昼・夜に1回(自分のタネは訪問の記録に残さず、レベルにも数えない)
        lastOwnerVisitOn: a.string(),
        // 実が全部取られて、持ち主がタネをまき直すのを待ち始めた日時(まき直したら消す)。
        // 1週間(growth.ts の REPLANT_LIMIT_SLOTS)まかなければ空き地に戻り、誰でもまける(行は新しくまいた人が上書きする)
        waitingSince: a.datetime(),
      })
      .identifier(["areaKey"])
      .secondaryIndexes((index) => [
        index("cityKey").queryField("listTaneBasesByCity"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    // 拠点の持ち主(ユーザー×拠点)。本人しか読めない(自分のタネの一覧・自分のタネかどうか)。書くのはタネをまく Lambda。
    // Lambda は areaKey から持ち主を引く(listTaneOwnershipByArea。画面から引いても、自分の分しか返らない)
    GameTaneOwnership: a
      .model({
        ownerId: a.id().required(),
        areaKey: a.string().required(),
        seedItemId: a.string().required(), // いままいているタネのもの
        // 前にこの畑にまいたタネ(まき直すたびに足す)。seedItemId と合わせて、レベルの条件「今のレベルのタネを3つともまいたか」に使う
        pastSeedItemIds: a.string().array(),
        plantedAt: a.datetime().required(),
        // タネ待ちのまま空き地に戻り、ほかの人がまいて手放した日時。手放した行も、開拓した地区の数(ガーデン)や
        // まいたことのあるタネ(レベル)には数え続けるので消さない。持ち主を引くときは、これの無い行を見る
        releasedAt: a.datetime(),
      })
      .identifier(["ownerId", "areaKey"])
      .secondaryIndexes((index) => [index("areaKey").queryField("listTaneOwnershipByArea")])
      .authorization((allow) => [allow.ownerDefinedIn("ownerId").identityClaim("sub").to(["read"])]),

    // うさぽ農園を見せるフォロワー(持ち主×見せる相手)。行があり、かつ相手が持ち主をフォローしている間だけ、
    // その持ち主のガーデンを見られ、実の詳細の「生産者」にニックネームが出る(はじめは誰にも見せない)。
    // 見せる相手の側から「誰が見せてくれているか」を引けるよう、viewerId でも引ける
    // 持ち主が画面から作る・消す。見せる相手も読める(自分に見せてくれているか)。update は許さない(持ち主を書き換えられないように)
    GameTaneShare: a
      .model({
        ownerId: a.id().required(),
        viewerId: a.id().required(),
      })
      .identifier(["ownerId", "viewerId"])
      .secondaryIndexes((index) => [index("viewerId").queryField("listTaneSharesByViewer")])
      .authorization((allow) => [
        allow.ownerDefinedIn("ownerId").identityClaim("sub").to(["create", "read", "delete"]),
        allow.ownerDefinedIn("viewerId").identityClaim("sub").to(["read"]),
      ]),

    // 訪問(ユーザー×拠点)。lastReceivedOn は最後に来た時間帯(slotKey)で、朝・昼・夜に1回の判定に使う。
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

    // 手伝いの水やり(手伝った人×拠点)。lastWaterOn は最後に水をやった時間帯(slotKey)で、1つの畑に朝・昼・夜に1回の判定に使う。
    // 書くのも読むのも Lambda だけ(クライアントからは読ませない。誰も入っていない admin グループ)
    GameTaneHelp: a
      .model({
        helperId: a.id().required(),
        areaKey: a.string().required(),
        lastWaterOn: a.string().required(),
      })
      .identifier(["helperId", "areaKey"])
      .authorization((allow) => [allow.group("admin")]),

    // おすそ分けの棚(持ち主×もの。2026-10-31)。持ち主が余ったタネや実を手元から出しておき、持ち主が「農園を見せる」にした
    // フォロワーが遠くから1日1個持っていける。shelfKey は `${kind}#${itemId}`(kind は seed / fruit)。
    // 本人だけ読める(ほかの人の棚は Lambda が確かめてから返す)。数は早い者勝ちなので、Lambda が DynamoDB で直接(条件付きで)書き換える
    GameTaneShelf: a
      .model({
        ownerId: a.id().required(),
        shelfKey: a.string().required(),
        kind: a.string().required(),
        itemId: a.string().required(),
        quantity: a.integer().required(),
      })
      .identifier(["ownerId", "shelfKey"])
      .authorization((allow) => [allow.ownerDefinedIn("ownerId").identityClaim("sub").to(["read"])]),

    // おすそ分けの棚から最後にもらった日(もらった人×持ち主)。1人が1つの棚から1日1個の判定に使う。Lambda だけが読み書きする
    GameTaneShelfTake: a
      .model({
        takerId: a.id().required(),
        ownerId: a.id().required(),
        lastTakenOn: a.string().required(),
      })
      .identifier(["takerId", "ownerId"])
      .authorization((allow) => [allow.group("admin")]),

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
        // 生産者(そのタネをまいた人)。ID だけではタネの場所はたどれない。ニックネームは、生産者が見せている相手にだけ出す
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

    // ご当地のタネをもらった記録(ユーザー×都道府県。docs/地図タネ_ご当地タネ設計書.md の 3章)。1個目 → 2個目 → 3個目を、それぞれ1回だけ渡すため。
    // 1個目はその都道府県で「おでかけ」したときに本人が受け取り(claimLocalTaneSeed)、2個目は1個目の畑が実ったとき、
    // 3個目は2個目の畑の実が全部収穫されたときに、チェックインの Lambda が持ち主に渡す。course はもらったときのコース
    GameTaneLocalGrant: a
      .model({
        userId: a.id().required(),
        prefCode: a.string().required(),
        course: a.string().required(),
        firstAt: a.datetime().required(),
        secondAt: a.datetime(),
        thirdAt: a.datetime(),
      })
      .identifier(["userId", "prefCode"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    // 箱庭(画面では「ガーデン」。1人1つ)。objects は GardenObject(src/lib/game/chizuTane/garden.ts)の配列。
    // 10×10マスで1マス1個なら最大100個なので1行に収まり、保存も1回で済む。
    // 本人しか読めない。ほかの人のガーデンは、持ち主が「農園を見せる」にしている相手にだけ Lambda が返す(viewTaneGarden)
    GameTaneGarden: a
      .model({
        userId: a.id().required(),
        width: a.integer().required(),
        height: a.integer().required(),
        objects: a.json().required(), // おうちの庭(はじめからあるガーデン)
        // 開拓した地区の数で増えるほかのガーデンの配置({ flower: GardenObject[], ... }。src/lib/game/chizuTane/garden.ts の GardenLayouts)
        layouts: a.json(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"])]),

    TaneCheckInResult: a.customType({
      // watered(水をやった) / ripened(水をやって実った) / fruit(実をもらった) / have(ご当地の実で、もう持っているのでもらわなかった) /
      // waiting(タネ待ちの畑) / already(この時間帯はもう来た)
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

    // フォローしている人の畑(手伝いの水やりの一覧)。fieldId は畑をまいた日時(畑の目印)。
    // 地区も出す(全国農地と見比べれば地区は分かってしまうので隠さない。見せる相手は持ち主が選んでいる)
    TaneHelpField: a.customType({
      fieldId: a.string().required(),
      prefName: a.string().required(),
      cityName: a.string().required(),
      townName: a.string().required(),
      baseTypeId: a.string().required(),
      seedItemId: a.string().required(),
      rank: a.integer().required(),
      water: a.integer(),
      fruits: a.integer(),
      waitingSince: a.datetime(),
      wateredThisSlot: a.boolean().required(), // この時間帯にもう水をやった
    }),

    TaneHelpResult: a.customType({
      field: a.ref("TaneHelpField").required(),
      ripened: a.boolean().required(), // この水やりで実った
      helpCount: a.integer().required(), // 手伝った回数(合計)
      level: a.integer(),
      leveledUp: a.boolean(),
      seedsGained: a.json(), // 増えたタネ: { itemId, count, reason }[](reason: level)
    }),

    // おすそ分けの棚。items は { kind, itemId, quantity }[](kind は seed / fruit)。takenToday はほかの人の棚を見たとき、今日もうもらったか
    TaneShelfView: a.customType({
      items: a.json().required(),
      takenToday: a.boolean().required(),
    }),

    // コースごとの遊んでいる人数(コース選びの画面に出す)
    TaneCourseCount: a.customType({
      course: a.string().required(),
      players: a.integer().required(),
    }),

    // ほかの人のガーデン(見るだけ)。nickname は持ち主のニックネーム
    TaneGardenView: a.customType({
      nickname: a.string(),
      width: a.integer().required(),
      height: a.integer().required(),
      objects: a.json().required(), // おうちの庭の GardenObject[]
      layouts: a.json().required(), // ほかのガーデン(GardenLayouts)
      level: a.integer().required(), // 持ち主のレベル(家と柵の見た目)
      plantedCount: a.integer().required(), // 持ち主が開拓した地区の数(使えるガーデン)
    }),

    TaneGardenState: a.customType({
      width: a.integer().required(),
      height: a.integer().required(),
      objects: a.json().required(), // おうちの庭の GardenObject[]
      layouts: a.json().required(), // ほかのガーデン(GardenLayouts)
      items: a.json().required(), // { itemId, quantity }[]
      level: a.integer().required(), // レベル(家と柵の見た目)
      plantedCount: a.integer().required(), // 開拓した地区の数(使えるガーデン)
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

    // 地図タネ: タネ待ちの自分の畑に、同じ種類の畑のタネをまき直す(遠くからでもよい)。持っているタネが1つ減る
    replantTaneBase: a
      .mutation()
      .arguments({ areaKey: a.string().required(), itemId: a.string().required() })
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

    // 地図タネ: 自分のタネに遠くから水をやる(朝・昼・夜に1回ずつ、現地の10分の1)
    waterTaneBaseRemotely: a
      .mutation()
      .arguments({ areaKey: a.string().required() })
      .returns(a.ref("GameTaneBase"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneCheckin)),

    // 地図タネ: フォローしていて、自分に「農園を見せる」にしている人の畑の一覧(手伝いの水やり用)
    listTaneHelpFields: a
      .query()
      .arguments({ ownerId: a.id().required() })
      .returns(a.ref("TaneHelpField").array())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneCheckin)),

    // 地図タネ: フォローしている人の畑に遠くから水をやる(手伝い。持ち主の遠くからの水やりと同じく、1つの畑に朝・昼・夜に1回、現地の10分の1)
    helpWaterTaneBase: a
      .mutation()
      .arguments({ ownerId: a.id().required(), fieldId: a.string().required() })
      .returns(a.ref("TaneHelpResult"))
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

    // 地図タネ: いまいる都道府県の1個目のご当地のタネをもらう(Lv.3 以上、1人1都道府県に1回、自分のコースのもの)。もらったタネの itemId を返す
    claimLocalTaneSeed: a
      .mutation()
      .arguments({
        lng: a.float().required(),
        lat: a.float().required(),
        prefCode: a.string().required(),
        cityCode: a.string().required(),
      })
      .returns(a.string())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneSeeds)),

    // 地図タネ: おすそ分けの棚を見る(ownerId を省くと自分の棚。ほかの人の棚は、その人が自分に「農園を見せる」にしていて、自分がその人をフォローしているときだけ)
    taneShelf: a
      .query()
      .arguments({ ownerId: a.id() })
      .returns(a.ref("TaneShelfView"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneShelf)),

    // 地図タネ: 自分のおすそ分けの棚に、手元のタネ・実を出す(count > 0)・手元に戻す(count < 0)。kind は seed / fruit
    stockTaneShelf: a
      .mutation()
      .arguments({ kind: a.string().required(), itemId: a.string().required(), count: a.integer().required() })
      .returns(a.ref("TaneShelfView"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneShelf)),

    // 地図タネ: ほかの人のおすそ分けの棚から1個もらう(1人が1つの棚から1日1個、早い者勝ち)
    takeFromTaneShelf: a
      .mutation()
      .arguments({ ownerId: a.id().required(), kind: a.string().required(), itemId: a.string().required() })
      .returns(a.ref("TaneShelfView"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTaneShelf)),

    // 地図タネ: 集めたものから1つ選んでアイコンにする(itemId を省くとアイコンを外す)。設定したアイコンの itemId を返す
    setTaneIcon: a
      .mutation()
      .arguments({ itemId: a.string() })
      .returns(a.string())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlayer)),

    // ほかの人のガーデンを見る(見るだけ)。持ち主が自分に「農園を見せる」にしていて、自分が持ち主をフォローしているときだけ返す
    viewTaneGarden: a
      .query()
      .arguments({ ownerId: a.id().required() })
      .returns(a.ref("TaneGardenView"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlayer)),

    openTaneGarden: a
      .mutation()
      .returns(a.ref("TaneGardenState"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(chizuTanePlayer)),

    // 1つのガーデンの配置を丸ごと保存する(所持数はすべてのガーデンを合わせて・範囲・1マス1個・使えるガーデンかを Lambda で確かめる)。
    // gardenId は garden.ts の GardenDesignId(省略するとおうちの庭)
    saveTaneGarden: a
      .mutation()
      .arguments({ objects: a.json().required(), gardenId: a.string() })
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
    allow.resource(chizuTaneShelf),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});
