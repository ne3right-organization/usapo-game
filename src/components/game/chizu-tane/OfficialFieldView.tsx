"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TANE_ITEM_BY_ID, type TaneCourse } from "@/lib/game/chizuTane/courses";
import { slotKey } from "@/lib/game/chizuTane/geo";
import { WATER_TO_RIPE } from "@/lib/game/chizuTane/growth";
import { OFFICIAL_DAILY_LIMIT, OFFICIAL_WATER_PER_CHECKIN, officialDayKey, officialFieldsFor, type TaneOfficialField } from "@/lib/game/chizuTane/official";
import {
  checkInOfficialField,
  fetchOfficialVisits,
  isLocationOverrideAllowed,
  pickUpOfficialSeed,
  taneDayMs,
  type TaneOfficialVisit,
} from "@/lib/game/chizuTaneData";
import { ErrorText, GrowthBadge, ItemIcon, Loading, NeedStart, SeedIcon, TaneHeading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// 公式の畑の画面(/game/chizu-tane/official/[fieldId]。src/lib/game/chizuTane/official.ts)。
// ほかの人の畑をたずねる練習になるよう、おでかけ(HereView)のチェックインと同じ形にする:
// チェックインで水をやる → 実ったら、実らせた人がそのまま実をもらう。初めて来るとタネが1個落ちるので拾う

type Notice = { kind: "ok" | "info"; text: string; seed?: boolean; itemId?: string };

export default function OfficialFieldView({ fieldId }: { fieldId: string }) {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <TaneHeading title="🌾 公式の畑">うさぽ農園の畑で、ほかの人の畑のたずね方を練習できます</TaneHeading>
      <p className="text-xs mb-3">
        <Link href="/game/chizu-tane" className="text-emerald-700 underline underline-offset-2">
          ← トップの公式の畑の一覧へ
        </Link>
      </p>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <OfficialField course={state.player.course as TaneCourse} fieldId={fieldId} />}
    </TaneScreen>
  );
}

function OfficialField({ course, fieldId }: { course: TaneCourse; fieldId: string }) {
  const field = officialFieldsFor(course).find((f) => f.fieldId === fieldId);
  const [visits, setVisits] = useState<TaneOfficialVisit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOfficialVisits()
      .then((v) => !cancelled && setVisits(v))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!field) return <ErrorText message="この公式の畑はありません（自分のコースの畑は、公式の畑にはありません）" />;
  if (error && !visits) return <ErrorText message={error} />;
  if (!visits) return <Loading />;

  const reload = async () => setVisits(await fetchOfficialVisits());
  const now = new Date();
  const v = visits.find((x) => x.fieldId === fieldId);
  const done = !!v?.harvestedAt;
  const ripe = (v?.fruits ?? 0) > 0;
  const cameThisSlot = v?.lastCheckInOn === slotKey(now, taneDayMs());
  const todayCount = visits.filter((x) => x.visitedOn === officialDayKey(now, taneDayMs())).length;
  const limitReached = !v && todayCount >= OFFICIAL_DAILY_LIMIT;
  const dropped = v?.droppedSeeds ?? 0;
  const checkInsToRipe = Math.ceil(Math.max(0, WATER_TO_RIPE - (v?.water ?? 0)) / OFFICIAL_WATER_PER_CHECKIN);

  const handleCheckIn = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const res = await checkInOfficialField(fieldId);
      const parts: string[] = [];
      if (res.status === "fruit") {
        parts.push(`「${field.item.name}」の実を1個もらいました！（${field.item.name}は${res.quantity ?? 1}個目）この畑はこれでおしまいです。`);
      } else if (res.status === "ripened") {
        parts.push(
          `💧 水をやりました。実りました！ 実らせたので「${field.item.name}」の実を1個もらいました（${field.item.name}は${res.quantity ?? 1}個目）。この畑はこれでおしまいです。`
        );
      } else if (res.status === "watered") {
        const rest = Math.ceil(Math.max(0, WATER_TO_RIPE - res.water) / OFFICIAL_WATER_PER_CHECKIN);
        parts.push(`💧 水をやりました。あと${rest}回チェックインして水をやると実ります。`);
      } else {
        parts.push(alreadyText());
      }
      if (res.firstVisit) parts.push(`初めて来たので、ここに${field.item.name}のタネが落ちました。下から拾ってください。たずねたタネに1か所数えます。`);
      if (res.leveledUp && res.level) parts.push(`レベルが上がって Lv.${res.level} になりました！ 新しいタネをもらいました。`);
      setNotice({
        kind: res.status === "already" ? "info" : "ok",
        text: parts.join(" "),
        itemId: res.status === "fruit" || res.status === "ripened" || res.firstVisit ? field.item.itemId : undefined,
        seed: res.status !== "fruit" && res.status !== "ripened",
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handlePickUp = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const n = await pickUpOfficialSeed(fieldId);
      setNotice(
        n > 0
          ? { kind: "ok", text: `落ちていた${field.item.name}のタネを拾いました！ おでかけで、まだタネの無い地区にまけます`, itemId: field.item.itemId, seed: true }
          : { kind: "info", text: "拾えるタネはありませんでした" }
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-3">
        <p className="text-xs text-[#a8937a]">うさぽ農園</p>
        <p className="text-lg font-bold text-[#3c2a14]">公式の畑</p>
        <p className="text-[11px] text-[#a8937a] mt-1">遠くからチェックインできます。畑の育ちはあなた専用で、ほかの人とは分け合いません。</p>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 mb-4">
        <p className="text-sm text-[#3c2a14] mb-2">
          <span className="text-xl mr-1">{field.baseType.emoji}</span>
          公式の畑の{field.baseType.name}
          <span className="ml-1 text-xs text-[#a8937a]">（{field.item.name}）</span>
        </p>
        <div className="mb-2">
          {v ? (
            <GrowthBadge base={{ water: v.water, fruits: v.fruits, rank: 1, seedItemId: field.item.itemId }} />
          ) : (
            <span className="text-xs text-[#a8937a]">まだ来たことがありません</span>
          )}
          {!done && (
            <p className={`text-[11px] ${ripe ? "text-amber-700" : "text-[#78716c]"}`}>
              {ripe ? (
                "チェックインすると、実を1個もらえます"
              ) : (
                <>
                  💧 あと<span className="font-bold text-[#3c2a14]">{checkInsToRipe}回</span>チェックインして水をやると実ります
                </>
              )}
            </p>
          )}
        </div>

        {done ? (
          <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">✓ この畑の実はもらいました。この畑はおしまいです</p>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={busy || limitReached || cameThisSlot}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60"
            >
              {busy ? (
                "チェックイン中..."
              ) : ripe ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <ItemIcon item={field.item} size={24} />
                  チェックインして実をもらう
                </span>
              ) : (
                "💧 チェックインして水をやる"
              )}
            </button>
            {cameThisSlot && <p className="text-[11px] text-[#a16207] mt-1">{alreadyText()}</p>}
            {limitReached && (
              <p className="text-[11px] text-[#a16207] mt-1">新しい公式の畑に行けるのは1日{OFFICIAL_DAILY_LIMIT}か所までです。また明日どうぞ</p>
            )}
          </>
        )}

        {dropped > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-3">
            <p className="text-sm text-amber-900 mb-2">
              🌰 ここに{field.item.name}のタネが{dropped}個落ちています。拾うと、おでかけでまけます
            </p>
            <button
              type="button"
              onClick={handlePickUp}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-60"
            >
              1個拾う
            </button>
            <p className="text-[11px] text-amber-700 mt-2">ほかの人の畑では、落ちているタネは誰でも拾えます（早い者勝ち）。要らなければ次の人のために残しておけます</p>
          </div>
        )}

        {notice && (
          <div
            className={`mt-3 rounded-xl px-3 py-3 text-sm flex items-center gap-3 ${
              notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-[#f8f3ea] text-[#78716c]"
            }`}
          >
            {notice.itemId && TANE_ITEM_BY_ID.get(notice.itemId) && (notice.seed ? <SeedIcon item={field.item} size={40} /> : <ItemIcon item={field.item} size={40} />)}
            <span>{notice.text}</span>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ErrorText message={error} />
          </div>
        )}
      </div>

      <Steps field={field} visit={v} />
    </div>
  );
}

function alreadyText(): string {
  const dev = isLocationOverrideAllowed();
  return `この畑には、この時間帯はもう来ました。朝（4〜12時）・昼（12〜20時）・夜（20〜翌4時）にそれぞれ1回来られます${
    dev ? `（開発環境では${Math.round(taneDayMs() / 60_000)}分ごとに区切っているので、その区切りが変わればまた来られます）` : ""
  }`;
}

/** ほかの人の畑のたずね方(この畑でどこまでやったか) */
function Steps({ field, visit }: { field: TaneOfficialField; visit: TaneOfficialVisit | undefined }) {
  const steps = [
    { done: !!visit, text: "チェックインして水をやる（初めて来た畑は、たずねたタネ1か所と数えます）" },
    { done: !!visit && (visit.droppedSeeds ?? 0) === 0, text: `初めて来ると落ちる${field.item.name}のタネを拾う` },
    { done: !!visit?.harvestedAt, text: "朝・昼・夜にチェックインして水をやり、5回で実らせる。実らせると、そのまま実を1個もらえます" },
  ];
  return (
    <div className="bg-white rounded-2xl p-4 text-xs text-[#78716c] leading-relaxed">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-2">ほかの人の畑のたずね方</h2>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "text-emerald-700" : ""}>
            {s.done ? "✓" : `${i + 1}.`} {s.text}
          </li>
        ))}
      </ol>
      <p className="mt-2">
        ほかの人の畑も同じ流れです。ちがうのは、現地（その地区）に行ってチェックインすることと、実とタネをほかの人と早い者勝ちで分け合うことです。
      </p>
    </div>
  );
}
