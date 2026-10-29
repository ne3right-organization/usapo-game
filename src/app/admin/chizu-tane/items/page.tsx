import type { Metadata } from "next";
import Link from "next/link";
import { PROTOTYPE_MAX_LEVEL, TANE_COURSES, TANE_ITEMS, baseTypesOf } from "@/lib/game/chizuTane/courses";
import { ItemIcon, SeedIcon } from "@/components/game/chizu-tane/TaneParts";

// 管理: アイテム定義(src/lib/game/chizuTane/courses.ts)と、その絵の一覧。
// 絵を描く人との確認用。絵ができたら courses.ts のアイテムに imageUrl を足すと、ここにも出る
export const metadata: Metadata = {
  title: "うさぽ農園 アイテム一覧",
};

export default function ChizuTaneItemsPage() {
  const withImage = TANE_ITEMS.filter((i) => i.imageUrl).length;
  return (
    <main className="max-w-4xl mx-auto px-4 py-6 text-[#3c2a14]">
      <Link href="/admin" className="text-xs text-emerald-700">
        ← 管理のトップ
      </Link>
      <h1 className="text-xl font-bold mb-1 mt-2">うさぽ農園 アイテム一覧</h1>
      <p className="text-xs text-[#78716c] mb-1">
        定義: <code>src/lib/game/chizuTane/courses.ts</code>。アイテム {TANE_ITEMS.length}件（絵あり {withImage}件、ほかは絵文字で仮置き）
      </p>
      <p className="text-xs text-[#78716c] mb-6">いまの試作で手に入るのは Lv.{PROTOTYPE_MAX_LEVEL} までの種類です（それより上は名前と絵文字を仮に決めただけで、まだ手に入りません）。アイテムが未定義の種類は「—」</p>

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
                  <th className="px-2 py-1.5">itemId</th>
                  <th className="px-2 py-1.5">名前</th>
                  <th className="px-2 py-1.5 text-center">実</th>
                  <th className="px-2 py-1.5 text-center">タネ</th>
                  <th className="px-2 py-1.5">絵</th>
                </tr>
              </thead>
              <tbody>
                {baseTypesOf(course.id).map((type) => {
                  const items = TANE_ITEMS.filter((i) => i.baseTypeId === type.id);
                  const inPrototype = type.unlockLevel <= PROTOTYPE_MAX_LEVEL;
                  const typeCell = (rows: number) => (
                    <>
                      <td rowSpan={rows} className="px-2 py-1.5 align-top text-xs">
                        {type.unlockLevel}
                      </td>
                      <td rowSpan={rows} className="px-2 py-1.5 align-top">
                        <span className="mr-1">{type.emoji}</span>
                        {type.name}
                        <div className="text-[10px] text-[#a8937a]">{type.id}</div>
                        {inPrototype && <div className="text-[10px] text-emerald-700">試作で使う</div>}
                      </td>
                    </>
                  );
                  if (items.length === 0) {
                    return (
                      <tr key={type.id} className="border-t border-[#f0e6d2] text-[#c8b8a0]">
                        {typeCell(1)}
                        <td colSpan={6} className="px-2 py-1.5 text-xs">
                          —
                        </td>
                      </tr>
                    );
                  }
                  return items.map((item, idx) => (
                    <tr key={item.itemId} className="border-t border-[#f0e6d2]">
                      {idx === 0 && typeCell(items.length)}
                      <td className="px-2 py-1.5 text-xs">{item.rank}</td>
                      <td className="px-2 py-1.5 text-[11px] font-mono text-[#78716c]">{item.itemId}</td>
                      <td className="px-2 py-1.5">{item.name}</td>
                      <td className="px-2 py-1.5 text-center">
                        <ItemIcon item={item} size={36} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <SeedIcon item={item} size={36} />
                      </td>
                      <td className="px-2 py-1.5 text-[11px]">
                        {item.imageUrl ? (
                          <span className="text-emerald-700 break-all">{item.imageUrl}</span>
                        ) : (
                          <span className="text-[#a8937a]">絵文字（仮）</span>
                        )}
                      </td>
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
