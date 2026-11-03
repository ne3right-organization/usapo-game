"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TaneCourse } from "@/lib/game/chizuTane/courses";
import { growthStage } from "@/lib/game/chizuTane/growth";
import { OFFICIAL_DAILY_LIMIT, officialDayKey, officialFieldsFor } from "@/lib/game/chizuTane/official";
import { fetchOfficialVisits, taneDayMs, type TaneOfficialVisit } from "@/lib/game/chizuTaneData";
import { CardBody, CardGrid } from "./TaneCards";
import { ErrorText, GrowthStageIcon, ItemIcon, Loading } from "./TaneParts";

// トップの「公式の畑」(src/lib/game/chizuTane/official.ts)。ほかのコースの Lv.1 のもの12か所をカードで並べ(ふつうは 3×4。TaneCards)、
// 押すとその畑の画面(OfficialFieldView)へ行く。畑ごとに、まだ行っていない・育ち・実っている・タネが落ちている・おしまい を出す。
// 12か所とも終わったら(実をもらい、落ちているタネも拾った)、はじめは折りたたんで見出しだけ出す(見出しを押すと開く)
export default function OfficialFields({ course }: { course: TaneCourse }) {
  const [visits, setVisits] = useState<TaneOfficialVisit[] | null>(null);
  const [error, setError] = useState("");
  // 全部終わったときに開いているか(はじめは閉じる)
  const [open, setOpen] = useState(false);
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
  // 全部終わった(どの畑も実をもらっていて、落ちているタネも無い)
  const allDone =
    !!visits &&
    fields.every((f) => {
      const v = byField.get(f.fieldId);
      return !!v?.harvestedAt && (v.droppedSeeds ?? 0) === 0;
    });
  const folded = allDone && !open;

  const heading = (
    <>
      公式の畑
      {visits && (
        <span className="ml-1 text-xs font-normal text-[#a8937a]">
          （おしまい {fields.filter((f) => byField.get(f.fieldId)?.harvestedAt).length}/{fields.length}か所）
        </span>
      )}
    </>
  );

  return (
    <section className="mt-8">
      {allDone ? (
        <h2 className="mb-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="w-full flex items-center text-left text-sm font-bold text-[#3c2a14]"
          >
            <span className="flex-1">
              {heading}
              <span className="ml-1">🎉</span>
            </span>
            <span className="text-xs font-normal text-emerald-700">{open ? "▲ たたむ" : "▼ ひらく"}</span>
          </button>
        </h2>
      ) : (
        <h2 className="text-sm font-bold text-[#3c2a14] mb-1">{heading}</h2>
      )}
      {!folded && (
        <>
          <p className="text-2xs text-[#a8937a] mb-2 leading-relaxed">
            うさぽ農園の、ほかのコースの Lv.1
            の畑です。遠くからチェックインして、ほかの人の畑と同じように水をやって実らせ、実とタネをもらえます。初めての畑はたずねたタネ1か所と数えます
          </p>
          {error && <ErrorText message={error} />}
          {!visits && !error && <Loading />}
          {visits && (
            <>
              <p className={`text-2xs mb-1 ${left > 0 ? "text-emerald-700" : "text-[#a16207]"}`}>
                {left > 0
                  ? `今日は、あと${left}か所の新しい畑に行けます`
                  : "今日は新しい畑にはもう行けません（行ったことのある畑には行けます）"}
              </p>
              <CardGrid as="ul">
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
                        <CardBody
                          corner={(v?.droppedSeeds ?? 0) > 0 && <span aria-label="タネが落ちている">🌰</span>}
                          icon={
                            v && !done ? (
                              <GrowthStageIcon stage={growthStage(v)} seedItemId={f.item.itemId} size={30} />
                            ) : (
                              <ItemIcon item={f.item} size={30} silhouette={!v} />
                            )
                          }
                          title={`${f.baseType.emoji} ${f.baseType.name}`}
                          // 大きめ(2列)で名前が2行になってカードの見た目がそろわないので、1行で切る
                          titleLines={1}
                          note={
                            <span
                              className={`block text-3xs mt-0.5 ${done ? "text-emerald-700" : ripe ? "text-amber-600 font-bold" : "text-[#a8937a]"}`}
                            >
                              {status}
                            </span>
                          }
                        >
                          <span className="block text-3xs text-[#78716c] leading-tight line-clamp-2">{f.item.name}</span>
                        </CardBody>
                      </Link>
                    </li>
                  );
                })}
              </CardGrid>
            </>
          )}
        </>
      )}
    </section>
  );
}
