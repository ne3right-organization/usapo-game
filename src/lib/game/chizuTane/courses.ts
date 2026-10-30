// 地図タネのコースの表(コース・拠点の種類・ランクごとにもらえるもの)。設計書は docs/地図タネ_全体設計書.md の 3.3。
// 画面(src/components/game/chizu-tane)と Lambda(amplify/functions/chizu-tane-*)の両方から使うので、
// ブラウザ・Node のどちらにも依存しない純粋な TS にしておく。
//
// もらえるものを足すときは TANE_ITEMS に1行足すだけ。絵は scripts/chizu-tane/process-item-images.mts で作ると
// itemImages.generated.ts に載り、imageUrl になる(無いあいだは emoji を出す。docs/地図タネ_絵の作り方.md)

import { ITEM_IMAGE_URLS } from "./itemImages.generated";
import { TANE_LOCAL_BASE_TYPES, TANE_LOCAL_ITEMS } from "./localItems";

export type TaneCourse = "plant" | "animal" | "hobby" | "vehicle" | "building";

export interface TaneCourseDef {
  id: TaneCourse;
  label: string;
  emoji: string;
  description: string;
}

export const TANE_COURSES: TaneCourseDef[] = [
  { id: "plant", label: "植物", emoji: "🌿", description: "果樹園や花畑、田んぼを育てる" },
  { id: "animal", label: "動物", emoji: "🐾", description: "小鳥や水辺の生きもの、牧場の動物に出会う" },
  { id: "hobby", label: "趣味", emoji: "🎨", description: "カメラや楽器、釣り道具を集める" },
  { id: "vehicle", label: "乗り物", emoji: "🚗", description: "自転車や車、はたらく車を集める" },
  { id: "building", label: "建物", emoji: "🏠", description: "パン屋や八百屋、駄菓子屋を建てる" },
];

export const TANE_COURSE_BY_ID = new Map(TANE_COURSES.map((c) => [c.id, c]));

export function isTaneCourse(value: unknown): value is TaneCourse {
  return typeof value === "string" && TANE_COURSE_BY_ID.has(value as TaneCourse);
}

/**
 * 拠点(画面では「タネ」)の種類。1レベルに1種類(unlockLevel)。そのレベルになると、その種類のもの3つ(ランク1〜3)の
 * タネを1個ずつもらえる(例: 果樹園なら みかんの木・梨の木・いちご畑 のタネ)。
 * まくのはタネを持っていればよく、レベルの制限は無い(ほかの人のタネを訪ねてもらったタネもまける)
 */
export interface TaneBaseType {
  id: string;
  course: TaneCourse;
  unlockLevel: number;
  name: string;
  emoji: string;
}

const baseTypes = (course: TaneCourse, list: [id: string, name: string, emoji: string][]): TaneBaseType[] =>
  list.map(([id, name, emoji], i) => ({ id, course, unlockLevel: i + 1, name, emoji }));

export const TANE_BASE_TYPES: TaneBaseType[] = [
  ...baseTypes("plant", [
    ["orchard", "果樹園", "🍊"],
    ["flower_field", "花畑", "🌷"],
    ["rice_paddy", "田んぼ", "🌾"],
    ["vegetable_field", "野菜畑", "🥬"],
    ["bamboo_grove", "竹林", "🎋"],
    ["tea_field", "茶畑", "🍵"],
    ["herb_garden", "ハーブ園", "🌿"],
    ["greenhouse", "温室", "🪴"],
    ["forest", "森", "🌲"],
    ["sacred_grove", "御神木の杜", "🌳"],
  ]),
  ...baseTypes("animal", [
    ["bird_woods", "小鳥の林", "🐦"],
    ["waterside", "水辺", "🐟"],
    ["petting_farm", "ふれあい牧場", "🐇"],
    ["cat_alley", "ねこの路地", "🐈"],
    ["bug_meadow", "虫の原っぱ", "🦋"],
    ["dog_park", "いぬの広場", "🐕"],
    ["satoyama", "里山", "🦊"],
    ["aquarium", "水族館", "🐬"],
    ["wetland", "渡り鳥の湿地", "🦢"],
    ["zoo", "どうぶつ園", "🦒"],
  ]),
  ...baseTypes("hobby", [
    ["photo_spot", "撮影スポット", "📷"],
    ["music_square", "音楽ひろば", "🎸"],
    ["fishing_pond", "釣り堀", "🎣"],
    ["model_workshop", "模型工房", "🛠️"],
    ["campsite", "キャンプ場", "⛺"],
    ["reading_room", "図書室", "📚"],
    ["atelier", "アトリエ", "🎨"],
    ["game_corner", "ゲームコーナー", "🕹️"],
    ["diorama", "鉄道模型のジオラマ", "🚂"],
    ["observatory", "天文台", "🔭"],
  ]),
  ...baseTypes("vehicle", [
    ["cycle_port", "サイクルポート", "🚲"],
    ["garage", "ガレージ", "🚗"],
    ["work_vehicle_depot", "はたらく車の車庫", "🚒"],
    ["station", "駅", "🚉"],
    ["construction_site", "工事現場", "🏗️"],
    ["harbor", "港", "⛴️"],
    ["airport", "空港", "✈️"],
    ["ropeway", "ロープウェイ", "🚡"],
    ["rail_yard", "車両基地", "🚄"],
    ["space_center", "宇宙基地", "🚀"],
  ]),
  ...baseTypes("building", [
    ["bakery", "パン屋", "🍞"],
    ["greengrocer", "八百屋", "🥕"],
    ["candy_shop", "駄菓子屋", "🍬"],
    ["cafe", "喫茶店", "☕"],
    ["bathhouse", "銭湯", "♨️"],
    ["shopping_street", "商店街", "🏮"],
    ["shrine", "神社", "⛩️"],
    ["festival_square", "お祭り広場", "🎆"],
    ["lighthouse", "灯台", "🗼"],
    ["castle", "お城", "🏯"],
  ]),
];

/** 拠点の種類を ID で引く。ご当地の畑(localItems.ts)も引ける */
export const TANE_BASE_TYPE_BY_ID = new Map([...TANE_BASE_TYPES, ...TANE_LOCAL_BASE_TYPES].map((t) => [t.id, t]));

/** 拠点でもらえるもの(そのまま箱庭に置ける形)。itemId は `${baseTypeId}_${rank}` */
export interface TaneItem {
  itemId: string;
  baseTypeId: string;
  rank: number;
  name: string;
  emoji: string;
  imageUrl?: string;
}

const items = (baseTypeId: string, list: [name: string, emoji: string][]): TaneItem[] =>
  list.map(([name, emoji], i) => {
    const itemId = `${baseTypeId}_${i + 1}`;
    return { itemId, baseTypeId, rank: i + 1, name, emoji, imageUrl: ITEM_IMAGE_URLS[itemId] };
  });

// 各種類に3点(1〜3)。建物コースは「小物 → 小物 → その建物」の並び(3つ目がガーデンに建物として並ぶ)。本番で手に入るのは Lv.1〜3 の種類の45点(MAX_LEVEL_PRODUCTION)。
// Lv.4〜10 の種類の分は、全体を眺めるために名前と絵文字だけ仮に決めたもの(2026-10-29。まだ手に入らない)
export const TANE_ITEMS: TaneItem[] = [
  // ─── Lv.1〜3(試作で使う) ───
  ...items("orchard", [["みかんの木", "🍊"], ["梨の木", "🍐"], ["いちご畑", "🍓"]]),
  ...items("flower_field", [["チューリップ", "🌷"], ["ひまわり", "🌻"], ["ネモフィラ", "💠"]]),
  ...items("rice_paddy", [["若い稲", "🌱"], ["実った稲", "🌾"], ["案山子", "👒"]]),
  ...items("bird_woods", [["すずめ", "🐦"], ["メジロ", "🐤"], ["シジュウカラ", "🐥"]]),
  ...items("waterside", [["メダカ", "🐟"], ["カエル", "🐸"], ["カルガモの親子", "🦆"]]),
  ...items("petting_farm", [["ウサギ", "🐇"], ["ヤギ", "🐐"], ["馬", "🐴"]]),
  ...items("photo_spot", [["一眼レフ", "📷"], ["三脚", "📐"], ["高級レンズ", "🔍"]]),
  ...items("music_square", [["バイオリン", "🎻"], ["ピアノ", "🎹"], ["ギター", "🎸"]]),
  ...items("fishing_pond", [["釣りざお", "🎣"], ["クーラーボックス", "🧊"], ["大物の魚", "🐠"]]),
  ...items("cycle_port", [["自転車", "🚲"], ["電動スクーター", "🛴"], ["トライク", "🛺"]]),
  ...items("garage", [["ファミリーカー", "🚙"], ["バイク", "🏍️"], ["スポーツカー", "🚗"]]),
  ...items("work_vehicle_depot", [["路線バス", "🚌"], ["救急車", "🚑"], ["消防車", "🚒"]]),
  ...items("bakery", [["食パン", "🍞"], ["メロンパン", "🍈"], ["パン屋さん", "🏠"]]),
  ...items("greengrocer", [["野菜のかご", "🧺"], ["はかり", "⚖️"], ["八百屋さん", "🏪"]]),
  ...items("candy_shop", [["ラムネ", "🥤"], ["当たりくじ", "🎫"], ["駄菓子屋さん", "🏚️"]]),
  // ─── Lv.4〜10(仮。まだ手に入らない) ───
  ...items("vegetable_field", [["トマト", "🍅"], ["なす", "🍆"], ["とうもろこし", "🌽"]]),
  ...items("bamboo_grove", [["たけのこ", "🎍"], ["青竹", "🎋"], ["竹ぼうき", "🧹"]]),
  ...items("tea_field", [["茶の若葉", "🍃"], ["急須", "🫖"], ["抹茶", "🍵"]]),
  ...items("herb_garden", [["ミント", "🌿"], ["ラベンダー", "💐"], ["カモミール", "🌼"]]),
  ...items("greenhouse", [["サボテン", "🌵"], ["バナナ", "🍌"], ["コーヒー", "🟤"]]),
  ...items("forest", [["落ち葉", "🍁"], ["きのこ", "🍄"], ["栗", "🌰"]]),
  ...items("sacred_grove", [["桜の木", "🌸"], ["大イチョウ", "🍂"], ["御神木", "🌳"]]),
  ...items("cat_alley", [["子猫", "😺"], ["三毛猫", "🐈"], ["黒猫", "🐈‍⬛"]]),
  ...items("bug_meadow", [["トンボ", "🦗"], ["モンシロチョウ", "🦋"], ["カブトムシ", "🪲"]]),
  ...items("dog_park", [["子犬", "🐶"], ["柴犬", "🐕"], ["プードル", "🐩"]]),
  ...items("satoyama", [["いのしし", "🐗"], ["鹿", "🦌"], ["熊", "🐻"]]),
  ...items("aquarium", [["ペンギン", "🐧"], ["イルカ", "🐬"], ["シャチ", "🐳"]]),
  ...items("wetland", [["カワセミ", "🐦"], ["サギ", "🕊️"], ["白鳥", "🦢"]]),
  ...items("zoo", [["ゾウ", "🐘"], ["パンダ", "🐼"], ["キリン", "🦒"]]),
  ...items("model_workshop", [["工具箱", "🧰"], ["ロボットのプラモデル", "🤖"], ["ラジコンカー", "🏎️"]]),
  ...items("campsite", [["ランタン", "🏮"], ["たき火", "🔥"], ["テント", "⛺"]]),
  ...items("reading_room", [["絵本", "📖"], ["文房具", "✏️"], ["図鑑セット", "📚"]]),
  ...items("atelier", [["絵の具", "🎨"], ["陶芸のつぼ", "🏺"], ["額縁の絵", "🖼️"]]),
  ...items("game_corner", [["ガチャガチャ", "🎁"], ["クレーンゲーム", "🧸"], ["アーケード台", "🕹️"]]),
  ...items("diorama", [["線路", "🛤️"], ["新幹線", "🚅"], ["蒸気機関車", "🚂"]]),
  ...items("observatory", [["双眼鏡", "🔍"], ["大型望遠鏡", "🔭"], ["天文台のドーム", "🌌"]]),
  ...items("station", [["駅の時計", "🕰️"], ["電車", "🚃"], ["特急列車", "🚅"]]),
  ...items("construction_site", [["ダンプカー", "🚚"], ["ショベルカー", "🚜"], ["クレーン車", "🏗️"]]),
  ...items("harbor", [["ボート", "🚤"], ["ヨット", "⛵"], ["フェリー", "⛴️"]]),
  ...items("airport", [["ヘリコプター", "🚁"], ["プロペラ機", "🛩️"], ["ジェット機", "✈️"]]),
  ...items("ropeway", [["リフト", "🚠"], ["ゴンドラ", "🚡"], ["登山電車", "🚞"]]),
  ...items("rail_yard", [["寝台列車", "🚆"], ["ドクターイエロー", "🚄"], ["リニア", "🚝"]]),
  ...items("space_center", [["人工衛星", "🛰️"], ["月面探査車", "🚙"], ["ロケット", "🚀"]]),
  ...items("cafe", [["ナポリタン", "🍝"], ["クリームソーダ", "🍹"], ["純喫茶", "☕"]]),
  ...items("bathhouse", [["湯おけ", "🪣"], ["びん牛乳", "🥛"], ["銭湯", "♨️"]]),
  ...items("shopping_street", [["コロッケ", "🥔"], ["福引き", "🎊"], ["商店街のアーケード", "🏬"]]),
  ...items("shrine", [["おみくじ", "📜"], ["お守り", "🧧"], ["神社", "⛩️"]]),
  ...items("festival_square", [["わたあめ", "🍭"], ["打ち上げ花火", "🎆"], ["盆踊りのやぐら", "🏮"]]),
  ...items("lighthouse", [["貝がら", "🐚"], ["海図", "🗺️"], ["灯台", "🗼"]]),
  ...items("castle", [["石垣", "🧱"], ["金のしゃちほこ", "🐉"], ["天守閣", "🏯"]]),
];

/** もらえるものを ID で引く。ご当地のもの(localItems.ts)も引ける */
export const TANE_ITEM_BY_ID = new Map<string, TaneItem>([...TANE_ITEMS, ...TANE_LOCAL_ITEMS].map((i) => [i.itemId, i]));

/**
 * 上がれるレベルの上限。本番(game.usapo.net・main の Lambda)は絵を用意する Lv.3 まで、テスト用(devgame.usapo.net・手元・
 * main 以外の Lambda)は全体を試せるよう Lv.10 まで(2026-10-30 に分けた)。絵が無いアイテムは絵文字で出す
 */
export const MAX_LEVEL_PRODUCTION = 3;
export const MAX_LEVEL_DEV = 10;

/**
 * いまの環境の上限レベル。ブラウザではホスト名で(devgame.usapo.net と localhost はテスト用)、Lambda では環境変数
 * CHIZU_TANE_MAX_LEVEL(各関数の resource.ts で AWS_BRANCH を見て入れる)で決める。分からなければ本番の値
 */
export function taneMaxLevel(): number {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    return host === "localhost" || host === "devgame.usapo.net" ? MAX_LEVEL_DEV : MAX_LEVEL_PRODUCTION;
  }
  const fromEnv = Number(process.env.CHIZU_TANE_MAX_LEVEL);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : MAX_LEVEL_PRODUCTION;
}

/**
 * レベル n になるのに要る「たずねたほかの人の拠点の数」(TANE_LEVEL_THRESHOLDS[n - 1])。同じ拠点は何度たずねても1つと数える。
 * 2026-10-29 に、簡単すぎたので厳しくした(それまでは 1か所で Lv.2、3か所で Lv.3)。条件の一覧は管理画面 /admin/chizu-tane/levels
 */
export const TANE_LEVEL_THRESHOLDS = [0, 5, 12, 25, 40, 60, 90, 130, 180, 250];

const maxLevel = () => Math.min(TANE_LEVEL_THRESHOLDS.length, taneMaxLevel());

/**
 * フォローしている人の畑に遠くから水をやる(手伝い)と、この回数でたずねたタネ1か所と数える(2026-10-31)。
 * 近くにほかの人がいなくても、友達と始めればレベルが上がっていくように
 */
export const HELPS_PER_VISIT = 10;

/** レベルの条件に使う「たずねたタネの数」。たずねたほかの人のタネの数に、手伝いの水やりを HELPS_PER_VISIT 回で1か所として足す */
export function levelVisitCount(visited: number, helpCount: number): number {
  return visited + Math.floor(Math.max(0, helpCount) / HELPS_PER_VISIT);
}

/**
 * レベル。Lv.n → n+1 に上がるには、(1) ほかの人の拠点を TANE_LEVEL_THRESHOLDS[n] か所たずねていて、
 * (2) 自分のコースの Lv.n の種類のタネを3つとも、一度はまいていること(まかずにタネがたまっていくのを防ぐ)
 * @param plantedItemIds 自分の拠点にまいたことのあるタネ(もの)
 */
export function levelFor(course: TaneCourse, visitCount: number, plantedItemIds: ReadonlySet<string>): number {
  let level = 1;
  while (level < maxLevel()) {
    const enoughVisits = visitCount >= TANE_LEVEL_THRESHOLDS[level];
    const allPlanted = seedsForLevel(course, level).every((i) => plantedItemIds.has(i.itemId));
    if (!enoughVisits || !allPlanted) break;
    level++;
  }
  return level;
}

/** 次のレベルに上がるのに足りないもの。上限なら null */
export function nextLevelNeeds(
  course: TaneCourse,
  visitCount: number,
  plantedItemIds: ReadonlySet<string>
): { nextLevel: number; visitsRemaining: number; unplanted: TaneItem[] } | null {
  const level = levelFor(course, visitCount, plantedItemIds);
  if (level >= maxLevel()) return null;
  return {
    nextLevel: level + 1,
    visitsRemaining: Math.max(0, TANE_LEVEL_THRESHOLDS[level] - visitCount),
    unplanted: seedsForLevel(course, level).filter((i) => !plantedItemIds.has(i.itemId)),
  };
}

// ─── タネ(持ち物) ───────────────────────────────────────────────────────
// タネは「もの」ごと(みかんの木のタネ、梨の木のタネ…)。まくと1つ減り、その種類の拠点(果樹園)ができて、
// 訪ねた人はそのもの(梨の木)をもらう。手に入るのは: 始めたとき(Lv.1 の種類の3つを1個ずつ)・レベルが上がったとき
// (そのレベルの種類の3つを1個ずつ)・拠点に落ちているタネを拾ったとき。
// ほかの人の拠点に初めてチェックインすると、その拠点にタネが落ちる(直接はもらわない。要らなければ拾わずに置いていける)

/** ほかの人の拠点に初めてチェックインしたときに、その拠点に落ちるタネの数 */
export const SEEDS_PER_CHECKIN = 1;
/** 拠点に落ちていられるタネの数の上限(誰でも早い者勝ちで拾える。一度に拾えるのもこの数まで) */
export const DROPPED_SEEDS_MAX = 3;

/** そのレベルになったときにもらえるタネ(自分のコースのそのレベルの種類のもの3つを1個ずつ) */
export function seedsForLevel(course: TaneCourse, level: number): TaneItem[] {
  const type = baseTypesOf(course).find((t) => t.unlockLevel === level);
  return type ? TANE_ITEMS.filter((i) => i.baseTypeId === type.id && i.rank <= 3) : [];
}

export function baseTypesOf(course: TaneCourse): TaneBaseType[] {
  return TANE_BASE_TYPES.filter((t) => t.course === course);
}

export function firstBaseType(course: TaneCourse): TaneBaseType {
  return baseTypesOf(course)[0];
}


/** いまの環境で手に入るもの(集めたものの一覧に出す範囲)。上限レベル(taneMaxLevel)までの種類のもの */
export function prototypeItems(): TaneItem[] {
  return TANE_ITEMS.filter((i) => (TANE_BASE_TYPE_BY_ID.get(i.baseTypeId)?.unlockLevel ?? Infinity) <= taneMaxLevel());
}

/** 実の産地(収穫の記録や地区に入っている地名) */
export interface FruitPlace {
  prefName?: string;
  cityName: string;
  townName: string;
}

/**
 * 産地つきの実の名前。短い名前は「戸塚区矢部町のりんご」(政令市は区の名前だけ)、
 * full なら都道府県から全部「神奈川県横浜市戸塚区矢部町のりんご」
 */
export function fruitName(place: FruitPlace, itemName: string, full = false): string {
  const city = full ? `${place.prefName ?? ""}${place.cityName}` : place.cityName.replace(/^.+?市(?=.+区$)/, "");
  return `${city}${place.townName}の${itemName}`;
}
