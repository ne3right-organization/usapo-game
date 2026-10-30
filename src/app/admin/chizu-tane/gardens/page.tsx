import type { Metadata } from "next";
import Link from "next/link";
import { GARDEN_DESIGNS, GARDEN_HEIGHT, GARDEN_WIDTH, HOUSE_TIERS, type GardenObject } from "@/lib/game/chizuTane/garden";
import GardenSvg from "@/components/game/chizu-tane/GardenSvg";

// 管理: ガーデンのデザイン(開拓した地区の数で増える)× 家と柵の段階(レベルで立派になる)の見た目の一覧。
// 定義は src/lib/game/chizuTane/garden.ts、絵は src/components/game/chizu-tane/GardenSvg.tsx
export const metadata: Metadata = {
  title: "うさぽ農園 ガーデンのデザイン",
};

// 見本に少しだけものを置く
const SAMPLE: GardenObject[] = [
  { objectId: "s1", itemId: "orchard_1", x: 2, y: 3 },
  { objectId: "s2", itemId: "flower_field_2", x: 5, y: 2 },
  { objectId: "s3", itemId: "petting_farm_1", x: 4, y: 6 },
  { objectId: "s4", itemId: "bakery_3", x: 7, y: 5 },
];

export default function AdminGardensPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-6 text-[#3c2a14]">
      <Link href="/admin" className="text-xs text-emerald-700">
        ← 管理のトップ
      </Link>
      <h1 className="text-xl font-bold mb-1 mt-2">うさぽ農園 ガーデンのデザイン</h1>
      <p className="text-xs text-[#78716c] mb-6">
        横はユーザーのレベルで変わる家と柵、縦は開拓した地区の数で増えるガーデン。条件の一覧は{" "}
        <Link href="/admin/chizu-tane/levels" className="underline">
          レベルとガーデンの条件
        </Link>
      </p>
      {GARDEN_DESIGNS.map((d) => (
        <section key={d.id} className="mb-8">
          <h2 className="font-bold mb-2">
            {d.emoji} {d.name}
            <span className="ml-2 text-xs font-normal text-[#a8937a]">
              （{d.id}。{d.unlockPlanted === 0 ? "はじめから" : `${d.unlockPlanted}地区を開拓すると増える`}）
            </span>
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {HOUSE_TIERS.map((t) => (
              <figure key={t.id} className="bg-white rounded-xl p-2 shadow-[0_2px_8px_rgba(120,90,40,0.06)]">
                <GardenSvg width={GARDEN_WIDTH} height={GARDEN_HEIGHT} objects={SAMPLE} design={d.id} houseTier={t.id} />
                <figcaption className="text-xs text-center text-[#78716c] mt-1">
                  {t.name}（Lv.{t.minLevel}〜）
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
