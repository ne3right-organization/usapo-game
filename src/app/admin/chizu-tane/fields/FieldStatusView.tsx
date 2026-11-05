"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { TANE_BASE_TYPE_BY_ID, TANE_COURSE_BY_ID, TANE_ITEM_BY_ID, type TaneCourse } from "@/lib/game/chizuTane/courses";
import { GROWTH_STAGES, deliveryFrom, growthStage, localMarketAt, replantDeadline, rotAt, witherAt } from "@/lib/game/chizuTane/growth";
import { isLocalBaseTypeId } from "@/lib/game/chizuTane/localItems";
import { fetchAdminFieldStatus, type AdminFieldStatus } from "@/lib/game/adminData";

// 管理: 遊んでいる人と畑の状況(/admin/chizu-tane/fields)。ゲームが進んでいるかを見るための画面。
// データは admin グループだけが呼べる adminTaneFieldStatus(chizu-tane-admin)から読み、まとめ方と次に起きることの計算はここで行う

type Field = AdminFieldStatus["fields"][number];

const DAY = 864e5;

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 「3日前」「2日後」のような近さ */
function relative(t: number, now: number): string {
  const days = Math.round((t - now) / DAY);
  if (days === 0) return "今日";
  return days > 0 ? `${days}日後` : `${-days}日前`;
}

function stateOf(f: Field): { label: string; className: string } {
  if (f.waitingSince) return { label: "タネ待ち", className: "text-[#a16207]" };
  if (f.fruits > 0) return { label: `実${f.fruits}個`, className: "font-bold text-amber-600" };
  return { label: `${GROWTH_STAGES[growthStage(f)].label}（水${f.water}）`, className: "text-emerald-700" };
}

/** 畑に次に起きること(定期実行の chizu-tane-sweep と同じ決まり。growth.ts) */
function nextEvent(f: Field, now: number): { label: string; at: number } | null {
  const local = isLocalBaseTypeId(f.baseTypeId);
  const candidates: { label: string; at: Date | null }[] = f.waitingSince
    ? [{ label: "空き地に戻る", at: replantDeadline(f) }]
    : f.fruits > 0
      ? local
        ? [{ label: "市場に並ぶ", at: localMarketAt(f) }]
        : [
            { label: "宅急便OK", at: deliveryFrom(f) },
            { label: "腐る", at: rotAt(f) },
          ]
      : [{ label: "枯れる", at: witherAt(f) }];
  const upcoming = candidates.filter((c): c is { label: string; at: Date } => !!c.at).sort((a, b) => a.at.getTime() - b.at.getTime());
  // まだ来ていないもののうち一番近いもの。全部過ぎていれば最後のもの
  const next = upcoming.find((c) => c.at.getTime() > now) ?? upcoming[upcoming.length - 1];
  return next ? { label: next.label, at: next.at.getTime() } : null;
}

const th = "text-left font-semibold text-[#a8937a] px-2 py-1 whitespace-nowrap";
const td = "px-2 py-1 align-top border-t border-[#f0e6d6] whitespace-nowrap";

export default function FieldStatusView() {
  const [status, setStatus] = useState<AdminFieldStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAdminFieldStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 text-[#3c2a14]">
      <Link href="/admin" className="text-xs text-emerald-700">
        ← 管理のトップ
      </Link>
      <h1 className="text-xl font-bold mb-1 mt-2">うさぽ農園 遊んでいる人と畑</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!status && !error && <p className="text-sm text-[#a8937a]">読み込んでいます...</p>}
      {status && <StatusTables status={status} />}
    </main>
  );
}

function StatusTables({ status }: { status: AdminFieldStatus }) {
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const now = new Date(status.generatedAt).getTime();
  const fieldsOf = new Map<string, Field[]>();
  for (const f of status.fields) fieldsOf.set(f.ownerId, [...(fieldsOf.get(f.ownerId) ?? []), f]);

  const rows = status.players
    .map((p) => {
      const fields = fieldsOf.get(p.userId) ?? [];
      const events = fields.flatMap((f) => {
        const e = nextEvent(f, now);
        return e ? [e] : [];
      });
      const soonest = events.sort((a, b) => a.at - b.at)[0] ?? null;
      return {
        player: p,
        fields,
        growing: fields.filter((f) => !f.waitingSince && f.fruits === 0).length,
        ripe: fields.filter((f) => f.fruits > 0).length,
        waiting: fields.filter((f) => f.waitingSince).length,
        fruits: fields.reduce((n, f) => n + f.fruits, 0),
        soonest,
      };
    })
    .sort((a, b) => b.fields.length - a.fields.length || (b.player.lastMovedAt ?? "").localeCompare(a.player.lastMovedAt ?? ""));

  const total = status.fields.length;
  const ripe = status.fields.filter((f) => f.fruits > 0).length;
  const waiting = status.fields.filter((f) => f.waitingSince).length;
  const local = status.fields.filter((f) => isLocalBaseTypeId(f.baseTypeId)).length;
  const active = (days: number) => status.players.filter((p) => p.lastMovedAt && now - Date.parse(p.lastMovedAt) <= days * DAY).length;
  const noOwner = fieldsOf.get("")?.length ?? 0;

  return (
    <div className="space-y-6 text-xs">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="遊んでいる人" value={`${status.players.length}人`} note={`1日以内に動いた ${active(1)}人・7日以内 ${active(7)}人`} />
        <Stat label="畑" value={`${total}か所`} note={`育ち中 ${total - ripe - waiting}・実り ${ripe}・タネ待ち ${waiting}`} />
        <Stat label="ご当地の畑" value={`${local}か所`} />
        <Stat label="集計した日時" value={dateLabel(status.generatedAt)} note={noOwner > 0 ? `持ち主の分からない畑 ${noOwner}か所` : undefined} />
      </div>

      <section>
        <h2 className="text-sm font-bold mb-1">👥 遊んでいる人</h2>
        <p className="text-[#a8937a] mb-2">行を押すと、その人の畑の一覧が出ます。「最後に動いた」はおでかけで最後に位置を送った日時</p>
        <div className="overflow-x-auto bg-white rounded-xl">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>ニックネーム</th>
                <th className={th}>コース</th>
                <th className={th}>Lv</th>
                <th className={th}>畑（育ち/実り/待ち）</th>
                <th className={th}>実の残り</th>
                <th className={th}>開拓</th>
                <th className={th}>たずねた</th>
                <th className={th}>公式</th>
                <th className={th}>手伝い</th>
                <th className={th}>収穫</th>
                <th className={th}>最後に動いた</th>
                <th className={th}>いちばん近い期限</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = openUserId === r.player.userId;
                return (
                  <Fragment key={r.player.userId}>
                    <tr
                      onClick={() => setOpenUserId(open ? null : r.player.userId)}
                      className={`cursor-pointer hover:bg-[#fdf8ef] ${open ? "bg-[#fdf8ef]" : ""}`}
                    >
                      <td className={td}>
                        {open ? "▾ " : "▸ "}
                        {r.player.nickname || <span className="text-[#a8937a]">（未設定）</span>}
                      </td>
                      <td className={td}>{TANE_COURSE_BY_ID.get(r.player.course as TaneCourse)?.label ?? r.player.course}</td>
                      <td className={td}>{r.player.level}</td>
                      <td className={td}>
                        <span className="font-bold">{r.fields.length}</span>（{r.growing}/{r.ripe}/{r.waiting}）
                      </td>
                      <td className={td}>{r.fruits}</td>
                      <td className={td}>{r.player.opened}</td>
                      <td className={td}>{r.player.visits}</td>
                      <td className={td}>{r.player.official}</td>
                      <td className={td}>{r.player.helps}</td>
                      <td className={td}>{r.player.harvests}</td>
                      <td className={td}>
                        {r.player.lastMovedAt ? (
                          <>
                            {dateLabel(r.player.lastMovedAt)} <span className="text-[#a8937a]">{relative(Date.parse(r.player.lastMovedAt), now)}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${td} ${r.soonest && r.soonest.at - now < 3 * DAY ? "text-red-600" : ""}`}>
                        {r.soonest ? `${r.soonest.label} ${relative(r.soonest.at, now)}` : "—"}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={12} className="bg-[#fdf8ef] px-2 pb-3">
                          <PlayerFields fields={r.fields} now={now} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-white rounded-xl p-3">
      <p className="text-[#a8937a]">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {note && <p className="text-4xs text-[#a8937a]">{note}</p>}
    </div>
  );
}

function PlayerFields({ fields, now }: { fields: Field[]; now: number }) {
  if (fields.length === 0) return <p className="text-[#a8937a] py-2">いまある畑はありません</p>;
  const sorted = [...fields].sort((a, b) => b.plantedAt.localeCompare(a.plantedAt));
  return (
    <table className="w-full mt-1">
      <thead>
        <tr>
          <th className={th}>場所</th>
          <th className={th}>タネ</th>
          <th className={th}>ランク</th>
          <th className={th}>状態</th>
          <th className={th}>まいた</th>
          <th className={th}>実った</th>
          <th className={th}>最後の水</th>
          <th className={th}>次に起きること</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((f) => {
          const type = TANE_BASE_TYPE_BY_ID.get(f.baseTypeId);
          const state = stateOf(f);
          const next = nextEvent(f, now);
          return (
            <tr key={f.areaKey}>
              <td className={td}>{f.place}</td>
              <td className={td}>
                {type?.emoji} {TANE_ITEM_BY_ID.get(f.seedItemId)?.name ?? f.seedItemId}
                {isLocalBaseTypeId(f.baseTypeId) && <span className="ml-1 text-4xs text-amber-700">ご当地</span>}
              </td>
              <td className={td}>★{f.rank}</td>
              <td className={`${td} ${state.className}`}>{state.label}</td>
              <td className={td}>{dateLabel(f.plantedAt)}</td>
              <td className={td}>{dateLabel(f.ripenedAt)}</td>
              <td className={td}>{f.lastWateredAt ? dateLabel(f.lastWateredAt) : <span className="text-[#a8937a]">記録なし</span>}</td>
              <td className={`${td} ${next && next.at - now < 3 * DAY ? "text-red-600" : ""}`}>
                {next ? `${next.label} ${dateLabel(new Date(next.at).toISOString())}（${relative(next.at, now)}）` : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
