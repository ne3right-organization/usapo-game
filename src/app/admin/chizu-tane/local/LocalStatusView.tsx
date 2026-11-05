"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TANE_COURSE_BY_ID, type TaneCourse } from "@/lib/game/chizuTane/courses";
import { localMarketAt, witherAt } from "@/lib/game/chizuTane/growth";
import { TANE_LOCAL_ITEM_BY_ID, TANE_LOCAL_PREFS, TANE_LOCAL_RANK_LABELS } from "@/lib/game/chizuTane/localItems";
import { fetchAdminLocalStatus, type AdminLocalStatus, type AdminUser } from "@/lib/game/adminData";
import { ItemIcon } from "@/components/game/chizu-tane/TaneParts";

// 管理: ご当地の実の状況(/admin/chizu-tane/local)。データは admin グループだけが呼べる adminTaneLocalStatus(chizu-tane-admin)から読む

const prefName = (code: string) => TANE_LOCAL_PREFS.find((p) => p.prefCode === code)?.prefName ?? code;

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function UserName({ user }: { user: AdminUser }) {
  return (
    <span title={user.userId}>
      {user.nickname || <span className="text-[#a8937a]">（未設定）</span>}
      <span className="ml-1 text-4xs text-[#a8937a]">{user.userId.slice(0, 8)}</span>
    </span>
  );
}

function ItemName({ itemId }: { itemId: string }) {
  const item = TANE_LOCAL_ITEM_BY_ID.get(itemId);
  if (!item) return <span>{itemId}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <ItemIcon item={item} size={20} />
      {item.name}
      <span className="text-4xs text-[#a8937a]">
        {prefName(item.local)}・{TANE_LOCAL_RANK_LABELS[item.rank - 1]}
      </span>
    </span>
  );
}

const th = "text-left font-semibold text-[#a8937a] px-2 py-1 whitespace-nowrap";
const td = "px-2 py-1 align-top border-t border-[#f0e6d6]";

export default function LocalStatusView() {
  const [status, setStatus] = useState<AdminLocalStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAdminLocalStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 text-[#3c2a14]">
      <Link href="/admin" className="text-xs text-emerald-700">
        ← 管理のトップ
      </Link>
      <h1 className="text-xl font-bold mb-1 mt-2">うさぽ農園 ご当地の実の状況</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!status && !error && <p className="text-sm text-[#a8937a]">読み込んでいます...</p>}
      {status && <StatusTables status={status} />}
    </main>
  );
}

function StatusTables({ status }: { status: AdminLocalStatus }) {
  const { fields, market, grants, holders } = status;
  const now = new Date(status.generatedAt);
  const marketTotal = market.reduce((n, l) => n + l.leftover, 0);
  const sortedHolders = [...holders].sort((a, b) => a.itemId.localeCompare(b.itemId));

  return (
    <div className="space-y-8 text-xs">
      <p className="text-[#78716c]">
        {dateLabel(status.generatedAt)} 時点。ご当地の畑 {fields.length}か所・市場に並んでいる実 {marketTotal}個・タネをもらった記録 {grants.length}件・
        集められたご当地の実 {holders.length} / {TANE_LOCAL_ITEM_BY_ID.size}種類
      </p>

      <section>
        <h2 className="text-sm font-bold mb-1">🌾 ご当地の畑</h2>
        <p className="text-[#a8937a] mb-2">実って1か月で撤去して残りの実を市場に並べ、実る前に1か月水が入らないと枯れる（タネは持ち主に返す）</p>
        <div className="overflow-x-auto bg-white rounded-xl">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>実</th>
                <th className={th}>場所</th>
                <th className={th}>持ち主</th>
                <th className={th}>状態</th>
                <th className={th}>まいた</th>
                <th className={th}>実った</th>
                <th className={th}>次に起きること</th>
              </tr>
            </thead>
            <tbody>
              {fields.length === 0 && (
                <tr>
                  <td className={td} colSpan={7}>
                    ありません
                  </td>
                </tr>
              )}
              {fields.map((f) => {
                const base = { plantedAt: f.plantedAt, ripenedAt: f.ripenedAt, lastWateredAt: f.lastWateredAt, fruits: f.fruits, water: f.water };
                const toMarket = localMarketAt(base);
                const wither = witherAt(base);
                const next = toMarket ? `市場へ ${dateLabel(toMarket.toISOString())}` : wither ? `枯れる ${dateLabel(wither.toISOString())}` : "—";
                const late = (toMarket ?? wither)?.getTime() ?? Infinity;
                return (
                  <tr key={f.areaKey}>
                    <td className={td}>
                      <ItemName itemId={f.itemId} />
                    </td>
                    <td className={td}>{f.place}</td>
                    <td className={td}>
                      <UserName user={f.owner} />
                    </td>
                    <td className={td}>{f.fruits > 0 ? <span className="font-bold text-amber-600">実{f.fruits}個</span> : `水 ${f.water}`}</td>
                    <td className={td}>{dateLabel(f.plantedAt)}</td>
                    <td className={td}>{dateLabel(f.ripenedAt)}</td>
                    <td className={`${td} ${late <= now.getTime() ? "text-red-600" : ""}`}>{next}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold mb-1">🏪 市場に並んでいる実</h2>
        <p className="text-[#a8937a] mb-2">生産者ごと。0になったら（全部渡ったら）生産者に次のご当地のタネが届いている</p>
        <div className="overflow-x-auto bg-white rounded-xl">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>実</th>
                <th className={th}>生産者</th>
                <th className={th}>残り</th>
                <th className={th}>最後に動いた</th>
              </tr>
            </thead>
            <tbody>
              {market.length === 0 && (
                <tr>
                  <td className={td} colSpan={4}>
                    ありません
                  </td>
                </tr>
              )}
              {market.map((l) => (
                <tr key={`${l.producer.userId}#${l.itemId}`}>
                  <td className={td}>
                    <ItemName itemId={l.itemId} />
                  </td>
                  <td className={td}>
                    <UserName user={l.producer} />
                  </td>
                  <td className={`${td} ${l.leftover === 0 ? "text-[#a8937a]" : "font-bold"}`}>{l.leftover}個</td>
                  <td className={td}>{dateLabel(l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold mb-1">🌱 ご当地のタネをもらった記録</h2>
        <div className="overflow-x-auto bg-white rounded-xl">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>人</th>
                <th className={th}>都道府県</th>
                <th className={th}>コース</th>
                {TANE_LOCAL_RANK_LABELS.map((label, i) => (
                  <th key={label} className={th}>
                    {i + 1}個目（{label}）
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 && (
                <tr>
                  <td className={td} colSpan={6}>
                    ありません
                  </td>
                </tr>
              )}
              {grants.map((g) => (
                <tr key={`${g.user.userId}#${g.prefCode}`}>
                  <td className={td}>
                    <UserName user={g.user} />
                  </td>
                  <td className={td}>{prefName(g.prefCode)}</td>
                  <td className={td}>{TANE_COURSE_BY_ID.get(g.course as TaneCourse)?.label ?? g.course}</td>
                  <td className={td}>{dateLabel(g.firstAt)}</td>
                  <td className={td}>{dateLabel(g.secondAt)}</td>
                  <td className={td}>{dateLabel(g.thirdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold mb-1">🧺 ご当地の実を持っている人</h2>
        <p className="text-[#a8937a] mb-2">集めた人は、一度でも手に入れた人（いまの数が0の人も含む）</p>
        <div className="overflow-x-auto bg-white rounded-xl">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>実</th>
                <th className={th}>集めた人</th>
                <th className={th}>いまある数（全員の合計）</th>
              </tr>
            </thead>
            <tbody>
              {sortedHolders.length === 0 && (
                <tr>
                  <td className={td} colSpan={3}>
                    ありません
                  </td>
                </tr>
              )}
              {sortedHolders.map((h) => (
                <tr key={h.itemId}>
                  <td className={td}>
                    <ItemName itemId={h.itemId} />
                  </td>
                  <td className={td}>{h.collectors}人</td>
                  <td className={td}>{h.quantity}個</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
