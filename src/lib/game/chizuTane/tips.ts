// うさぽ農園を始めたばかりの人に、ホームを開いたときに出すヒント(ポップアップ。src/components/game/chizu-tane/TaneTipPopup.tsx)。
// ヒントごとに「もう済んだか」(done)と「いま出す意味があるか」(applies)を持ち、済んでいなくて今出せるもののうち、
// いちばん早い段階(stage)のものから1つをランダムに出す(始めたばかりの人に、いきなり友達のことを出さないように)。
// ずっと済まないことがあるもの(通知・フォローなど)と、そのときだけ出すもの(宅急便など)は段階を止めず(nonBlocking)、
// その段階まで進んだら、いまの段階のものと一緒に出す。
// 全部済んだら、もう出さない。文・条件・段階・出す間隔はここで調整する

import { LOCAL_SEED_MIN_LEVEL } from "./localItems";

/** ヒントを選ぶのに使う、プレイの状況(TaneTipPopup が読んで作る) */
export interface TaneTipStatus {
  /** タネをまいたことがある(手放した畑も含む) */
  everPlanted: boolean;
  /** ほかの人のタネをたずねた数 */
  visited: number;
  /** チェックインしたことのある公式の畑の数 */
  official: number;
  /** フォローしている人の畑に手伝いの水をやった回数 */
  helps: number;
  /** 自分の畑に水をやったことがある(現地・遠くから。実ったことがあれば、やったことにする) */
  everWatered: boolean;
  /** いま遠くから水をやれる自分の畑がある(実っていない・タネ待ちでない・この時間帯にまだやっていない) */
  canWaterNow: boolean;
  /** 自分の畑の実を、自分で現地に行って収穫したことがある */
  everHarvestedOwn: boolean;
  /** いま実がなっている自分の畑がある */
  hasRipeField: boolean;
  followers: number;
  following: number;
  /** フォローしていて、自分に農園を見せてくれている人(手伝いの水やりができる相手)。いなければ null */
  helpTargetUserId: string | null;
  /** 農園を見せているフォロワーの数 */
  sharing: number;
  /**
   * この端末の通知: enabled(受け取る設定) / can-enable(オンにできる) / needs-install(iPhone のブラウザ。ホーム画面に追加したアプリでないと受け取れない) /
   * unsupported(対応していない・開発中)
   */
  push: "enabled" | "can-enable" | "needs-install" | "unsupported";
  /** おすそ分けの棚に一度でも出したことがある */
  everStocked: boolean;
  /** ニックネームを決めている */
  hasNickname: boolean;
  /** タネ待ちの畑にタネをまき直したことがある */
  everReplanted: boolean;
  /** タネ待ちの自分の畑がある */
  hasWaitingField: boolean;
  /** 宅急便で回収できる自分の畑がある */
  canDeliver: boolean;
  /** たずねた数は足りているのに、まだまいていないタネがあってレベルが上がらない。そのタネの名前(無ければ空) */
  unplantedForLevel: string[];
  /** 3日以内に枯れる自分の畑がある */
  witherSoon: boolean;
  /** レベル */
  level: number;
  /** 実を1つでも手に入れたことがある(アイコンに選べるものがある) */
  hasFruit: boolean;
  /** アイコンを選んでいる */
  hasIcon: boolean;
  /** ご当地のタネをまいたことがある(手放した畑も含む) */
  everPlantedLocal: boolean;
  /** 毎日のガチャを引いたことがある */
  everDrewGacha: boolean;
}

export interface TaneTip {
  id: string;
  /** 段階。小さいものから出す(1: はじめの遊び方、2: 畑の世話、3: 友達、4: もっと楽しむ) */
  stage: number;
  /**
   * 段階を止めない。本人の気持ちや友達の有無しだいでずっと済まないことがあるもの(通知・フォローなど)と、
   * そのときだけ出すもの(宅急便など。済むことがない)。いまの段階を決めるときには数えず、
   * いまの段階がそのヒントの段階まで進んだら、いまの段階のヒントと一緒にくじに入れる
   */
  nonBlocking?: boolean;
  emoji: string;
  title: string;
  /** 本文(段落ごと) */
  body: string[];
  /** 下のボタン。href ならそこへ移り、anchor ならホームのその場所までスクロールする。無ければ「閉じる」だけ */
  action?: { label: string; href?: string; anchor?: string };
  done: (s: TaneTipStatus) => boolean;
  applies: (s: TaneTipStatus) => boolean;
}

/** 一度閉じてから、次にヒントを出すまでの間(ホームを開くたびに出ると、うるさいので) */
export const TANE_TIP_INTERVAL_MS = 3 * 3_600_000;

/** ホームの公式の畑のところ(OfficialFields)。ヒントのボタンから、ここまでスクロールする */
export const OFFICIAL_FIELDS_ANCHOR = "official-fields";

/** ホームの毎日のガチャ(DailyGacha)。ヒントのボタンから、ここまでスクロールする */
export const DAILY_GACHA_ANCHOR = "daily-gacha";

/** ホームのホーム画面への追加と通知の案内(InstallHint)。ヒントのボタンから、ここまでスクロールする */
export const INSTALL_HINT_ANCHOR = "install-hint";

export function taneTips(s: TaneTipStatus): TaneTip[] {
  return [
    {
      id: "nickname",
      stage: 1,
      nonBlocking: true,
      emoji: "✏️",
      title: "ニックネームを決めよう",
      body: [
        "設定の画面で、ニックネームを決められます。",
        "友達とフォローし合うには、お互いにニックネームが要ります。ランキングにもこの名前で出ます。",
      ],
      action: { label: "✏️ 設定を開く", href: "/nickname" },
      done: (s) => s.hasNickname,
      applies: () => true,
    },
    {
      // なぞのタネのことは秘密なので書かない
      id: "gacha",
      stage: 1,
      nonBlocking: true,
      emoji: "🎁",
      title: "毎日ガチャを引こう",
      body: [
        "ホームの「今日のガチャ」は1日1回引けて、タネか実がもらえます。土日祝は朝・昼・夜に1回ずつ引けて、当たりも出やすくなります。",
        "ホームを開いたら、まず引いてみましょう。",
      ],
      action: { label: "🎁 ガチャを見る", anchor: DAILY_GACHA_ANCHOR },
      done: (s) => s.everDrewGacha,
      applies: () => true,
    },
    {
      id: "outing",
      stage: 1,
      emoji: "🚶",
      title: "おでかけしてみよう",
      body: [
        "タブの「おでかけ」で、いまいる地区のタネをたずねたり、自分のタネをまいたりできます。",
        "まいた畑の場所はほかの人にも見えます。自宅ではなく、出かけた先（駅・公園・お店の近くなど）でまくのがおすすめです。",
      ],
      action: { label: "🚶 おでかけする", href: "/game/chizu-tane/here" },
      done: (s) => s.everPlanted || s.visited > 0,
      applies: () => true,
    },
    {
      id: "water",
      stage: 2,
      emoji: "💧",
      title: "畑に水をやろう",
      body: [
        "まいたタネは、水をやると育って実がなります。",
        "畑に行ってチェックインすると、たくさん水をやれます。行けないときは、ホームの「あなたの畑」から遠くから水をやれます（朝・昼・夜に1回ずつ）。",
      ],
      done: (s) => s.everWatered,
      applies: (s) => s.canWaterNow,
    },
    // 通知。iPhone のブラウザでは受け取れないので、先にホーム画面に追加してもらう。
    s.push === "needs-install"
      ? {
          id: "push",
          nonBlocking: true,
          stage: 2,
          emoji: "📲",
          title: "ホーム画面に追加して、通知を受け取ろう",
          body: [
            "畑に誰かが来た・実った・枯れそうなどを、通知で知らせます。iPhone では、ホーム画面に追加したアプリでだけ通知を受け取れます。",
            "Safari の共有ボタン（□に↑）から「ホーム画面に追加」を選び、追加したアプリから開いて、設定で通知をオンにしてください。",
          ],
          action: { label: "📲 追加のしかたを見る", anchor: INSTALL_HINT_ANCHOR },
          done: () => false,
          applies: () => true,
        }
      : {
          id: "push",
          nonBlocking: true,
          stage: 2,
          emoji: "🔔",
          title: "通知をオンにしよう",
          body: [
            "畑に誰かが来た・実った・枯れそうなどを、通知で知らせます。放っておいた畑は枯れることがあるので、オンにしておくと安心です。",
            "設定の画面で、この端末の通知をオンにできます。",
          ],
          action: { label: "🔔 設定を開く", href: "/nickname" },
          done: (s) => s.push === "enabled",
          applies: (s) => s.push === "can-enable",
        },
    {
      id: "official",
      stage: 1,
      emoji: "🏛️",
      title: "公式の畑でタネをもらおう",
      body: [
        "ホームの下にある「公式の畑」には、遠くからチェックインできます。",
        "初めての畑にチェックインすると、タネが1個落ちます。拾うと自分のタネになり、たずねた畑の数にも数えられてレベルが上がります。",
      ],
      action: { label: "🏛️ 公式の畑を見る", anchor: OFFICIAL_FIELDS_ANCHOR },
      done: (s) => s.official > 0,
      applies: () => true,
    },
    {
      id: "harvest",
      nonBlocking: true,
      stage: 2,
      emoji: "🍎",
      title: "実がなっています",
      body: [
        "あなたの畑に実がなりました。畑に行ってチェックインすると、実を収穫できます。",
        "実はほかの人も取りに来ます。全部取られる前に、収穫しに行きましょう。",
      ],
      action: { label: "🚶 畑に行く（おでかけ）", href: "/game/chizu-tane/here" },
      done: (s) => s.everHarvestedOwn,
      applies: (s) => s.hasRipeField,
    },
    {
      id: "followers",
      nonBlocking: true,
      stage: 3,
      emoji: "📮",
      title: "友達にフォローしてもらおう",
      body: [
        "ガーデンの画面の下から、フォローしてもらうリンクを友達に送れます。",
        "リンクを開いた友達は、あなたのガーデンや畑を見に来て、畑に水をやって手伝えるようになります。",
      ],
      action: { label: "📮 リンクを送る", href: "/game/chizu-tane/garden#follow-link" },
      done: (s) => s.followers > 0,
      applies: () => true,
    },
    {
      id: "following",
      nonBlocking: true,
      stage: 3,
      emoji: "🤝",
      title: "友達をフォローしよう",
      body: [
        "友達からフォローしてもらうリンクを送ってもらい、開くと、その友達をフォローできます。",
        "フォローすると、友達のガーデンを見に行ったり、畑に水をやって手伝ったりできます。",
      ],
      action: { label: "🔗 自分のリンクも送る", href: "/game/chizu-tane/garden#follow-link" },
      done: (s) => s.following > 0,
      applies: () => true,
    },
    {
      id: "share",
      nonBlocking: true,
      stage: 3,
      emoji: "🌱",
      title: "友達に農園を見せよう",
      body: [
        "はじめは、フォロワーの誰にも農園を見せていません。見せると、その友達があなたのガーデンを見に来たり、畑に水をやって手伝ったり、おすそ分けの棚からもらったりできるようになります。",
        "フォロワーの一覧で、見せる友達を1人ずつ選べます（畑の場所も分かるので、知っている人だけにしましょう）。",
      ],
      action: { label: "🌱 見せる人を選ぶ", href: "/profile/follows" },
      done: (s) => s.sharing > 0,
      applies: (s) => s.followers > 0,
    },
    {
      id: "help",
      stage: 3,
      emoji: "🪣",
      title: "友達の畑に水をやろう",
      body: [
        "フォローしている友達のガーデンの画面の下から、友達の畑に遠くから水をやれます。",
        "手伝った回数も、たずねた畑の数に数えられます。",
      ],
      action: s.helpTargetUserId ? { label: "🏡 友達のガーデンへ", href: `/game/chizu-tane/garden/${s.helpTargetUserId}` } : undefined,
      done: (s) => s.helps > 0,
      applies: (s) => s.helpTargetUserId !== null,
    },
    {
      id: "icon",
      stage: 4,
      emoji: "🖼️",
      title: "アイコンを選ぼう",
      body: [
        "集めた実から1つ選んで、自分のアイコンにできます。フォローの一覧などで、ニックネームの横に出ます。",
        "「集めたもの」の画面で実をタップして、「これをアイコンにする」を押します。",
      ],
      action: { label: "🧺 集めたものを見る", href: "/game/chizu-tane/collection" },
      done: (s) => s.hasIcon,
      applies: (s) => s.hasFruit,
    },
    {
      id: "local",
      stage: 4,
      emoji: "🗾",
      title: "ご当地のタネをまこう",
      body: [
        `Lv.${LOCAL_SEED_MIN_LEVEL} になると、おでかけした先の都道府県で、その県にしかないご当地のタネがもらえます（おでかけの画面のボタンから。1つの都道府県に1回）。`,
        "ご当地のタネは、その県の中の空き地にまけます。旅行や遠出のときに、ぜひまいてみてください。",
      ],
      action: { label: "🚶 おでかけする", href: "/game/chizu-tane/here" },
      done: (s) => s.everPlantedLocal,
      applies: (s) => s.level >= LOCAL_SEED_MIN_LEVEL,
    },
    {
      id: "shelf",
      stage: 4,
      emoji: "🧺",
      title: "おすそ分けの棚に出そう",
      body: [
        "余ったタネや実を、ガーデンの画面の「おすそ分けの棚」に出しておくと、農園を見せている友達が遠くから1日1個ずつ持っていけます。",
        "出したものは手元から減ります（戻すこともできます）。",
      ],
      action: { label: "🧺 ガーデンへ", href: "/game/chizu-tane/garden" },
      done: (s) => s.everStocked,
      applies: (s) => s.sharing > 0,
    },
    // ここから下は段階4まで進んだ人に、当てはまるときだけ出すもの
    {
      id: "rank",
      stage: 4,
      nonBlocking: true,
      emoji: "⭐",
      title: "畑のランクを上げよう",
      body: [
        "実が全部収穫された畑は、ランクが1つ上がって「タネ待ち」になります。ホームの「あなたの畑」から（遠くからでも）タネをまき直すと、次はもっとたくさん実ります（ランク×10個）。",
        "1日まき直さないと、現地に来たほかの人も自分のタネをまけるようになり、その人の畑になってしまいます。",
      ],
      done: (s) => s.everReplanted,
      applies: (s) => s.hasWaitingField,
    },
    {
      id: "deliver",
      stage: 4,
      nonBlocking: true,
      emoji: "🚚",
      title: "宅急便で実を回収できます",
      body: [
        "実ってから1週間たった畑は、ホームの「あなたの畑」から、残りの実を宅急便で全部回収できます（畑は空き地に戻ります）。",
        "そのままにしておくと、やがて実が腐り落ちてしまいます。",
      ],
      done: () => false,
      applies: (s) => s.canDeliver,
    },
    {
      id: "wither",
      stage: 4,
      nonBlocking: true,
      emoji: "🥀",
      title: "枯れそうな畑があります",
      body: [
        "しばらく水が入っていない畑は、枯れて空き地に戻ってしまいます。",
        "ホームの「あなたの畑」から、遠くから水をやれば大丈夫です。",
      ],
      done: () => false,
      applies: (s) => s.witherSoon,
    },
    {
      id: "level",
      stage: 4,
      nonBlocking: true,
      emoji: "⬆️",
      title: "レベルを上げるには",
      body: [
        "たずねた畑の数は足りています。レベルを上げるには、いまのレベルの種類のタネを、3つとも一度はまく必要があります。",
        s.unplantedForLevel.length > 0 ? `まだまいていないタネ: ${s.unplantedForLevel.join("・")}` : "",
      ].filter(Boolean),
      action: { label: "🚶 おでかけしてまく", href: "/game/chizu-tane/here" },
      done: () => false,
      applies: (s) => s.unplantedForLevel.length > 0,
    },
  ];
}

/**
 * 出すヒントを選ぶ: 済んでいなくて今出せるもののうち、いちばん早い段階のものから1つをランダムに。無ければ null。
 * 段階は、段階を止めないもの(nonBlocking)を除いて決める。段階を止めないものは、その段階まで進んでいれば一緒にくじに入れる
 * (ほかが全部済んだら、段階を止めないものだけから選ぶ)
 */
export function pickTaneTip(tips: TaneTip[], s: TaneTipStatus): TaneTip | null {
  const candidates = tips.filter((t) => !t.done(s) && t.applies(s));
  const blocking = candidates.filter((t) => !t.nonBlocking);
  const stage = blocking.length > 0 ? Math.min(...blocking.map((t) => t.stage)) : Infinity;
  const pool = candidates.filter((t) => (t.nonBlocking ? t.stage <= stage : t.stage === stage));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
