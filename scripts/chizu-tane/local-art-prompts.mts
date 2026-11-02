// うさぽ農園のご当地のもの(47都道府県 × 5コース × 3つ = 705点)の絵を、画像生成AIに頼む文(プロンプト)を出す。
// 手順は docs/地図タネ_絵の作り方.md の5章。
//
//   npx tsx scripts/chizu-tane/local-art-prompts.mts             # まだ絵の無いシートを3枚ぶん(= 1都道府県ぶん)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts --next 6    # まだ絵の無いシートを6枚ぶん
//   npx tsx scripts/chizu-tane/local-art-prompts.mts 13 14       # 都道府県を指定して(3枚ずつ)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts 13-2        # シートを指定して(東京都の2個目)
//   npx tsx scripts/chizu-tane/local-art-prompts.mts --status    # 都道府県ごとの進み具合だけ
//
// 1シート = 1都道府県の同じ何個目(現地で・お土産・見せたい)の5点を、横1列(植物・動物・趣味・乗り物・建物)に。
// 同じ役目のものを並べるので、大きさの感じがそろう。見本は通常のアイテムと同じ style-reference.png を毎回添付する。
// できた画像は art/chizu-tane/sheets/local-{都道府県コード}-{何個目}.png に置き、process-item-images.mts で切り分ける

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as localItemsModule from "../../src/lib/game/chizuTane/localItems";
import { LOCAL_SHEET_COURSES, localSheetId, sheetRows } from "./itemArt.mjs";

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
      vehicle: "旅の思い出になる名物の乗り物",
      building: "お土産の名物。箱や包み紙は描かず、中身を器か皿にのせて",
    },
  },
  3: {
    title: "ガーデンに飾って見せたいもの",
    courses: {
      plant: "名所の花・名木。花の咲いた木や群れ",
      animal: "立派な・珍しい生きもの",
      hobby: "大きく立派な工芸品・飾り",
      vehicle: "祭りの山車など。人は描かない",
      building: "名所の建物・神社。そっくりにせず、それらしく",
    },
  },
};

/**
 * AI に伝わりにくいものの補足(名前 → 見た目)。作業表の「かっこの中」と同じ。
 * 描かせてみて違うものが出てきたら、ここに足す(名前は localItems.ts と同じ書き方で)
 */
const NOTES: Record<string, string> = {
  尻屋崎の寒立馬: "ずんぐりした体の、たくましい馬",
  八幡馬: "赤や黒に塗って模様を描いた、木の馬の郷土玩具",
  こぎん刺しのタペストリー: "紺の布に白い糸で幾何学模様を刺した壁かけ",
  青森ねぶた: "武者の顔を描いた、大きな紙の灯籠の山車",
  三内丸山の六本柱: "太い木の柱が6本立った、縄文時代のやぐら",
  チャグチャグ馬コ: "色とりどりの飾りと鈴をつけた馬",
  三陸のさっぱ船: "小さな漁船",
  岩谷堂箪笥: "黒い金具のついた木のたんす",
  なまはげのお面: "赤い鬼のような顔のお面",
  竿燈まつりの竿燈: "たくさんの提灯をつり下げた長い竿",
  角館祭りのやま: "飾りをのせた木の山車",
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
  村上大祭のおしゃぎり: "彫刻と漆で飾った屋台",
  燕の鎚起銅器のたたき出し: "金づちでたたいて作る銅のやかん",
  村上の木彫堆朱: "朱色の漆を塗った、彫刻のあるお盆",
  能登のキリコ: "縦に長い大きな灯籠を、みんなで担ぐもの",
  高岡御車山: "金色の飾りのついた豪華な山車",
  富山の薬売りの紙風船: "四角い紙風船",
  井波彫刻の欄間: "木に細かい彫刻をした、横長の飾り板",
  千里浜なぎさドライブの車: "砂浜を走る車",
  勝山の恐竜: "まるっこい恐竜のぬいぐるみ",
  フクイラプトル: "大きなかぎ爪の、二本足の肉食恐竜",
  甲州印伝: "鹿の革に漆で小紋の模様をつけた小さな財布",
  諏訪の御柱: "太く長い丸太",
  飯田の水引細工: "紅白の水引で作った飾り結び",
  木曽のお六櫛: "目の細かい木のくし",
  飛騨のさるぼぼ: "赤い布で作った、顔の無い猿の人形",
  飛騨の朴葉みそ: "大きな朴の葉の上で焼くみそ",
  静岡のプラモデル: "飛行機のプラモデル",
  駿河竹千筋細工: "細い竹ひごで作った虫かご",
  遠州横須賀の祢里: "上に飾りの立った屋台",
  名古屋のガイドウェイバス: "高架の専用道を走るバス",
  犬山祭の車山: "からくり人形をのせた3階建ての山車",
  伊勢型紙の大きな図柄: "細かい模様を切り抜いた型紙",
  四日市祭の大入道: "首の長い大きな入道の人形",
  大津絵の掛け軸: "素朴な鬼の絵の掛け軸",
  丁稚ようかん: "竹の皮に包んだ、平たいようかん",
  堺のお香づくり: "線香と香炉",
  天神祭の御迎え人形: "派手な衣装の大きな人形",
  岸和田のだんじり: "彫刻のある木の山車",
  播州そろばん: "そろばん",
  灘のけんか祭りの屋台: "金色の飾りの屋台",
  那智の扇神輿: "扇と鏡を飾った、細長い神輿",
  紀州備長炭の炭焼き: "炭焼き窯と炭",
  用瀬の流しびな: "さん俵（丸いわら）にのせた、紙のひな人形",
  鳥取砂丘の砂の彫刻: "砂で作った大きな彫刻",
  出雲大社の龍蛇さま: "海から来る黄色い小さな海へび",
  石見神楽の大蛇: "とぐろを巻いた、大きなじゃばらの竜",
  ホーランエンヤの船: "旗や飾りで飾った船",
  備前焼の大きな狛犬: "茶色い焼きものの狛犬",
  勝山の喧嘩だんじり: "木のだんじり（山車）",
  宮島の管絃祭の御座船: "屋形をのせた、飾った和船",
  防府天満宮の御網代車: "牛が引く平安時代の車",
  柳井の金魚ちょうちん: "赤と白の金魚の形のちょうちん",
  阿波おどりの連: "編み笠をかぶって踊る人（1人）",
  宇和島の牛鬼: "牛のような鬼の顔に、長い胴の山車",
  土佐のフラフ: "大漁旗のような、絵の描かれた大きな旗",
  よさこいの鳴子: "木の板に黒い小さな打ち木をつけた、手で鳴らすもの",
  よさこい祭りの地方車: "飾りつけたトラック",
  有明海の潟スキー: "干潟を進む板（そり）",
  吉野ヶ里の物見やぐら: "弥生時代の高い木のやぐら",
  長崎のぽっぺん: "吹いて鳴らすガラスのおもちゃ",
  長崎のハタあげ: "白と赤の模様のひし形の凧",
  長崎くんちの川船: "飾りつけた和船の山車",
  別府竹細工のかご: "竹で編んだかご",
  都城大弓: "長い竹の弓",
  高千穂の神楽面: "神楽で使う木のお面",
  シーサー: "沖縄の獅子の焼きものの置物",
  紅型の着物: "あざやかな色の染めの着物",
  那覇のハーリー船: "竜の頭の飾りのついた細長い舟",
  竹富島の水牛車: "水牛が引く、屋根つきの車",
  "山寺（立石寺）": "岩山の上に建つお堂",
  三徳山の投入堂: "崖にはりつくように建つお堂",
  "ちょうさ（太鼓台）": "赤い布団を重ねたような飾りの太鼓台",
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
  return `添付した画像と同じ絵柄で、ゲーム用のアイテムの絵を、横1列に5つ並べた1枚の横長の画像で作ってください。
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
  } else {
    const sheets = selectSheets(args);
    if (sheets.length === 0) console.log("まだ絵の無いシートはありません");
    for (const s of sheets) printSheet(s);
    const unknown = Object.keys(NOTES).filter((name) => !ALL_SHEETS.some((s) => LOCAL_SHEET_COURSES.some((c) => localItemFor(s.prefCode, c, s.rank)?.name === name)));
    if (unknown.length > 0) console.warn(`
! NOTES にあるが、ご当地のものに無い名前: ${unknown.join("、")}`);
  }
}
