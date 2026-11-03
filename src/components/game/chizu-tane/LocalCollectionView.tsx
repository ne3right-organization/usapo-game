"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TANE_COURSES } from "@/lib/game/chizuTane/courses";
import { TANE_LOCAL_ITEMS, TANE_LOCAL_PREFS, TANE_LOCAL_RANK_LABELS } from "@/lib/game/chizuTane/localItems";
import { fetchMyLocalItemIds } from "@/lib/game/chizuTaneData";
import { ErrorText, ItemIcon, Loading, NeedStart, TaneHeading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// ご当地コレクション: 都道府県を選ぶと、その県のご当地のもの 15種類(5コース × 現地・お土産・記念品)を表で出す。
// 集めたものの画面の「ご当地」から開く。持っていないものは影絵で、名前は出す(どんなものがあるかを見て、提案してもらえるように)。
// ?pref=13 で最初に開く都道府県を選べる。?mode=secret(秘密モード。どこからもリンクしない)を付けると、ログインしていなくても、
// 持っているかに関係なく全部の絵を出す(絵の見直しや紹介に使う。例: ?pref=13&mode=secret)

/** ご当地のものへの提案の送り先(本体のお問い合わせ) */
const SUGGESTION_URL = "https://usapo.net/info/bug-report";

/** URL の ?pref= (2桁の都道府県コード。1桁でもよい)。ご当地のものがある都道府県でなければ "" */
function prefFromQuery(value: string | null): string {
  const code = (value ?? "").padStart(2, "0");
  return TANE_LOCAL_PREFS.some((p) => p.prefCode === code) ? code : "";
}

export default function LocalCollectionView() {
  const params = useSearchParams();
  const initialPref = prefFromQuery(params.get("pref"));
  const secret = params.get("mode") === "secret";
  return secret ? <SecretCollectionView initialPref={initialPref} /> : <PlayerCollectionView initialPref={initialPref} />;
}

/** 秘密モード: ログインしなくても、全部の絵を出す */
function SecretCollectionView({ initialPref }: { initialPref: string }) {
  return (
    <TaneScreen>
      <div className="mt-2">
        <TaneHeading title="📖 ご当地コレクション">🔑 秘密モード（全部の絵を出しています）</TaneHeading>
      </div>
      <LocalCollection initialPref={initialPref} reveal />
    </TaneScreen>
  );
}

function PlayerCollectionView({ initialPref }: { initialPref: string }) {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      <Link href="/game/chizu-tane/collection" className="text-xs text-emerald-700">
        ← 集めたもの
      </Link>
      <div className="mt-2">
        <TaneHeading title="📖 ご当地コレクション">都道府県を選ぶと、その県のご当地のもの15種類が見られます</TaneHeading>
      </div>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <LocalCollection initialPref={initialPref} />}
    </TaneScreen>
  );
}

/** reveal なら持っているかを読まず、全部持っているように出す(秘密モード) */
function LocalCollection({ initialPref, reveal = false }: { initialPref: string; reveal?: boolean }) {
  const [owned, setOwned] = useState<Set<string> | null>(() => (reveal ? new Set(TANE_LOCAL_ITEMS.map((i) => i.itemId)) : null));
  const [prefCode, setPrefCode] = useState(initialPref || (reveal ? TANE_LOCAL_PREFS[0].prefCode : ""));
  const [error, setError] = useState("");

  useEffect(() => {
    if (reveal) return;
    let cancelled = false;
    fetchMyLocalItemIds()
      .then((ids) => {
        if (cancelled) return;
        setOwned(new Set(ids));
        // URL で選んでいなければ、持っているものがある最初の都道府県を開く
        setPrefCode((cur) => cur || (TANE_LOCAL_ITEMS.find((i) => ids.includes(i.itemId))?.local ?? ""));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [reveal]);

  if (error) return <ErrorText message={error} />;
  if (!owned) return <Loading />;

  const countOf = (code: string) => TANE_LOCAL_ITEMS.filter((i) => i.local === code && owned.has(i.itemId)).length;
  const items = TANE_LOCAL_ITEMS.filter((i) => i.local === prefCode);
  const count = countOf(prefCode);

  return (
    <div>
      {!reveal && (
        <p className="text-sm text-[#78716c] mb-3">
          全国で {TANE_LOCAL_ITEMS.length}種類のうち <span className="font-bold text-[#3c2a14]">{owned.size}</span> 種類を集めました
        </p>
      )}
      <select
        value={prefCode}
        onChange={(e) => setPrefCode(e.target.value)}
        className="w-full rounded-xl border border-[#e7dccb] bg-white px-3 py-2 text-sm text-[#3c2a14] mb-4"
      >
        <option value="">都道府県を選んでください</option>
        {TANE_LOCAL_PREFS.map((p) => (
          <option key={p.prefCode} value={p.prefCode}>
            {p.prefName}（{countOf(p.prefCode)} / {TANE_LOCAL_ITEMS.filter((i) => i.local === p.prefCode).length}）
          </option>
        ))}
      </select>

      {prefCode && (
        <div className="bg-white rounded-2xl p-3 shadow-[0_2px_8px_rgba(120,90,40,0.06)] mb-5">
          <p className="text-sm text-[#3c2a14] mb-2">
            <span className="font-semibold">{TANE_LOCAL_PREFS.find((p) => p.prefCode === prefCode)?.prefName}</span>{" "}
            <span className="text-[#a8937a]">
              {count} / {items.length}
            </span>
            {items.length > 0 && count >= items.length && <span className="ml-1 font-bold">🎉</span>}
          </p>
          <table className="w-full text-2xs text-[#78716c] table-fixed">
            <thead>
              <tr className="text-[#a8937a]">
                <th className="w-[4.5rem]" />
                {TANE_LOCAL_RANK_LABELS.map((label) => (
                  <th key={label} className="font-normal pb-1">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TANE_COURSES.map((course) => (
                <tr key={course.id} className="border-t border-[#f3ece0]">
                  <td className="py-2 pr-1 text-left leading-tight">
                    <span className="mr-0.5">{course.emoji}</span>
                    {course.label}
                  </td>
                  {[1, 2, 3].map((rank) => {
                    const item = items.find((i) => i.course === course.id && i.rank === rank);
                    if (!item) return <td key={rank} />;
                    const mine = owned.has(item.itemId);
                    return (
                      <td key={rank} className="py-2 px-0.5 text-center align-top">
                        <div className="flex flex-col items-center gap-0.5">
                          <ItemIcon item={item} size={40} silhouette={!mine} />
                          <span className={`leading-tight ${mine ? "text-[#3c2a14]" : "text-[#c8b8a0]"}`}>{item.name}</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-3xs text-[#a8937a] mt-2 leading-snug">
            現地のものはその県におでかけしたとき（Lv.3 から）、お土産・記念品はご当地の畑を育てると手に入ります。ほかの人のご当地の畑やおすそ分けの棚でも集まります
          </p>
        </div>
      )}

      <p className="text-xs text-[#78716c] text-center leading-relaxed">
        ご当地のものへのご提案は
        <a href={SUGGESTION_URL} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline underline-offset-2">
          こちら
        </a>
        へ
      </p>
    </div>
  );
}
