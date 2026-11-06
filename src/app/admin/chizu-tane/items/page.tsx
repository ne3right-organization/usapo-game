import type { Metadata } from "next";
import Link from "next/link";
import { MAX_LEVEL_DEV, MAX_LEVEL_PRODUCTION, TANE_COURSES, TANE_ITEMS, type TaneItem, baseTypesOf } from "@/lib/game/chizuTane/courses";
import { TANE_LOCAL_BASE_TYPE_IDS, TANE_LOCAL_ITEMS, TANE_LOCAL_PREFS, TANE_LOCAL_RANK_ROLES } from "@/lib/game/chizuTane/localItems";
import { ItemIcon, SeedIcon } from "@/components/game/chizu-tane/TaneParts";
import { MYSTERY_BASE_TYPE, MYSTERY_ITEMS } from "@/lib/game/chizuTane/mysteryItems";
import { GACHA_MYSTERY_RATE } from "@/lib/game/chizuTane/gacha";

// 管理: アイテム定義(src/lib/game/chizuTane/courses.ts)と、その絵の一覧。
// 絵を描く人との確認用。絵ができたら courses.ts のアイテムに imageUrl を足すと、ここにも出る
export const metadata: Metadata = {
  title: "うさぽ農園 アイテム一覧",
};

export default function ChizuTaneItemsPage() {
  const withImage = TANE_ITEMS.filter((i) => i.imageUrl).length;
  const localWithImage = () => TANE_LOCAL_ITEMS.filter((i) => i.imageUrl).length;
  return (
    <main className="max-w-4xl mx-auto px-4 py-6 text-[#3c2a14]">
      <Link href="/admin" className="text-xs text-emerald-700">
        ← 管理のトップ
      </Link>
      <h1 className="text-xl font-bold mb-1 mt-2">うさぽ農園 アイテム一覧</h1>
      <p className="text-xs text-[#78716c] mb-1">
        定義: <code>src/lib/game/chizuTane/courses.ts</code>。アイテム {TANE_ITEMS.length}件（絵あり {withImage}件、ほかは絵文字で仮置き）。
        絵は <code>public/chizu-tane/items/</code>（作り方は docs/地図タネ_絵の作り方.md）
      </p>
      <p className="text-xs mb-1">
        <a href="#local" className="text-emerald-700 underline">
          📍 ご当地の一覧へ（絵あり {localWithImage()} / {TANE_LOCAL_ITEMS.length}件）
        </a>
        <a href="#mystery" className="ml-3 text-emerald-700 underline">
          {MYSTERY_BASE_TYPE.emoji} {MYSTERY_BASE_TYPE.name}の一覧へ
        </a>
      </p>
      <p className="text-xs text-[#78716c] mb-6">レベルは本番で Lv.{MAX_LEVEL_PRODUCTION}、テスト用（devgame・手元）で Lv.{MAX_LEVEL_DEV} まで上がり、その種類のものが手に入ります（絵が無いものは絵文字で出します。薄い行は本番ではまだ手に入りません）。アイテムが未定義の種類は「—」</p>

      {TANE_COURSES.map((course) => (
        <section key={course.id} className="mb-8">
          <h2 className="font-bold mb-2">
            {course.emoji} {course.label}コース <span className="text-xs font-normal text-[#a8937a]">({course.id})</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse bg-white rounded-xl overflow-hidden">
              <thead>
                <tr className="bg-[#f5ecd9] text-xs text-[#78716c] text-left">
                  <th className="px-2 py-1.5">Lv</th>
                  <th className="px-2 py-1.5">タネの種類</th>
                  <th className="px-2 py-1.5">ランク</th>
                  <ItemHeaders />
                </tr>
              </thead>
              <tbody>
                {baseTypesOf(course.id).map((type) => {
                  const items = TANE_ITEMS.filter((i) => i.baseTypeId === type.id);
                  const inPrototype = type.unlockLevel <= MAX_LEVEL_PRODUCTION;
                  const typeCell = (rows: number) => (
                    <>
                      <td rowSpan={rows} className="px-2 py-1.5 align-top text-xs">
                        {type.unlockLevel}
                      </td>
                      <td rowSpan={rows} className="px-2 py-1.5 align-top">
                        <span className="mr-1">{type.emoji}</span>
                        {type.name}
                        <div className="text-3xs text-[#a8937a]">{type.id}</div>
                        {inPrototype && <div className="text-3xs text-emerald-700">試作で使う</div>}
                      </td>
                    </>
                  );
                  if (items.length === 0) {
                    return (
                      <tr key={type.id} className="border-t border-[#f0e6d2] text-[#c8b8a0]">
                        {typeCell(1)}
                        <td colSpan={7} className="px-2 py-1.5 text-xs">
                          —
                        </td>
                      </tr>
                    );
                  }
                  return items.map((item, idx) => (
                    <tr key={item.itemId} className="border-t border-[#f0e6d2]">
                      {idx === 0 && typeCell(items.length)}
                      <td className="px-2 py-1.5 text-xs">{item.rank}</td>
                      <ItemCells item={item} />
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section id="mystery" className="mb-8 scroll-mt-4">
        <h2 className="font-bold mb-1">
          {MYSTERY_BASE_TYPE.emoji} {MYSTERY_BASE_TYPE.name}（なぞのタネ）<span className="text-xs font-normal text-[#a8937a]"> ({MYSTERY_BASE_TYPE.id})</span>
        </h2>
        <p className="text-xs text-[#78716c] mb-3">
          定義: <code>src/lib/game/chizuTane/mysteryItems.ts</code>。毎日のガチャ（<code>gacha.ts</code>）で {Math.round(GACHA_MYSTERY_RATE * 100)}% で出るなぞのタネからなるもの。
          {MYSTERY_ITEMS.length}件（絵あり {MYSTERY_ITEMS.filter((i) => i.imageUrl).length}件）。遊ぶ人には秘密（画面の説明・お知らせ・あそびかたには書かない）。絵は <code>kokumin</code> のシート
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse bg-white rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-[#f5ecd9] text-xs text-[#78716c] text-left">
                <th className="px-2 py-1.5">番号</th>
                <ItemHeaders />
              </tr>
            </thead>
            <tbody>
              {MYSTERY_ITEMS.map((item) => (
                <tr key={item.itemId} className="border-t border-[#f0e6d2]">
                  <td className="px-2 py-1.5 text-xs">{item.rank}</td>
                  <ItemCells item={item} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="local" className="mb-8 scroll-mt-4">
        <h2 className="font-bold mb-1">📍 ご当地（案のまま）</h2>
        <p className="text-xs text-[#78716c] mb-3">
          定義: <code>src/lib/game/chizuTane/localItems.ts</code>（設計書は docs/地図タネ_ご当地タネ設計書.md）。1つの都道府県につき 5コース × 3つ。
          {TANE_LOCAL_PREFS.length}都道府県・{TANE_LOCAL_ITEMS.length}件（絵あり {localWithImage()}件）。1個目＝現地で味わう・乗る・体験する、2個目＝持ち帰るお土産、3個目＝ガーデンに飾って見せたいもの。
          絵は1都道府県の同じ何個目の5点を1枚で頼む（docs/地図タネ_絵の作り方.md の4章）
        </p>
        <p className="text-xs mb-3">
          {TANE_COURSES.map((course) => (
            <a key={course.id} href={`#local-${course.id}`} className="mr-3 text-emerald-700 underline whitespace-nowrap">
              {course.emoji} {course.label}
            </a>
          ))}
        </p>
        <h3 className="text-sm font-bold mb-1">🔑 監修用のリンク（ご当地コレクションの秘密モード）</h3>
        <p className="text-xs text-[#78716c] mb-2">
          地元の人に見てもらう用。ログインしなくても、その都道府県の15種類を全部（絵の無いものは絵文字で）出す。リンクをコピーして渡す
        </p>
        <p className="text-xs leading-loose">
          {TANE_LOCAL_PREFS.map((p) => (
            <a
              key={p.prefCode}
              href={`/game/chizu-tane/collection/local?pref=${p.prefCode}&mode=secret`}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-3 text-emerald-700 underline whitespace-nowrap"
            >
              {p.prefName}
            </a>
          ))}
        </p>
      </section>

      {TANE_COURSES.map((course) => (
        <section key={course.id} id={`local-${course.id}`} className="mb-8 scroll-mt-4">
          <h2 className="font-bold mb-2">
            📍 ご当地・{course.emoji} {course.label}コース <span className="text-xs font-normal text-[#a8937a]">({TANE_LOCAL_BASE_TYPE_IDS[course.id]})</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse bg-white rounded-xl overflow-hidden">
              <thead>
                <tr className="bg-[#f5ecd9] text-xs text-[#78716c] text-left">
                  <th className="px-2 py-1.5">何個目</th>
                  <th className="px-2 py-1.5">都道府県</th>
                  <ItemHeaders />
                </tr>
              </thead>
              <tbody>
                {TANE_LOCAL_RANK_ROLES.map((role, r) => {
                  const items = TANE_LOCAL_ITEMS.filter((i) => i.rank === r + 1 && i.course === course.id);
                  return items.map((item, idx) => (
                    <tr key={item.itemId} className="border-t border-[#f0e6d2]">
                      {idx === 0 && (
                        <td rowSpan={items.length} className="px-2 py-1.5 align-top text-xs whitespace-nowrap">
                          {r + 1}
                          <div className="text-3xs text-[#a8937a]">{role}</div>
                        </td>
                      )}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {TANE_LOCAL_PREFS.find((p) => p.prefCode === item.local)?.prefName}
                        <div className="text-3xs text-[#a8937a]">{item.local}</div>
                      </td>
                      <ItemCells item={item} />
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}

/** アイテムの列の見出し(通常のコースとご当地で同じ) */
function ItemHeaders() {
  return (
    <>
      <th className="px-2 py-1.5">itemId</th>
      <th className="px-2 py-1.5">名前</th>
      <th className="px-2 py-1.5 text-center">絵文字</th>
      <th className="px-2 py-1.5 text-center">実</th>
      <th className="px-2 py-1.5 text-center">タネ</th>
      <th className="px-2 py-1.5">絵</th>
    </>
  );
}

/** アイテムの列(itemId・名前・絵文字・実・タネ・96px の絵) */
function ItemCells({ item }: { item: TaneItem }) {
  return (
    <>
      <td className="px-2 py-1.5 text-2xs font-mono text-[#78716c]">{item.itemId}</td>
      <td className="px-2 py-1.5">{item.name}</td>
      {/* 定義の絵文字(絵があると画面には出ないが、絵の無い所の代わりや文章の中で使う) */}
      <td className="px-2 py-1.5 text-center text-xl">{item.emoji}</td>
      <td className="px-2 py-1.5 text-center">
        <ItemIcon item={item} size={36} />
      </td>
      <td className="px-2 py-1.5 text-center">
        <SeedIcon item={item} size={36} />
      </td>
      <td className="px-2 py-1.5 text-2xs">
        {item.imageUrl ? (
          // 元の大きさ(96px)で、ガーデンの芝に近い色の上に出す(白いふちや背景の消し残しが見分けられる)
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} width={96} height={96} className="rounded-md" style={{ background: "#a8d08d" }} />
        ) : (
          <span className="text-[#a8937a]">絵文字（仮）</span>
        )}
      </td>
    </>
  );
}
