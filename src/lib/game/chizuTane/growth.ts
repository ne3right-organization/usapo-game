// 地図タネの、まいたタネ(拠点)の育ち方。画面と Lambda の両方から使う(ブラウザ・Node のどちらにも依存しない)。
// 設計書は docs/地図タネ_全体設計書.md の 5.1・5.5。
//
// まく → タネ → 芽 → 若葉 → つぼみ → 花 → 実り。時間では育たず、必ず水をやって育つ(芽が出るのも水)。
// 水は、現地のチェックイン(持ち主でもほかの人でも。チェックイン＝水やり)1回で10、持ち主が遠くからやると1(10分の1)。
// たまった水が WATER_TO_RIPE になると実って、実が FRUITS_WHEN_RIPE 個できる。実は現地にチェックインした人が誰でも1個ずつもらえ
// (1人1つの時間帯に1回、早い者勝ち)、全部なくなるとランクが1つ上がって「タネ待ち」になる。実っている間は水をやっても変わらない。
// タネ待ちの畑は、持ち主がタネをまき直すと、またタネから育つ(遠くからでもまける。どのタネでもよく、畑はそのタネの種類になる)。
// 1日まき直さなければ現地に来たほかの人もまけるようになり、1週間まかなければ空き地に戻る(定期実行の chizu-tane-sweep が行を消す)。
// 実ったまま・水が入らないまま放っておかれた畑も、いずれ空き地に戻る(下の「畑の終わり方」)。
// 実の数はランクとともに増える(ランク1は10個、ランク2は20個…。人が来て育ててくれた畑ほど豊かになる)

export interface GrowthStage {
  label: string;
  emoji: string;
}

/** 段階。まいたばかりはタネで、最後が実り */
export const GROWTH_STAGES: GrowthStage[] = [
  { label: "タネ", emoji: "🌰" },
  { label: "芽", emoji: "🌱" },
  { label: "若葉", emoji: "🌿" },
  { label: "つぼみ", emoji: "🌼" },
  { label: "花", emoji: "🌸" },
  { label: "実り", emoji: "✨" },
];
export const RIPE_STAGE = GROWTH_STAGES.length - 1;

/** 現地のチェックイン1回の水と、遠くからの水やり1回の水(仮) */
export const WATER_ONSITE = 10;
export const WATER_REMOTE = 1;
/** これだけたまると実る(現地なら5回、遠くからなら50回。仮) */
export const WATER_TO_RIPE = WATER_ONSITE * RIPE_STAGE;
/** ランク1で実ったときにできる実の数(仮)。ランクが1つ上がるごとにこれだけ増える */
export const FRUITS_WHEN_RIPE = 10;

/** そのランクで実ったときにできる実の数 */
export function fruitsWhenRipe(rank: number): number {
  return FRUITS_WHEN_RIPE * Math.max(1, rank);
}
/** ランクの上限(コースの表の10段階) */
export const MAX_RANK = 10;

export interface GrowingBase {
  water?: number | null;
  fruits?: number | null;
  /** 実が全部取られて、持ち主がタネをまき直すのを待っている(待ち始めた日時) */
  waitingSince?: string | null;
}

const DAY = 24 * 3_600_000;

/** タネ待ちの畑が空き地に戻るまで(1週間)。畑の終わり方(下)と同じく、dev でも本番と同じ長さ */
export const REPLANT_LIMIT_MS = 7 * DAY;

/** タネ待ち(実が全部取られて、まき直しを待っている)か */
export function isWaitingReplant(base: GrowingBase): boolean {
  return !!base.waitingSince;
}

/**
 * タネ待ちの畑を、持ち主だけがまき直せる区切りの数(朝・昼・夜の3つ = 1日。dev は区切りが5分なので15分)。
 * 過ぎると、現地に来たほかの人も自分のタネをまけるようになり、まいた人の畑になる(2026-11-02)。
 * 最後の実を取った人がその場で畑を取れてしまわないように、持ち主がまき直す間を空けている
 */
export const OWNER_PRIORITY_SLOTS = 3;

/**
 * タネ待ちの畑に、ほかの人もまけるようになる日時(タネ待ちでなければ null)。
 * ご当地の畑はタネ待ちにならず、実が全部取られたら消える(2026-11-02)
 */
export function openToOthersAt(base: GrowingBase, slotMs: number): Date | null {
  if (!base.waitingSince) return null;
  return new Date(Date.parse(base.waitingSince) + OWNER_PRIORITY_SLOTS * slotMs);
}

/** タネ待ちの畑が空き地に戻る日時(タネ待ちでなければ null) */
export function replantDeadline(base: GrowingBase): Date | null {
  if (!base.waitingSince) return null;
  return new Date(Date.parse(base.waitingSince) + REPLANT_LIMIT_MS);
}

/** タネ待ちのまま期限が過ぎた(空き地に戻す)か */
export function isAbandoned(base: GrowingBase, now: Date): boolean {
  const deadline = replantDeadline(base);
  return deadline !== null && deadline.getTime() <= now.getTime();
}

// ─── 畑の終わり方(2026-11-05) ─────────────────────────────────────────────
// 放っておかれた畑がいつまでも地区をふさがないよう、次のときは空き地に戻す。期限を過ぎたかは、定期実行の Lambda(chizu-tane-sweep。
// 水やりの区切りと同じ1日3回、dev は5分ごと)が見て、行を消して持ち主に知らせる(画面・ほかの Lambda は期限を見ない。期限から次の定期実行までは残っている)。
// 期限が近づいたときも知らせる(fieldNotice)。
// 期限の長さは dev でも本番と同じ(水やりの区切りのように dev だけ短くすると、試しに作った畑がすぐ消えてしまうため。
// dev で試すときは、DynamoDB の日時を書き換える)。
// - 実って1週間(DELIVERY_AFTER_MS)たつと、持ち主は遠くから「宅急便」で残りの実を全部回収できる(回収すると畑は空き地に戻り、ランクも無くなる)
// - 宅急便で回収できるようになってから1か月(ROT_AFTER_MS)たつと、実が腐り落ちて空き地に戻る
// - 実っていない畑は、最後に水が入ってから1か月(WITHER_AFTER_MS)たつと枯れて空き地に戻る(持ち主でもほかの人でも、現地でも遠くからでも、水が入れば延びる)
// ご当地の畑は宅急便で回収できない(実をいろいろな人に渡すための畑なので)。代わりに、実って1か月(LOCAL_TO_MARKET_MS。現地に行って
// もらうのが前提なので長めにとる)で畑を撤去して、残りの実を市場に並べる(定期実行の chizu-tane-sweep。生産者どうしの取り替えでほかの人に渡る)ので、
// 腐ることもない。枯れるのは同じ

/** 実ってから、宅急便で回収できるようになるまで(1週間) */
export const DELIVERY_AFTER_MS = 7 * DAY;
/** 宅急便で回収できるようになってから、実が腐り落ちるまで(30日) */
export const ROT_AFTER_MS = 30 * DAY;
/** 最後に水が入ってから、枯れるまで(30日) */
export const WITHER_AFTER_MS = 30 * DAY;
/** ご当地の畑が実ってから、撤去して残りの実を市場に並べるまで(30日) */
export const LOCAL_TO_MARKET_MS = 30 * DAY;

/** 畑の終わり方を計算するのに使う項目 */
export interface EndingBase extends GrowingBase {
  plantedAt: string;
  ripenedAt?: string | null;
  /** 最後に水が入った日時(2026-11-05 に足したので、それより前の畑には無い。無ければまいた日時から数える) */
  lastWateredAt?: string | null;
}

function isRipe(base: GrowingBase): boolean {
  return (base.fruits ?? 0) > 0;
}

/** 宅急便で回収できるようになる日時(実っていなければ null) */
export function deliveryFrom(base: EndingBase): Date | null {
  if (!isRipe(base) || !base.ripenedAt) return null;
  return new Date(Date.parse(base.ripenedAt) + DELIVERY_AFTER_MS);
}

/** ご当地の畑を撤去して、残りの実を市場に並べる日時(実っていなければ null) */
export function localMarketAt(base: EndingBase): Date | null {
  if (!isRipe(base) || !base.ripenedAt) return null;
  return new Date(Date.parse(base.ripenedAt) + LOCAL_TO_MARKET_MS);
}

/** 実が腐り落ちる日時(実っていなければ null) */
export function rotAt(base: EndingBase): Date | null {
  const from = deliveryFrom(base);
  return from && new Date(from.getTime() + ROT_AFTER_MS);
}

/** 水が入らないと枯れる日時(育っている途中の畑だけ。実っている・タネ待ちなら null) */
export function witherAt(base: EndingBase): Date | null {
  if (isRipe(base) || isWaitingReplant(base)) return null;
  // まき直すと plantedAt が新しくなるので、前の育ちのときの水やりの日時より新しい方から数える
  const last = Math.max(Date.parse(base.plantedAt), base.lastWateredAt ? Date.parse(base.lastWateredAt) : 0);
  return new Date(last + WITHER_AFTER_MS);
}

/** どう終わって空き地に戻ったか(終わっていなければ null)。abandoned はタネ待ちのまま1週間 */
export function fieldEnding(base: EndingBase, now: Date): "abandoned" | "rotten" | "withered" | null {
  if (isAbandoned(base, now)) return "abandoned";
  const rot = rotAt(base);
  if (rot && rot.getTime() <= now.getTime()) return "rotten";
  const wither = witherAt(base);
  if (wither && wither.getTime() <= now.getTime()) return "withered";
  return null;
}

/** 期限の何日前に知らせるか(3日前) */
export const NOTICE_BEFORE_MS = 3 * DAY;

/** 持ち主に前もって知らせること */
export interface FieldNotice {
  kind: "deliverable" | "rotSoon" | "witherSoon";
  /** その期限の日時(宅急便は回収できるようになった日時、ほかは腐り落ちる・枯れる日時) */
  at: Date;
  /** 同じ知らせを2回送らないための印(GameTaneBase.endingNotice に書く)。実り直す・水が入ると変わる */
  key: string;
}

/**
 * いま持ち主に知らせること(無ければ null)。腐る・枯れるは期限の NOTICE_BEFORE_MS 前から、宅急便は回収できるようになったら。
 * 同じ畑で当てはまるものが2つあれば、あとのもの(腐る)を返す。ご当地の畑(local)は宅急便を知らせない
 */
export function fieldNotice(base: EndingBase, now: Date, local: boolean): FieldNotice | null {
  const t = now.getTime();
  const soon = NOTICE_BEFORE_MS;
  // ご当地の畑は、実って1週間で市場に並べるので、腐る・宅急便は知らせない
  const rot = local ? null : rotAt(base);
  if (rot && rot.getTime() - soon <= t) return { kind: "rotSoon", at: rot, key: `rotSoon#${rot.toISOString()}` };
  const from = deliveryFrom(base);
  if (!local && from && from.getTime() <= t) return { kind: "deliverable", at: from, key: `deliverable#${from.toISOString()}` };
  const wither = witherAt(base);
  if (wither && wither.getTime() - soon <= t) return { kind: "witherSoon", at: wither, key: `witherSoon#${wither.toISOString()}` };
  return null;
}

/** いまの段階。0(タネ)〜 RIPE_STAGE(実り) */
export function growthStage(base: GrowingBase): number {
  if ((base.fruits ?? 0) > 0) return RIPE_STAGE;
  return Math.min(RIPE_STAGE - 1, Math.floor((base.water ?? 0) / WATER_ONSITE));
}

/** 実るまでに、あと何回水をやればよいか(現地のチェックインなら何回、遠くからなら何回)。実っていれば null */
export function waterUntilRipe(base: GrowingBase): { onsite: number; remote: number } | null {
  if ((base.fruits ?? 0) > 0) return null;
  const rest = Math.max(0, WATER_TO_RIPE - (base.water ?? 0));
  return { onsite: Math.ceil(rest / WATER_ONSITE), remote: Math.ceil(rest / WATER_REMOTE) };
}
