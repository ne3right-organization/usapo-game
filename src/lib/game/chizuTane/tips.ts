// うさぽ農園を始めたばかりの人に、ホームを開いたときに出すヒント(ポップアップ。src/components/game/chizu-tane/TaneTipPopup.tsx)。
// ヒントごとに「もう済んだか」(done)と「いま出す意味があるか」(applies)を持ち、済んでいなくて今出せるもののうち、
// いちばん早い段階(stage)のものから1つをランダムに出す(始めたばかりの人に、いきなり友達のことを出さないように)。
// 全部済んだら、もう出さない。文・条件・段階・出す間隔はここで調整する

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
}

export interface TaneTip {
  id: string;
  /** 段階。小さいものから出す(1: はじめの遊び方、2: 畑の世話、3: 友達) */
  stage: number;
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

export function taneTips(s: TaneTipStatus): TaneTip[] {
  return [
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
  ];
}

/** 出すヒントを選ぶ: 済んでいなくて今出せるもののうち、いちばん早い段階のものから1つをランダムに。無ければ null */
export function pickTaneTip(tips: TaneTip[], s: TaneTipStatus): TaneTip | null {
  const candidates = tips.filter((t) => !t.done(s) && t.applies(s));
  if (candidates.length === 0) return null;
  const stage = Math.min(...candidates.map((t) => t.stage));
  const first = candidates.filter((t) => t.stage === stage);
  return first[Math.floor(Math.random() * first.length)];
}
