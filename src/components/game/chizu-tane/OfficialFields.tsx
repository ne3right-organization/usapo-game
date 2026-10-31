"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TaneCourse } from "@/lib/game/chizuTane/courses";
import { growthStage } from "@/lib/game/chizuTane/growth";
import { OFFICIAL_DAILY_LIMIT, officialDayKey, officialFieldsFor } from "@/lib/game/chizuTane/official";
import { fetchOfficialVisits, taneDayMs, type TaneOfficialVisit } from "@/lib/game/chizuTaneData";
import { ErrorText, GrowthStageIcon, ItemIcon, Loading } from "./TaneParts";

// トップの「公式の畑」(src/lib/game/chizuTane/official.ts)。ほかのコースの Lv.1 のもの12か所を 3×4 に並べ、
// 押すとその畑の画面(OfficialFieldView)へ行く。畑ごとに、まだ行っていない・育ち・実っている・タネが落ちている・おしまい を出す
export default function OfficialFields({ course }: { course: TaneCourse }) {
  const [visits, setVisits] = useState<TaneOfficialVisit[] | null>(null);
  const [error, setError] = useState("");
  const fields = officialFieldsFor(course);

  useEffect(() => {
    let cancelled = false;
    fetchOfficialVisits()
      .then((v) => !cancelled && setVisits(v))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const today = officialDayKey(new Date(), taneDayMs());
  const byField = new Map(visits?.map((v) => [v.fieldId, v]));
  const left = Math.max(0, OFFICIAL_DAILY_LIMIT - (visits?.filter((v) => v.visitedOn === today).length ?? 0));

  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-1">
        公式の畑
        {visits && (
          <span className="ml-1 text-xs font-normal text-[#a8937a]">
            （おしまい {fields.filter((f) => byField.get(f.fieldId)?.harvestedAt).length}/{fields.length}か所）
          </span>
        )}
      </h2>
      <p className="text-[11px] text-[#a8937a] mb-2 leading-relaxed">
        うさぽ農園の、ほかのコースの Lv.1 の畑です。遠くからチェックインして、ほかの人の畑と同じように水をやって実らせ、実とタネをもらえます。初めての畑はたずねたタネ1か所と数えます
      </p>
      {error && <ErrorText message={error} />}
      {!visits && !error && <Loading />}
      {visits && (
        <>
          <p className={`text-[11px] mb-1 ${left > 0 ? "text-emerald-700" : "text-[#a16207]"}`}>
            {left > 0 ? `今日は、あと${left}か所の新しい畑に行けます` : "今日は新しい畑にはもう行けません（行ったことのある畑には行けます）"}
          </p>
          <ul className="grid grid-cols-3 gap-2">
            {fields.map((f) => {
              const v = byField.get(f.fieldId);
              const done = !!v?.harvestedAt;
              const ripe = (v?.fruits ?? 0) > 0;
              const status = !v ? "まだ行っていない" : done ? "✓ おしまい" : ripe ? "実っている" : "育っている";
              return (
                <li key={f.fieldId}>
                  <Link
                    href={`/game/chizu-tane/official/${f.fieldId}`}
                    className={`relative block h-full rounded-2xl p-2 text-center active:scale-[0.98] transition-transform ${
                      done ? "bg-[#f5f0e8]" : "bg-white shadow-[0_2px_8px_rgba(120,90,40,0.06)]"
                    }`}
                  >
                    {(v?.droppedSeeds ?? 0) > 0 && (
                      <span className="absolute top-1 right-1 text-xs" aria-label="タネが落ちている">
                        🌰
                      </span>
                    )}
                    <p className="text-[11px] font-bold text-[#3c2a14] leading-tight truncate">
                      {f.baseType.emoji} {f.baseType.name}
                    </p>
                    <div className="h-9 flex items-center justify-center mt-1">
                      {v && !done ? (
                        <GrowthStageIcon stage={growthStage(v)} seedItemId={f.item.itemId} size={30} />
                      ) : (
                        <ItemIcon item={f.item} size={30} silhouette={!v} />
                      )}
                    </div>
                    <p className="text-[10px] text-[#78716c] truncate">{f.item.name}</p>
                    <p className={`text-[10px] mt-0.5 ${done ? "text-emerald-700" : ripe ? "text-amber-600 font-bold" : "text-[#a8937a]"}`}>{status}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
