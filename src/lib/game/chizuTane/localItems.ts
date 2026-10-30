// うさぽ農園の「ご当地」のもの(都道府県ごとに 5コース × 3つ = 15点)。設計書は docs/地図タネ_ご当地タネ設計書.md。
// まだゲームでは手に入らない(たたき台。管理画面 /admin/chizu-tane/items で眺める用)。TANE_ITEMS には入れていないので、
// レベルアップの条件・集めたものの一覧には出ない。
//
// 3つの役目: 1個目＝現地で味わう・乗る・体験するもの、2個目＝持ち帰るお土産、3個目＝ガーデンに飾って見せたいもの

import { type TaneCourse, type TaneItem } from "./courses";
import { ITEM_IMAGE_URLS } from "./itemImages.generated";

/** ご当地のもの。local は都道府県コード(2桁) */
export interface TaneLocalItem extends TaneItem {
  local: string;
  course: TaneCourse;
}

/** コースごとの「ご当地の畑」(拠点の種類)。置かれるものが都道府県で変わる */
export const TANE_LOCAL_BASE_TYPE_IDS: Record<TaneCourse, string> = {
  plant: "local_plant",
  animal: "local_animal",
  hobby: "local_hobby",
  vehicle: "local_vehicle",
  building: "local_building",
};

export const TANE_LOCAL_RANK_ROLES = ["現地で", "お土産", "見せたい"] as const;

type Three = [[name: string, emoji: string], [name: string, emoji: string], [name: string, emoji: string]];

interface LocalPref {
  prefCode: string;
  prefName: string;
  items: Record<TaneCourse, Three>;
}

const LOCAL_PREFS: LocalPref[] = [
  {
    prefCode: "01",
    prefName: "北海道",
    items: {
      plant: [["ゆでたてのとうきび", "🌽"], ["夕張メロン", "🍈"], ["富良野のラベンダー畑", "🪻"]],
      animal: [["毛ガニ", "🦀"], ["シマエナガ", "🐦"], ["タンチョウ", "🦩"]],
      hobby: [["小樽のガラス細工", "🫙"], ["木彫りの熊", "🐻"], ["雪まつりの雪像", "⛄"]],
      vehicle: [["函館の路面電車", "🚋"], ["流氷の砕氷船", "🚢"], ["ばんえいの馬そり", "🐴"]],
      building: [["みそラーメン", "🍜"], ["バターサンド", "🍪"], ["札幌の時計台", "🕰️"]],
    },
  },
  {
    prefCode: "11",
    prefName: "埼玉県",
    items: {
      plant: [["深谷ねぎ", "🧅"], ["狭山茶", "🍵"], ["秩父の芝桜", "🌸"]],
      animal: [["長瀞のアユ", "🐟"], ["三峯のお犬さま", "🐺"], ["秩父のカモシカ", "🐐"]],
      hobby: [["小川和紙の紙すき", "📜"], ["岩槻のひな人形", "🎎"], ["春日部の大凧", "🪁"]],
      vehicle: [["長瀞のライン下りの舟", "🛶"], ["秩父のSL", "🚂"], ["秩父夜祭の屋台", "🏮"]],
      building: [["川越の焼きいも", "🍠"], ["草加せんべい", "🍘"], ["川越の時の鐘", "🔔"]],
    },
  },
  {
    prefCode: "13",
    prefName: "東京都",
    items: {
      plant: [["江戸川の小松菜", "🥬"], ["入谷の朝顔の鉢", "🌺"], ["ソメイヨシノ", "🌸"]],
      animal: [["江戸前のハゼ", "🐟"], ["上野のパンダ", "🐼"], ["小笠原のザトウクジラ", "🐋"]],
      hobby: [["江戸風鈴の絵付け", "🎐"], ["江戸切子", "🥃"], ["羽子板市の押絵羽子板", "🏸"]],
      vehicle: [["東京の路面電車", "🚋"], ["浅草の人力車", "🛺"], ["屋形船", "🚣"]],
      building: [["もんじゃ焼き", "🍳"], ["人形焼", "🍥"], ["雷門", "🏮"]],
    },
  },
  {
    prefCode: "14",
    prefName: "神奈川県",
    items: {
      plant: [["三浦だいこん", "🥬"], ["湘南ゴールド", "🍋"], ["鎌倉のあじさい", "💠"]],
      animal: [["湘南しらす", "🐟"], ["鶴岡八幡宮の鳩", "🕊️"], ["湘南のアカウミガメ", "🐢"]],
      hobby: [["寄木のコースター", "🧩"], ["鎌倉彫", "🪵"], ["平塚の七夕飾り", "🎋"]],
      vehicle: [["海辺の路面電車", "🚋"], ["箱根の登山電車", "🚞"], ["港の帆船", "⛵"]],
      building: [["横須賀の海軍カレー", "🍛"], ["シューマイ", "🥟"], ["横浜の赤レンガ倉庫", "🧱"]],
    },
  },
  {
    prefCode: "37",
    prefName: "香川県",
    items: {
      plant: [["さぬきの小麦", "🌾"], ["オリーブ", "🫒"], ["松の盆栽", "🌲"]],
      animal: [["ハマチ", "🐟"], ["こんぴら狗", "🐕"], ["スナメリ", "🐬"]],
      hobby: [["奉公さんの絵付け", "🎎"], ["丸亀うちわ", "🪭"], ["香川漆器の重箱", "🍱"]],
      vehicle: [["島めぐりのフェリー", "⛴️"], ["こんぴらさんの石段かご", "🪑"], ["ちょうさ（太鼓台）", "🥁"]],
      building: [["讃岐うどん", "🍜"], ["和三盆", "🍬"], ["こんぴらさん（金刀比羅宮）", "⛩️"]],
    },
  },
  {
    prefCode: "40",
    prefName: "福岡県",
    items: {
      plant: [["八女茶", "🍵"], ["あまおう", "🍓"], ["太宰府の飛梅", "🌸"]],
      animal: [["博多のゴマサバ", "🐟"], ["太宰府のうそ", "🐦"], ["筑後川の鵜飼いの鵜", "🐦‍⬛"]],
      hobby: [["小石原焼の器", "🏺"], ["博多人形", "🎎"], ["博多織の帯", "🧵"]],
      vehicle: [["柳川のどんこ舟", "🛶"], ["門司港のトロッコ列車", "🚃"], ["博多祇園山笠", "🏮"]],
      building: [["もつ鍋", "🍲"], ["明太子", "🌶️"], ["中洲の屋台", "🏮"]],
    },
  },
  {
    prefCode: "43",
    prefName: "熊本県",
    items: {
      plant: [["熊本のスイカ", "🍉"], ["デコポン", "🍊"], ["晩白柚", "🍈"]],
      animal: [["阿蘇のあか牛", "🐄"], ["天草のイルカ", "🐬"], ["肥後ちゃぼ", "🐓"]],
      hobby: [["おばけの金太", "👺"], ["肥後てまり", "🧶"], ["山鹿灯籠", "🏮"]],
      vehicle: [["熊本の路面電車", "🚋"], ["球磨川下りの舟", "🛶"], ["妙見祭の亀蛇（ガメ）", "🐢"]],
      building: [["太平燕", "🍜"], ["からし蓮根", "🪷"], ["熊本城", "🏯"]],
    },
  },
];

const COURSE_ORDER: TaneCourse[] = ["plant", "animal", "hobby", "vehicle", "building"];

/** ご当地のもの。itemId は `${ご当地の畑のID}_p${都道府県コード}_${ランク}`(例: local_plant_p01_2) */
export const TANE_LOCAL_ITEMS: TaneLocalItem[] = LOCAL_PREFS.flatMap((pref) =>
  COURSE_ORDER.flatMap((course) =>
    pref.items[course].map(([name, emoji], i) => {
      const baseTypeId = TANE_LOCAL_BASE_TYPE_IDS[course];
      const itemId = `${baseTypeId}_p${pref.prefCode}_${i + 1}`;
      return { itemId, baseTypeId, rank: i + 1, name, emoji, imageUrl: ITEM_IMAGE_URLS[itemId], local: pref.prefCode, course };
    })
  )
);

/** ご当地のものを決めた都道府県(都道府県コード順) */
export const TANE_LOCAL_PREFS: { prefCode: string; prefName: string }[] = LOCAL_PREFS.map(({ prefCode, prefName }) => ({ prefCode, prefName }));
