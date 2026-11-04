// うさぽ農園のご当地のもの(47都道府県 × 5コース × 3つ = 705点)の絵を、画像生成AIに頼む文(プロンプト)を出す。
// 手順は docs/地図タネ_絵の作り方.md の5章。
//
//   npx tsx scripts/chizu-tane/local-art-prompts.mts             # まだ絵の無いシートを3枚ぶん(= 1都道府県ぶん)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts --next 6    # まだ絵の無いシートを6枚ぶん
//   npx tsx scripts/chizu-tane/local-art-prompts.mts 13 14       # 都道府県を指定して(3枚ずつ)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts 13-2        # シートを指定して(東京都の2個目)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts --status    # 都道府県ごとの進み具合だけ
//   npx tsx scripts/chizu-tane/local-art-prompts.mts --file      # 全部の頼む文を art/chizu-tane/local-prompts.md に書き出す
//                                                                 (見本 art/chizu-tane/style-reference.png が無ければ作る)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts --redo      # redo.md の描き直す1個目を 3×3 のシートにして art/chizu-tane/redo-prompts.md に
//
// 1シート = 1都道府県の同じ何個目(現地で・お土産・見せたい)の5点を、横1列(植物・動物・趣味・乗り物・建物)に。
// 同じ役目のものを並べるので、大きさの感じがそろう。見本は通常のアイテムと同じ style-reference.png を毎回添付する。
// できた画像は art/chizu-tane/sheets/local-{都道府県コード}-{何個目}.png に置き、process-item-images.mts で切り分ける

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import * as localItemsModule from "../../src/lib/game/chizuTane/localItems";
import { LOCAL_SHEET_COURSES, REDO_SHEETS_FILE, type Rgba, cutSheet, localSheetId, sheetRows } from "./itemArt.mjs";

// package.json が "type": "module" ではないので、tsx で動かすと中身は default に入る(process-item-images.mts と同じ)
const localItems = (localItemsModule as unknown as { default?: typeof localItemsModule }).default ?? localItemsModule;
const { TANE_LOCAL_PREFS, localItemFor } = localItems;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHEETS_DIR = join(ROOT, "art/chizu-tane/sheets");
const ITEMS_DIR = join(ROOT, "public/chizu-tane/items");
const RANKS = [1, 2, 3] as const;

/** 何個目ごとの役目(設計書 7.1)と、コースごとに何を描くか */
const ROLES: Record<number, { title: string; courses: Record<(typeof LOCAL_SHEET_COURSES)[number], string> }> = {
  1: {
    title: "現地で味わう・乗る・体験するもの",
    courses: {
      plant: "現地で食べるとれたての作物。作物そのものを描く",
      animal: "名物の魚・貝・牛など。料理ではなく、生きものの姿で描く",
      hobby: "現地で体験する工芸。作っている途中の品と道具を少し",
      vehicle: "その土地の乗り物",
      building: "名物料理。器に盛った料理",
    },
  },
  2: {
    title: "持ち帰るお土産",
    courses: {
      plant: "お土産の果物・お茶など。作物そのものを描く",
      animal: "お土産やお守りの絵柄になる生きもの。生きものの姿で描く",
      hobby: "お土産の工芸品・郷土玩具",
      vehicle: "乗り物にまつわるお土産品（列車のおもちゃ・模型・記念きっぷ・ヘッドマークなど）。乗り物そのものではなく、手に持てる品として",
      building: "お土産の名物。箱や包み紙は描かず、中身を器か皿にのせて",
    },
  },
  3: {
    title: "ガーデンに飾って見せたいもの",
    courses: {
      plant: "名所の花・名木。花の咲いた木や群れ",
      animal: "立派な・珍しい生きもの",
      hobby: "大きく立派な工芸品・飾り",
      vehicle: "飾って見せたい立派な乗り物（名物の列車・船・保存されている名車など）。背景の指定があれば描く。祭りの山車も少し。人は描かない",
      building: "名所の建物。そっくりにせず、それらしく",
    },
  },
};

/**
 * AI に伝わりにくいものの補足(名前 → 見た目)。作業表の「かっこの中」と同じ。
 * 描かせてみて違うものが出てきたら、ここに足す(名前は localItems.ts と同じ書き方で)
 */
const NOTES: Record<string, string> = {
  // 牛は、何も書かないと茶色や白黒のぶちの牛ばかりになるので、ひとつずつ見た目を決めておく
  米沢牛: "黒くてがっしりした和牛（黒毛和牛）。ぶちの無い真っ黒な体に、赤い首輪と鈴",
  飛騨牛: "黒くてがっしりした和牛（黒毛和牛）。ぶちの無い真っ黒な体に、金色の鼻輪",
  甲州牛: "黒い和牛が、ぶどう棚の下にいるところ",
  常陸牛: "黒い和牛が、青い首輪をつけているところ",
  但馬牛: "黒くて少し小さめの、角の立派な和牛",
  見島牛: "黒くて小さく、ほっそりした昔ながらの和牛",
  阿蘇のあか牛: "赤茶色一色の、ぶちの無い和牛が草原にいるところ",
  蒜山のジャージー牛: "うすい茶色一色で、目のまわりが黒い、やさしい顔の乳牛",
  宇和島の闘牛: "黒くて首の太い、たくましい牛が、色のついた化粧まわしをつけているところ",
  // 焼き物のろくろは、何も書かないと「ろくろの上のつぼ」ばかりになるので、色と形で分ける
  笠間焼のろくろ: "ろくろの上に、黒っぽい釉薬がとろりとたれた、大きめの鉢",
  益子焼のろくろ: "ろくろの上に、ぽってり厚い、茶色と白のかけ流し模様の皿",
  丹波立杭焼のろくろ: "ろくろの上に、灰色がかった、たてじまの模様のつぼ",
  備前焼のろくろ: "ろくろの上に、赤茶色の、つやの無い焼きしめのつぼ",
  萩焼のろくろ: "ろくろの上に、白っぽいうすいピンク色の、やわらかい感じの茶碗",
  // 路面電車・バスも、何も書かないと緑と白ばかりになるので、色を決める
  函館の路面電車: "赤とクリーム色の、古い路面電車",
  熊本の路面電車: "青と白の路面電車",
  長崎の路面電車: "坂の町を走る、オレンジとクリーム色の小さな路面電車",
  富山のライトレール: "赤や黄色など色あざやかな、丸みのある低い新しい電車",
  ひたちなかのローカル線: "田んぼの中を走る、オレンジとクリーム色の1両だけのディーゼルの列車（バスではなく電車の形）",
  金沢のレトロなバス: "茶色と金色の、木の窓枠のついたレトロなバス。ボンネット型の復刻バス",
  鬼怒川のライン下り: "船頭さんが竿をさす、木の細長い舟で川を下るところ（ゴムボートではない）",
  // 2026-11-04 の乗り物の見直し(docs/地図タネ_乗り物の見直し案.md)で決めた見た目・背景
  蔵王ロープウェイ: "樹氷を背景に",
  SLばんえつ物語: "オコジョ展望車も描く",
  つくばエクスプレス: "気象庁の地磁気観測所を背景に",
  SL大樹: "転車台にのせて",
  わたらせ渓谷鐵道: "紅葉の中を走る",
  上野モノレール: "パンダ・ゾウ・キリンといっしょに",
  北陸鉄道浅野川線: "元・東京メトロ日比谷線の車両が田園風景の中を走る",
  関電トンネルの電気バス: "充電しているところ",
  大井川鐵道のSL: "ヘッドマークを付けて、横に大井川",
  キャプテンライン: "USJ を背景に",
  神戸港のクルーズ船コンチェルト: "ポートタワーを背景に",
  平城宮跡の遣唐使船: "大極殿を背景に",
  パンダくろしお: "白浜の海を背景に",
  寝台特急サンライズ瀬戸: "瀬戸大橋を渡るところ",
  阿佐海岸鉄道のDMV: "線路から道路に降りるところ。海を背景に",
  しまなみ海道の自転車: "来島海峡大橋を背景に",
  軍艦島へのクルーズ船: "軍艦島を背景に",
  南阿蘇鉄道のトロッコ列車: "阿蘇の山を背景に",
  特急ゆふいんの森: "由布岳を背景に",
  高千穂あまてらす鉄道のグランドスーパーカート: "高い鉄橋の上を走る",
  桜島へのフェリー: "噴煙の桜島を背景に",
  種子島のH3ロケット: "発射台に立つところ",
  宮古島の水中観光船: "水の中の魚と、水の上の青空をいっしょに",
  大曲の花火大会: "夜の川の上いっぱいに、色とりどりの花火がたくさん横に広がって開いているところ（大きな丸い一発ではない）",
  南部馬: "がっしりした茶色の在来の馬。たてがみが豊か",
  // 2026-11-03 に替えたもの(実在の名前を使う。あまり知られていないラーメンは、その土地のB級グルメに)
  いただき: "大きな油揚げの袋に、お米と細かく切った野菜を詰めて甘辛く炊いたもの。切り口を見せて皿に",
  めはり寿司: "高菜の漬物の大きな葉でまるごと包んだ、大きなおにぎり。皿に2つ、1つは切り口を見せる",
  フィッシュカツ: "魚のすり身に、カレー味の茶色い衣をつけて揚げた、平たい楕円のカツ。皿に",
  ヨコハマエアキャビン: "港の上を渡る、丸みのある白い小さなゴンドラのロープウェイ。背景に、みなとみらいの大きな観覧車（コスモクロック）と高いビル（ランドマークタワー）。コスモクロックとランドマークタワーを背景に",
  はとバス: "東京の街を走る、黄色い観光バス（2階建て）",
  千葉都市モノレール: "レールの下にぶら下がって走る、懸垂式のモノレール",
  // ほかの県と似やすいもの(いちご・みかん・ロープウェイ・フェリー・ラーメン)
  とれたてのとちおとめ: "小さなかごに山盛りの、赤いいちご",
  奈良の古都華: "白い箱にきれいに並べた、つやのある濃い赤の大きないちご",
  有田みかん: "みかん箱からあふれる、小さなみかん",
  萩の夏みかん: "葉のついた枝になっている、ごつごつした大きな黄色っぽい夏みかん",
  伊香保のロープウェイ: "温泉街の屋根の上を渡る、緑のゴンドラ",
  吉野山のロープウェイ: "桜の咲く山を登る、小さな箱形のロープウェイ",
  宮島のフェリー: "海に立つ赤い大鳥居の前を渡るフェリー。大鳥居を背景に",
  関門海峡の連絡船: "大きなつり橋（関門橋）の下をくぐる、小さな連絡船",
  喜多方ラーメン: "平たい太めの麺に、チャーシューがたっぷりのったしょうゆラーメン",
  // 四国・九州の鯛・アジ・絵付け・みかんも、何も書かないと同じ絵になる
  鳴門の鯛: "鳴門の渦潮の白い波から跳ねる、赤い鯛",
  宇和島のタイ: "海に浮かぶ四角いいけすの網の中を泳ぐ、ピンクの鯛",
  長崎のアジ: "群れで泳ぐ、小さめの細いアジ3匹",
  関あじ: "釣り糸にかかった、金色に光る丸々と太った大きなアジ1匹",
  清水焼の絵付け: "赤・緑・金の花の絵の茶碗に、筆で描いているところ",
  砥部焼の絵付け: "白くて厚いぽってりした器に、藍色の太い唐草模様を描いているところ",
  有田焼の絵付け: "白い磁器の大きな皿に、赤と金で華やかな模様を描いているところ",
  とれたての愛媛みかん: "石垣の段が2〜3段ある段々畑に並んだみかんの木と、手前のかごに入ったみかん。段々畑をはっきり描く",
  別府の地獄めぐりのバス: "白い湯けむりがもくもくと大きく立ちのぼる温泉の前を走る、赤い観光バス。湯けむりをバスと同じくらい大きく",
  瓦そば: "熱した瓦の上に、茶色い茶そばをのせ、錦糸卵・甘辛い牛肉・のり・レモン・もみじおろしを並べたもの（瓦が器。どんぶりではない）",
  // 遊覧船も、何も書かないと白い船ばかりになるので、形や景色で分ける
  松島の遊覧船: "松の生えた小さな島々のあいだを走る遊覧船。かもめが飛んでいる",
  田沢湖の遊覧船: "深い青の湖を走る、小さな遊覧船。岸に金色の女の人の像（たつこ像）",
  東尋坊の遊覧船: "切り立った柱のような岩の崖の前を走る、小さな赤い船",
  富士五湖の遊覧船: "富士山の見える湖を走る、白鳥の形をした遊覧船",
  尻屋崎の寒立馬: "ずんぐりした体の、たくましい馬",
  八幡馬: "赤や黒に塗って模様を描いた、木の馬の郷土玩具",
  こぎん刺しのタペストリー: "紺の布に白い糸で幾何学模様を刺した壁かけ",
  青森ねぶた: "武者の顔を描いた、大きな紙の灯籠の山車",
  三内丸山の六本柱: "太い木の柱が6本立った、縄文時代のやぐら",
  チャグチャグ馬コ: "色とりどりの飾りと鈴をつけた馬",
  三陸のさっぱ船: "小さな漁船",
  岩谷堂箪笥: "黒い金具のついた木のたんす",
  なまはげのお面: "赤い鬼のような顔のお面",
  いぶりがっこ: "いぶして茶色くなった大根の漬物を切ったもの",
  笹野一刀彫のお鷹ぽっぽ: "木を削って色を塗った、鷹の置物",
  花笠まつりの花笠: "赤い花飾りのついた笠",
  三春駒: "黒く塗った木彫りの馬の郷土玩具",
  会津の赤べこの絵付け: "首がゆれる赤い牛の張り子に、筆で模様を描いているところ",
  松川だるまの絵付け: "青いだるまに筆で模様を描いているところ",
  富岡のお蚕さん: "白いかいこ（幼虫）とまゆ",
  富岡のまゆ玉細工: "白いまゆで作った小さな動物の飾り",
  高崎だるま: "赤いだるま",
  鴨川の万祝の晴れ着: "鶴や亀を大きく染めた、漁師の晴れ着",
  佐渡のたらい舟: "大きなたらいの形の小舟",
  燕の鎚起銅器のたたき出し: "金づちでたたいて作る銅のやかん",
  村上の木彫堆朱: "朱色の漆を塗った、彫刻のあるお盆",
  高岡御車山: "金色の飾りのついた豪華な山車",
  富山の薬売りの紙風船: "四角い紙風船",
  井波彫刻の欄間: "木に細かい彫刻をした、横長の飾り板",
  勝山の恐竜: "まるっこい恐竜のぬいぐるみ",
  フクイラプトル: "大きなかぎ爪の、二本足の肉食恐竜",
  甲州印伝: "鹿の革に漆で小紋の模様をつけた小さな財布",
  飯田の水引細工: "紅白の水引で作った飾り結び",
  木曽のお六櫛: "目の細かい木のくし",
  飛騨のさるぼぼ: "赤い布で作った、顔の無い猿の人形",
  飛騨の朴葉みそ: "大きな朴の葉の上で焼くみそ",
  静岡のプラモデル: "飛行機のプラモデル",
  駿河竹千筋細工: "細い竹ひごで作った虫かご",
  名古屋のガイドウェイバス: "高架の専用道を走るバス",
  伊勢型紙の大きな図柄: "細かい模様を切り抜いた型紙",
  大津絵の掛け軸: "素朴な鬼の絵の掛け軸",
  丁稚ようかん: "竹の皮に包んだ、平たいようかん",
  堺のお香づくり: "線香と香炉",
  天神祭の御迎え人形: "派手な衣装の大きな人形",
  播州そろばん: "そろばん",
  那智の扇神輿: "扇と鏡を飾った、細長い神輿",
  紀州備長炭の炭焼き: "炭焼き窯と炭",
  用瀬の流しびな: "さん俵（丸いわら）にのせた、紙のひな人形",
  鳥取砂丘の砂の彫刻: "砂で作った大きな彫刻",
  出雲大社の龍蛇さま: "海から来る黄色い小さな海へび",
  石見神楽の大蛇: "とぐろを巻いた、大きなじゃばらの竜",
  ホーランエンヤの船: "旗や飾りで飾った船",
  備前焼の大きな狛犬: "茶色い焼きものの狛犬",
  防府天満宮の御網代車: "牛が引く平安時代の車",
  柳井の金魚ちょうちん: "赤と白の金魚の形のちょうちん",
  宇和島の牛鬼: "牛のような鬼の顔に、長い胴の山車",
  土佐のフラフ: "大漁旗のような、絵の描かれた大きな旗",
  よさこいの鳴子: "木の板に黒い小さな打ち木をつけた、手で鳴らすもの",
  よさこい祭りの地方車: "飾りつけたトラック",
  有明海の潟スキー: "泥の干潟の上で、片ひざをのせて足でけって進む木の細長い板（干潟の泥とムツゴロウも描く。サンダルに見えないように）",
  吉野ヶ里の物見やぐら: "弥生時代の高い木のやぐら",
  長崎のぽっぺん: "吹いて鳴らすガラスのおもちゃ",
  長崎のハタあげ: "白と赤の模様のひし形の凧",
  別府竹細工のかご: "竹で編んだかご",
  都城大弓: "長い竹の弓",
  高千穂の神楽面: "神楽で使う木のお面",
  シーサー: "沖縄の獅子の焼きものの置物",
  紅型の着物: "あざやかな色の染めの着物",
  竹富島の水牛車: "水牛が引く、屋根つきの車",
  松島の五大堂: "海に浮かぶ小島の小さなお堂と、そこへ渡る赤い橋",
  銀山温泉の木造の旅館: "川沿いに建つ、木造3階建てのレトロな温泉旅館",
  会津の大内宿: "茅葺き屋根の宿場の家",
  犬吠埼の灯台: "岬に立つ白い灯台",
  佐渡金山の坑道: "岩山にあいた坑道の入口と、小さなトロッコ",
  黒部ダム: "山あいのアーチ形の大きなダムと、勢いよく出る放水",
  勝沼のワイン蔵: "ワインの樽が並ぶ石造りの蔵",
  上高地の河童橋: "山を背にした、川にかかる木の吊り橋",
  韮山反射炉: "れんが造りの高い煙突が並ぶ、昔の炉",
  名古屋のテレビ塔: "鉄骨で組んだ電波塔",
  近江八幡の堀の蔵: "堀沿いに並ぶ白壁の蔵と小舟",
  金閣: "池のほとりの、金色の3階建てのお堂",
  湯浅の醤油蔵: "瓦屋根の古い醤油蔵と大きな樽",
  "鳥取の白い洋館（仁風閣）": "白い壁の、2階建ての明治時代の洋館",
  "栗林公園の茶屋（掬月亭）": "池に面した、数寄屋造りの茶屋",
  九重の夢大吊橋: "深い谷にかかる、長い歩行者用の吊り橋",
  "ちょうさ（太鼓台）": "赤い布団を重ねたような飾りの太鼓台",

  // 2026-11-04 redo.md の描き直す候補から(1個目)
  箱根の登山電車: "赤い車体の登山電車が、あじさいの咲く急な山の線路を登っているところ",
  水陸両用の観光バス: "船のような形の観光バスが、水しぶきを上げて川に入っていくところ",
  坊っちゃん列車: "小さな緑の蒸気機関車と、茶色の木の客車がつながった、明治時代の列車",
  ミシガン: "白い船体に赤い外輪がついた、湖を走る大きな外輪船",
  湘南しらす: "小さな白い魚（しらす）がたくさん集まって、小皿に山盛りになっているもの。生きものの小さな群れでもよい",
  白馬のリフト: "スキー場の、ロープにつり下がった2人乗りのいすのリフト。ゴンドラ（箱）ではない",
  津軽のストーブ列車: "客車の中にだるまストーブがある、古い茶色の客車",
  六甲のケーブルカー: "横から見ると平行四辺形で、窓と床が階段のように段々になった車体のケーブルカーが、とても急な坂のレールを登っているところ。レールの間に綱（ケーブル）。ふつうの電車の形ではなく、つり下がるゴンドラでもない",
  デミカツ丼: "ごはんの上のとんかつに、茶色いデミグラスソースをかけたどんぶり。卵でとじない",
  伊勢志摩のあおさ: "ざるに盛った、緑の海藻（あおさ）。ほかの絵と同じ太い輪郭線で",
  野沢菜: "鉢に入った、緑の野沢菜の漬物。長い茎ごと刻まずに折りたたんで盛ったもの。生の菜っ葉の束ではない",
  江戸川の小松菜: "根のついた、小さめの濃い緑の菜っ葉を数株",
  鹿児島の黒豚: "黒い豚。鼻先・4本の足先・しっぽの先の6か所だけが、はっきり白い（六白）。耳は立っている",
  アグー豚: "黒くて小さめの、背中の丸い豚。大きな耳が前に垂れて目にかかるほど。白い所は無い",
  清水港の水上バス: "富士山の見える港の、赤い屋根の小さな連絡船",
  京野菜の賀茂なす: "まん丸で大きな、つやのある紫のなす",
  泉州の水なす: "みずみずしい、ずんぐりした紫のなす（切り口から水がしたたる）",
  蒲郡のみかん: "海の見える畑の、葉のついたみかんの枝",
  砂丘のらっきょう: "小さな白い玉のらっきょうを、ざるに山盛り",
  白えびの天丼: "小さな白いえびをたくさん、かき揚げにしてのせた天丼",
  天童の将棋駒の駒書き: "将棋の駒に筆で字を書いているところ。駒に「王将」と書いてある",
  おばけの金太: "赤い顔で、黒い烏帽子をかぶった男の子のからくり人形（目玉が動き、舌を出す）",
};

export interface Sheet {
  id: string;
  prefCode: string;
  prefName: string;
  rank: number;
}

export const ALL_SHEETS: Sheet[] = TANE_LOCAL_PREFS.flatMap((p) => RANKS.map((rank) => ({ id: localSheetId(p.prefCode, rank), ...p, rank })));

/** シートの5点のアイテムID */
const sheetItemIds = (sheet: Sheet) => sheetRows(sheet.id)?.[0] ?? [];
/** 5点とも絵がある */
export const isDone = (sheet: Sheet) => sheetItemIds(sheet).every((id) => existsSync(join(ITEMS_DIR, `${id}.png`)));
/** 元のシートを置いた(まだ切り分けていないかもしれない) */
export const isPlaced = (sheet: Sheet) => existsSync(join(SHEETS_DIR, `${sheet.id}.png`));

export function prompt(sheet: Sheet): string {
  const role = ROLES[sheet.rank];
  const lines = LOCAL_SHEET_COURSES.map((course, i) => {
    const item = localItemFor(sheet.prefCode, course, sheet.rank)!;
    const note = NOTES[item.name];
    return `${i + 1}. ${item.name}（${note ? `${note}。` : ""}${role.courses[course]}）`;
  });
  return `添付した画像と同じ絵柄で、ゲーム用のアイテムの絵を、横1列に5つ並べた1枚の横長（3:2）の画像で作ってください。
視点・線の太さ・色合い・光の向きを添付の画像にそろえてください。添付の画像は絵柄の見本で、描くもの・並べ方はまねしないでください。

【絵の決まり】
- 斜め上（45度くらい）から見下ろした視点。光は左上から
- 足元の影・台座・地面・草は描かない。背景は透明（無理なら真っ白の無地）
- 横1列に5マス。1マスに1点、マスの中央に置き、下端の中央が地面に接するように。となりの絵と重ねない
- 小さく表示してもシルエットで見分けられる形。文字・ロゴ・数字・人は入れない
- 名所・神社・乗り物は実在のものにそっくりにせず、それらしく描く。会社のマークや商品のパッケージは描かない

【並べるもの（左から右へ）】${sheet.prefName}の「${role.title}」
${lines.join("\n")}

English keywords: cute miniature game item icons, isometric top-down 45 degree view,
soft pastel colors, simple bold outlines, no shadow, no ground, transparent background,
5 items in a single horizontal row, one item per cell, centered, no text, no people`;
}

function printSheet(sheet: Sheet): void {
  const state = isDone(sheet) ? "（絵はもうある）" : isPlaced(sheet) ? "（シートは置いてある。まだ切り分けていない）" : "";
  console.log(`\n==== ${sheet.id}  ${sheet.prefName} ${sheet.rank}個目 → art/chizu-tane/sheets/${sheet.id}.png に保存 ${state}\n`);
  console.log(prompt(sheet));
}

function printStatus(): void {
  const done = ALL_SHEETS.filter(isDone).length;
  console.log(`ご当地の絵: ${done} / ${ALL_SHEETS.length} シート（${done * 5} / ${ALL_SHEETS.length * 5} 点）。○ 絵がある・△ シートを置いた・・ まだ`);
  for (const p of TANE_LOCAL_PREFS) {
    const marks = ALL_SHEETS.filter((s) => s.prefCode === p.prefCode)
      .map((s) => (isDone(s) ? "○" : isPlaced(s) ? "△" : "・"))
      .join("");
    console.log(`  ${p.prefCode} ${p.prefName.padEnd(4, "　")} ${marks}`);
  }
}

const STYLE_REFERENCE = join(ROOT, "art/chizu-tane/style-reference.png");
const PROMPTS_FILE = join(ROOT, "art/chizu-tane/local-prompts.md");

/** 見本の画像に並べるもの(手順書の手順1と同じ9点。各コースの Lv.1 から)。シートから切り抜いて 3×3 に並べる */
const STYLE_REFERENCE_ITEMS: [sheet: string, itemId: string][] = [
  ["plant-1", "orchard_1"],
  ["animal-1", "bird_woods_1"],
  ["hobby-1", "photo_spot_1"],
  ["vehicle-1", "cycle_port_1"],
  ["building-1", "bakery_1"],
  ["plant-1", "flower_field_1"],
  ["animal-1", "petting_farm_1"],
  ["vehicle-1", "work_vehicle_depot_1"],
  ["building-1", "bakery_3"],
];

/** 見本の画像(白地に 3×3)を、通常のアイテムのシートから作る。ChatGPT に毎回添付する1枚 */
async function makeStyleReference(): Promise<void> {
  const CELL = 340;
  const pieces = new Map<string, Rgba | null>();
  for (const sheet of new Set(STYLE_REFERENCE_ITEMS.map(([s]) => s))) {
    const file = join(SHEETS_DIR, `${sheet}.png`);
    if (!existsSync(file)) throw new Error(`${file} がありません(見本は通常のアイテムのシートから作る)`);
    for (const [id, piece] of await cutSheet(file, sheetRows(sheet)!)) pieces.set(id, piece);
  }
  const layers: sharp.OverlayOptions[] = [];
  for (const [i, [, id]] of STYLE_REFERENCE_ITEMS.entries()) {
    const piece = pieces.get(id);
    if (!piece) throw new Error(`${id} の絵が見つかりません`);
    const { data, info } = await sharp(piece.data, { raw: { width: piece.width, height: piece.height, channels: 4 } })
      .resize(CELL - 40, CELL - 40, { fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    // 下端の中央が地面に接するように、マスの下に寄せて左右中央に置く
    const left = (i % 3) * CELL + Math.round((CELL - info.width) / 2);
    const top = Math.floor(i / 3) * CELL + (CELL - 20 - info.height);
    layers.push({ input: data, left, top });
  }
  await sharp({ create: { width: CELL * 3, height: CELL * 3, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .png()
    .toFile(STYLE_REFERENCE);
  console.log("見本を作りました: art/chizu-tane/style-reference.png");
}

/** 全部の頼む文を1つのファイルに。無料版で少しずつ作れるよう、1シートごとに新しい会話で見本を添付して貼る形 */
async function writePromptsFile(): Promise<void> {
  if (!existsSync(STYLE_REFERENCE)) await makeStyleReference();
  const out: string[] = [
    "# ご当地のものの絵の頼む文（ChatGPT 用）",
    "",
    "`npx tsx scripts/chizu-tane/local-art-prompts.mts --file` が作るファイル。手で直さない（直すのは local-art-prompts.mts と localItems.ts）。",
    "",
    "1シートごとに:",
    "",
    "1. ChatGPT で**新しい会話**を開く",
    "2. 見本 `art/chizu-tane/style-reference.png` を添付する",
    "3. 下の枠の中を全部コピーして貼り、送る",
    "4. できた画像を保存し、名前を「保存するファイル名」にして `art/chizu-tane/sheets/` に置く",
    "5. `npx tsx scripts/chizu-tane/process-item-images.mts local-13-1` のように切り分ける（引数なしなら置いてあるもの全部）",
    "",
    "5つが2段になった・絵が重なった・違うものが描かれたときは、同じ会話で「横1列に5つで描き直して」「3つ目は○○なので描き直して」と頼む。",
    "進み具合は `npx tsx scripts/chizu-tane/local-art-prompts.mts --status`（このファイルを作り直すと、絵のあるシートは ☑ になる）。",
    "",
  ];
  for (const p of TANE_LOCAL_PREFS) {
    out.push(`## ${p.prefCode} ${p.prefName}`, "");
    for (const sheet of ALL_SHEETS.filter((s) => s.prefCode === p.prefCode)) {
      const mark = isDone(sheet) ? "☑" : "□";
      out.push(`### ${mark} ${sheet.prefName} ${sheet.rank}個目（${ROLES[sheet.rank].title}） → 保存するファイル名: \`${sheet.id}.png\``, "");
      out.push("```", prompt(sheet), "```", "");
    }
  }
  writeFileSync(PROMPTS_FILE, out.join("\n"));
  console.log(`${ALL_SHEETS.length} シートの頼む文を書き出しました: art/chizu-tane/local-prompts.md`);
}

const REDO_FILE = join(ROOT, "art/chizu-tane/redo.md");
const REDO_PROMPTS_FILE = join(ROOT, "art/chizu-tane/redo-prompts.md");
const REDO_PER_SHEET = 9;

/** 描き直しの 3×3 のシート(9点。都道府県をまたぐ)の頼む文 */
function redoPrompt(itemIds: string[]): string {
  const lines = itemIds.map((id, i) => {
    const [, course, prefCode, rank] = /^local_([a-z]+)_p(\d{2})_([123])$/.exec(id)! as unknown as [string, (typeof LOCAL_SHEET_COURSES)[number], string, string];
    const item = localItemFor(prefCode, course, Number(rank))!;
    const prefName = TANE_LOCAL_PREFS.find((p) => p.prefCode === prefCode)!.prefName;
    const note = NOTES[item.name];
    return `${i + 1}. ${item.name}（${prefName}。${note ? `${note}。` : ""}${ROLES[Number(rank)].courses[course]}）`;
  });
  const rows = Math.ceil(itemIds.length / 3);
  return `添付した画像と同じ絵柄で、ゲーム用のアイテムの絵を、${rows}行×3列（左上から右へ、1行ずつ）に並べた1枚の正方形の画像で作ってください。
視点・線の太さ・色合い・光の向きを添付の画像にそろえてください。添付の画像は絵柄の見本で、描くもの・並べ方はまねしないでください。

【絵の決まり】
- 斜め上（45度くらい）から見下ろした視点。光は左上から
- 足元の影・台座・地面・草は描かない。背景は透明（無理なら真っ白の無地）
- ${rows}行×3列のマス。1マスに1点、マスの中央に置き、下端の中央が地面に接するように。となりの絵と重ねない。行と行の間もあける
- 小さく表示してもシルエットで見分けられる形。文字・ロゴ・数字・人は入れない
- 会社のマークや商品のパッケージは描かない

【並べるもの（左上から右へ、1行に3つずつ）】日本の各地の名物
${lines.join("\n")}

English keywords: cute miniature game item icons, isometric top-down 45 degree view,
soft pastel colors, simple bold outlines, no shadow, no ground, transparent background,
${rows}x3 grid, one item per cell, centered, no text, no people`;
}

/**
 * redo.md のまだ直していない(- [ ])行にある1個目のご当地のものを、9点ずつの 3×3 のシートにして
 * art/chizu-tane/redo-prompts.md に書き出す。並びは redo-sheets.json に残す(process-item-images.mts が redo-1 などを切り分けるのに使う)。
 * 画像を置いたシート(sheets/redo-N.png がある)の並びはそのまま残し、新しいシートはその次の番号から
 */
function writeRedoPromptsFile(): void {
  const ids: string[] = [];
  for (const line of readFileSync(REDO_FILE, "utf8").split(/\r?\n/)) {
    if (!line.startsWith("- [ ]")) continue;
    for (const id of line.match(/local_[a-z]+_p\d{2}_1\b/g) ?? []) if (!ids.includes(id)) ids.push(id);
  }
  const old: Record<string, string[][]> = existsSync(REDO_SHEETS_FILE) ? JSON.parse(readFileSync(REDO_SHEETS_FILE, "utf8")) : {};
  const sheets = Object.fromEntries(Object.entries(old).filter(([id]) => isPlaced({ id } as Sheet)));
  const first = Math.max(0, ...Object.keys(sheets).map((id) => Number(id.slice("redo-".length)))) + 1;
  const out: string[] = [
    "# 描き直す1個目の絵の頼む文（ChatGPT 用）",
    "",
    "`npx tsx scripts/chizu-tane/local-art-prompts.mts --redo` が redo.md のまだ直していない（`- [ ]`）1個目から作るファイル。手で直さない（直すのは redo.md と local-art-prompts.mts の NOTES）。",
    "",
    "1シートに、都道府県をまたいで9点（3×3）。1シートごとに:",
    "",
    "1. ChatGPT で**新しい会話**を開く",
    "2. 見本 `art/chizu-tane/style-reference.png` を添付する",
    "3. 下の枠の中を全部コピーして貼り、送る",
    "4. できた画像を保存し、名前を「保存するファイル名」にして `art/chizu-tane/sheets/` に置く",
    "5. `npx tsx scripts/chizu-tane/process-item-images.mts redo-1` のように切り分ける",
    "6. 直ったものは redo.md で `[x]` にする",
    "",
    "**シートを置いてから切り分けるまでの間は、このファイルを作り直さない**（並びが変わると、違うアイテムに切り分けられる。並びは `redo-sheets.json`）。画像を置いたシートの並びは残り、新しいシートは次の番号になる（引数なしで切り分けると番号の順に処理するので、あとのシートの絵が残る）。",
    "",
  ];
  for (let i = 0; i < ids.length; i += REDO_PER_SHEET) {
    const chunk = ids.slice(i, i + REDO_PER_SHEET);
    const id = `redo-${first + i / REDO_PER_SHEET}`;
    sheets[id] = Array.from({ length: Math.ceil(chunk.length / 3) }, (_, r) => chunk.slice(r * 3, r * 3 + 3));
    out.push(`## ${id} → 保存するファイル名: \`${id}.png\``, "");
    out.push(...chunk.map((itemId) => `- \`${itemId}\``), "");
    out.push("```", redoPrompt(chunk), "```", "");
  }
  writeFileSync(REDO_PROMPTS_FILE, out.join("\n"));
  writeFileSync(REDO_SHEETS_FILE, `${JSON.stringify(sheets, null, 2)}\n`);
  console.log(`${ids.length} 点(${Math.ceil(ids.length / REDO_PER_SHEET)} シート、redo-${first} から)の頼む文を書き出しました: art/chizu-tane/redo-prompts.md`);
}

/**
 * 引数からシートを選ぶ。都道府県(13)・シート(13-2)を指定すればそれを、無ければまだ絵の無いシートを --next の数(3)だけ。
 * generate-local-art.mts でも使う
 */
export function selectSheets(args: string[]): Sheet[] {
  const named = args.filter((a) => /^\d{1,2}(-[123])?$/.test(a));
  if (named.length > 0) {
    return named.flatMap((a) => {
      const [pref, rank] = a.split("-");
      const code = pref.padStart(2, "0");
      const found = ALL_SHEETS.filter((s) => s.prefCode === code && (!rank || s.rank === Number(rank)));
      if (found.length === 0) console.warn(`! ${a}: ご当地のものが決まっていません`);
      return found;
    });
  }
  const nextIndex = args.indexOf("--next");
  const count = nextIndex >= 0 ? Number(args[nextIndex + 1]) || 3 : 3;
  return ALL_SHEETS.filter((s) => !isDone(s) && !isPlaced(s)).slice(0, count);
}

// generate-local-art.mts から読み込まれたときは動かさない
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    printStatus();
  } else if (args.includes("--file")) {
    await writePromptsFile();
  } else if (args.includes("--redo")) {
    writeRedoPromptsFile();
  } else {
    const sheets = selectSheets(args);
    if (sheets.length === 0) console.log("まだ絵の無いシートはありません");
    for (const s of sheets) printSheet(s);
    const unknown = Object.keys(NOTES).filter((name) => !ALL_SHEETS.some((s) => LOCAL_SHEET_COURSES.some((c) => localItemFor(s.prefCode, c, s.rank)?.name === name)));
    if (unknown.length > 0) console.warn(`\n! NOTES にあるが、ご当地のものに無い名前: ${unknown.join("、")}`);
  }
}
