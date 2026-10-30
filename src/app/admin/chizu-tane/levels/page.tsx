import type { Metadata } from "next";
import Link from "next/link";
import { PROTOTYPE_MAX_LEVEL, TANE_COURSES, TANE_LEVEL_THRESHOLDS, baseTypesOf, seedsForLevel } from "@/lib/game/chizuTane/courses";
import { GARDEN_DESIGNS, houseTierFor } from "@/lib/game/chizuTane/garden";
import { FRUITS_WHEN_RIPE, WATER_ONSITE, WATER_REMOTE, WATER_TO_RIPE } from "@/lib/game/chizuTane/growth";

// 管理: ユーザーのレベル・ガーデン・畑のランクの条件の一覧(数はコードの定義から出す)
export const metadata: Metadata = {
  title: "うさぽ農園 レベルとガーデンの条件",
};

export default function AdminLevelsPage() {
  const levels = Array.from({ length: Math.min(PROTOTYPE_MAX_LEVEL, TANE_LEVEL_THRESHOLDS.length) }, (_, i) => i + 1);
  return (
    <main className="max-w-5xl mx-auto px-4 py-6 text-[#3c2a14]">
      <Link href="/admin" className="text-xs text-emerald-700">
        ← 管理のトップ
      </Link>
      <h1 className="text-xl font-bold mb-1 mt-2">うさぽ農園 レベルとガーデンの条件</h1>
      <p className="text-xs text-[#78716c] mb-6">
        定義: <code>src/lib/game/chizuTane/courses.ts</code>（レベル）・<code>garden.ts</code>（ガーデン・家）・<code>growth.ts</code>（畑の育ち方）。見た目は{" "}
        <Link href="/admin/chizu-tane/gardens" className="underline">
          ガーデンのデザイン
        </Link>
      </p>

      <h2 className="font-bold mb-1">ユーザーのレベル</h2>
      <p className="text-xs text-[#78716c] mb-2">
        次のレベルに上がる条件: ほかの人のタネを決まった数だけ訪ねている（同じタネは何度訪ねても1つ）＋ いまのレベルのタネを3つともまいた。上がると、そのレベルの種類のタネを3つもらえる。上限は Lv.{PROTOTYPE_MAX_LEVEL}
      </p>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm bg-white rounded-xl overflow-hidden">
          <thead>
            <tr className="bg-[#f5ecd9] text-xs text-[#78716c] text-left">
              <th className="px-2 py-1.5">Lv</th>
              <th className="px-2 py-1.5">訪ねたタネの数</th>
              <th className="px-2 py-1.5">家と柵</th>
              {TANE_COURSES.map((c) => (
                <th key={c.id} className="px-2 py-1.5">
                  {c.emoji} {c.label}でもらうタネ
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels.map((lv) => (
              <tr key={lv} className="border-t border-[#f0e6d2] align-top">
                <td className="px-2 py-1.5 font-bold">{lv}</td>
                <td className="px-2 py-1.5">{lv === 1 ? "はじめ" : `${TANE_LEVEL_THRESHOLDS[lv - 1]}か所`}</td>
                <td className="px-2 py-1.5">{houseTierFor(lv).name}</td>
                {TANE_COURSES.map((c) => {
                  const type = baseTypesOf(c.id).find((t) => t.unlockLevel === lv);
                  return (
                    <td key={c.id} className="px-2 py-1.5 text-xs">
                      {type && (
                        <>
                          <span className="font-semibold">
                            {type.emoji} {type.name}
                          </span>
                          <div className="text-[#78716c]">{seedsForLevel(c.id, lv).map((i) => `${i.emoji}${i.name}`).join("・")}</div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-bold mb-1">ガーデン</h2>
      <p className="text-xs text-[#78716c] mb-2">開拓した地区の数で、別のデザインのガーデンが増える。置けるものの数は、すべてのガーデンを合わせて持っている数まで</p>
      <table className="text-sm bg-white rounded-xl overflow-hidden mb-8">
        <thead>
          <tr className="bg-[#f5ecd9] text-xs text-[#78716c] text-left">
            <th className="px-3 py-1.5">ガーデン</th>
            <th className="px-3 py-1.5">増える条件</th>
          </tr>
        </thead>
        <tbody>
          {GARDEN_DESIGNS.map((d) => (
            <tr key={d.id} className="border-t border-[#f0e6d2]">
              <td className="px-3 py-1.5">
                {d.emoji} {d.name}
              </td>
              <td className="px-3 py-1.5">{d.unlockPlanted === 0 ? "はじめから" : `${d.unlockPlanted}地区を開拓`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="font-bold mb-1">畑（まいたタネ）のランク</h2>
      <ul className="text-sm list-disc pl-5 space-y-1 bg-white rounded-xl p-4">
        <li>
          水が{WATER_TO_RIPE}たまると実る（現地のチェックインで{WATER_ONSITE}、持ち主が遠くからやると{WATER_REMOTE}。どちらも朝・昼・夜に1回ずつ）
        </li>
        <li>実の数はランク×{FRUITS_WHEN_RIPE}個。水をやって実らせた人は、そのまま1個もらえる</li>
        <li>実が全部取られるとランクが1つ上がり（10まで）、タネ待ちになる。持ち主が同じ種類の畑のタネをまき直すと、またタネから育つ（遠くからでもよい）。1週間まかないと空き地に戻る</li>
      </ul>
    </main>
  );
}
