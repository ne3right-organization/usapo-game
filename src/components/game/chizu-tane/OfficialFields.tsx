"use client";

import { useEffect, useState } from "react";
import { TANE_ITEM_BY_ID, type TaneCourse } from "@/lib/game/chizuTane/courses";
import { OFFICIAL_DAILY_LIMIT, officialDayKey, officialFieldsFor } from "@/lib/game/chizuTane/official";
import { checkInOfficialField, fetchOfficialVisits, taneDayMs, type TaneOfficialVisit } from "@/lib/game/chizuTaneData";
import SwipePages from "./SwipePages";
import { ErrorText, ItemIcon, Loading } from "./TaneParts";

// トップの「公式の畑」(src/lib/game/chizuTane/official.ts)。ほかのコースの Lv.1 の種類のもの12か所に遠くからチェックインして、実とタネを1個ずつもらう。
// 新しい公式の畑は1日3か所まで。チェックインした公式の畑はたずねたタネ1か所と数える(onCheckedIn でトップのレベルを読み直す)
export default function OfficialFields({ course, onCheckedIn }: { course: TaneCourse; onCheckedIn: () => void }) {
  const [visits, setVisits] = useState<TaneOfficialVisit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
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
  const visited = new Set(visits?.map((v) => v.fieldId));
  const todayCount = visits?.filter((v) => v.visitedOn === today).length ?? 0;
  const left = Math.max(0, OFFICIAL_DAILY_LIMIT - todayCount);

  const handleCheckIn = async (fieldId: string) => {
    if (busy) return;
    setBusy(fieldId);
    setError("");
    setMessage("");
    try {
      const result = await checkInOfficialField(fieldId);
      const now = new Date().toISOString();
      setVisits((cur) => [...(cur ?? []), { userId: "", fieldId, visitedAt: now, visitedOn: today, createdAt: now, updatedAt: now }]);
      const item = TANE_ITEM_BY_ID.get(result.itemId);
      setMessage(
        `🧺 「${item?.name ?? result.itemId}」の実とタネをもらいました。タネはおでかけでまけます。たずねたタネに1か所数えます` +
          (result.leveledUp ? `。Lv.${result.level} に上がって、新しいタネが届きました！` : "")
      );
      onCheckedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      fetchOfficialVisits().then(setVisits).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-1">
        公式の畑
        {visits && (
          <span className="ml-1 text-xs font-normal text-[#a8937a]">
            （{fields.filter((f) => visited.has(f.fieldId)).length}/{fields.length}か所）
          </span>
        )}
      </h2>
      <p className="text-[11px] text-[#a8937a] mb-2 leading-relaxed">
        うさぽ農園の、ほかのコースの Lv.1 の畑です。遠くからチェックインすると、その実とタネを1個ずつもらえて、たずねたタネ1か所と数えます（1か所に1回、新しい畑は1日{OFFICIAL_DAILY_LIMIT}か所まで）
      </p>
      {error && <ErrorText message={error} />}
      {message && <p className="text-xs text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2 mb-2">{message}</p>}
      {!visits && !error && <Loading />}
      {visits && (
        <>
          <p className={`text-[11px] mb-1 ${left > 0 ? "text-emerald-700" : "text-[#a16207]"}`}>
            {left > 0 ? `今日はあと${left}か所チェックインできます` : "今日はもうチェックインできません。また明日どうぞ"}
          </p>
          <SwipePages
            items={fields}
            perPage={9}
            layout="grid"
            keyOf={(f) => f.fieldId}
            render={(f) => {
              const done = visited.has(f.fieldId);
              return (
                <div className={`h-full rounded-2xl p-2 text-center ${done ? "bg-[#f5f0e8]" : "bg-white shadow-[0_2px_8px_rgba(120,90,40,0.06)]"}`}>
                  <p className="text-[11px] font-bold text-[#3c2a14] leading-tight truncate">
                    {f.baseType.emoji} {f.baseType.name}
                  </p>
                  <div className="h-9 flex items-center justify-center mt-1">
                    <ItemIcon item={f.item} size={30} />
                  </div>
                  <p className="text-[10px] text-[#78716c] truncate">{f.item.name}</p>
                  {done ? (
                    <p className="mt-1 text-[11px] text-emerald-700">✓ チェックイン済み</p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null || left === 0}
                      onClick={() => handleCheckIn(f.fieldId)}
                      className="mt-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 disabled:opacity-50"
                    >
                      {busy === f.fieldId ? "..." : "チェックイン"}
                    </button>
                  )}
                </div>
              );
            }}
          />
        </>
      )}
    </section>
  );
}
