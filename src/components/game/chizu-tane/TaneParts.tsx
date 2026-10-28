"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TANE_BASE_TYPE_BY_ID,
  nextLevelNeeds,
  seedsForLevel,
  type TaneCourse,
  type TaneItem,
} from "@/lib/game/chizuTane/courses";
import { formatRemaining, msUntilSprout } from "@/lib/game/chizuTane/geo";
import { GROWTH_STAGES, RIPE_STAGE, growthStage, type GrowingBase } from "@/lib/game/chizuTane/growth";
import { sproutMs } from "@/lib/game/chizuTaneData";

// 地図タネの画面で共通に使う小さな部品

/** 実(収穫したもの)の絵。絵ができるまでは絵文字を出す。タネは SeedIcon */
export function ItemIcon({ item, size = 40, silhouette = false }: { item: TaneItem; size?: number; silhouette?: boolean }) {
  const style = silhouette ? { filter: "grayscale(1) brightness(0)", opacity: 0.18 } : undefined;
  if (item.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.imageUrl} alt={silhouette ? "" : item.name} width={size} height={size} style={style} />;
  }
  return (
    <span role="img" aria-label={silhouette ? undefined : item.name} style={{ fontSize: size * 0.8, lineHeight: 1, ...style }}>
      {item.emoji}
    </span>
  );
}

/**
 * タネの絵。実(もの)と見分けがつくよう、タネ袋の形にして、何のタネかを小さく出す(実の絵はそのまま ItemIcon)
 */
export function SeedIcon({ item, size = 40 }: { item: TaneItem; size?: number }) {
  return (
    <span
      role="img"
      aria-label={`${item.name}のタネ`}
      className="relative inline-flex flex-col items-center justify-start rounded-b-md rounded-t-sm border border-amber-300 bg-amber-100 shrink-0"
      style={{ width: size * 0.78, height: size, paddingTop: size * 0.1 }}
    >
      <span className="absolute inset-x-0 top-0 h-[12%] rounded-t-sm bg-amber-300/70" aria-hidden />
      <span style={{ fontSize: size * 0.42, lineHeight: 1, marginTop: size * 0.06 }} aria-hidden>
        {item.emoji}
      </span>
      <span className="font-bold text-amber-800" style={{ fontSize: Math.max(8, size * 0.2), lineHeight: 1.3 }} aria-hidden>
        タネ
      </span>
    </span>
  );
}

export function TaneScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      {/* 下のタブに隠れないよう、下を空けておく */}
      <div className="max-w-lg mx-auto px-4 pt-6 pb-28">{children}</div>
      <TaneTabs />
    </main>
  );
}

const TANE_TABS = [
  { href: "/game/chizu-tane", label: "ホーム", emoji: "🏠" },
  { href: "/game/chizu-tane/here", label: "おでかけ", emoji: "🚶" },
  { href: "/game/chizu-tane/map", label: "タネ地図", emoji: "🗾" },
  { href: "/game/chizu-tane/collection", label: "集めたもの", emoji: "🧺" },
  { href: "/game/chizu-tane/garden", label: "タネニワ", emoji: "🏡" },
];

// 画面を離れる前に確かめたいとき(タネニワの保存していない変更)に、確かめの文を返す関数を置く。
// beforeunload はアプリの中の移動(タブ)では起きないので、タブを押したときにここを見る
let leaveGuard: (() => string | null) | null = null;

export function setTaneLeaveGuard(guard: (() => string | null) | null): void {
  leaveGuard = guard;
}

/** 地図タネの画面を切り替える、下に固定のタブ(地図の Leaflet より前に出す) */
function TaneTabs() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-[1100] bg-white/95 backdrop-blur border-t border-[#f3ece0] pb-[env(safe-area-inset-bottom)]">
      <ul className="max-w-lg mx-auto grid grid-cols-5">
        {TANE_TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                onClick={(e) => {
                  const message = active ? null : leaveGuard?.();
                  if (message && !window.confirm(message)) e.preventDefault();
                }}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${
                  active ? "text-emerald-700 font-bold" : "text-[#a8937a]"
                }`}
              >
                <span className={`text-xl leading-none ${active ? "" : "opacity-70"}`}>{t.emoji}</span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Loading() {
  return <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>;
}

export function ErrorText({ message }: { message: string }) {
  return <p className="text-sm text-red-600 my-3">{message}</p>;
}

/** ログインしていない・まだ始めていないときの案内(トップ以外の画面用) */
export function NeedStart({ signedOut }: { signedOut: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 text-center">
      <p className="text-sm text-[#78716c] mb-3">
        {signedOut ? "地図タネで遊ぶにはログインが必要です。" : "まずはトップでコースを選んでください。"}
      </p>
      <Link href={signedOut ? "/login" : "/game/chizu-tane"} className="text-sm font-semibold text-emerald-700 underline underline-offset-2">
        {signedOut ? "ログインする →" : "地図タネのトップへ →"}
      </Link>
    </div>
  );
}

/** 次のレベルの案内: 足りないもの(ほかの人のタネをたずねる数・まだまいていないタネ)と、上がるともらえるタネ */
export function NextLevelHint({
  course,
  visitedCount,
  plantedItemIds,
}: {
  course: TaneCourse;
  visitedCount: number;
  plantedItemIds: ReadonlySet<string>;
}) {
  const next = nextLevelNeeds(course, visitedCount, plantedItemIds);
  if (!next) return <p className="text-xs text-[#a8937a]">いまの試作で上がれる一番上のレベルです</p>;
  const seeds = seedsForLevel(course, next.nextLevel);
  const type = seeds[0] ? TANE_BASE_TYPE_BY_ID.get(seeds[0].baseTypeId) : undefined;
  const current = seedsForLevel(course, next.nextLevel - 1);
  return (
    <div className="text-xs text-[#78716c] leading-relaxed text-left">
      <p className="font-bold text-[#3c2a14] mb-1">
        Lv.{next.nextLevel} になると
        {type && (
          <>
            {" "}
            {type.emoji}
            {type.name}のタネ（{seeds.map((i) => i.name).join("・")}）がもらえます
          </>
        )}
      </p>
      <p>
        {next.visitsRemaining > 0 ? "□" : "☑"} ほかの人のタネに、あと{next.visitsRemaining}か所チェックインする
        <span className="text-[#a8937a]">（自分のタネは数えません）</span>
      </p>
      <p>
        {next.unplanted.length > 0 ? "□" : "☑"} いまのタネを3つともまく（{current.length - next.unplanted.length}/{current.length}
        {next.unplanted.length > 0 && `・あと${next.unplanted.map((i) => i.name).join("・")}`}）
      </p>
    </div>
  );
}

/** タネが0個のときの、増やし方の案内 */
export function NoSeedsHelp({ onMap = false }: { onMap?: boolean }) {
  return (
    <div className="text-sm text-[#78716c] leading-relaxed">
      <p className="mb-1">いまはまけるタネを持っていません。タネはこうすると増えます。</p>
      <ul className="list-disc pl-5 text-xs space-y-0.5">
        <li>ほかの人のタネにチェックインする（1つのタネで1日1回、1個）</li>
        <li>自分のタネが実ったら収穫する（タネが1個もらえる）</li>
        <li>タネに落ちているタネを拾う</li>
        <li>レベルを上げる（ほかの人のタネにチェックインし、いまのタネを3つともまくと、新しいタネが3つもらえる）</li>
      </ul>
      {onMap && <p className="text-xs mt-1">地図の<span className="font-bold text-amber-600">橙色</span>の地区が、ほかの人のタネです。</p>}
    </div>
  );
}

/** まいたタネの育ち具合:「🌸 花 ●●●●○ · ランク2」。芽が出る前は残り時間 */
export function GrowthBadge({ base, now = new Date() }: { base: GrowingBase & { rank: number }; now?: Date }) {
  const stage = growthStage(base, now, sproutMs());
  if (stage < 0) {
    return (
      <span className="text-[11px] text-emerald-700">
        🌰 {formatRemaining(msUntilSprout(base.plantedAt, now, sproutMs()))}で芽が出ます
      </span>
    );
  }
  const s = GROWTH_STAGES[stage];
  return (
    <span className={`text-xs ${stage === RIPE_STAGE ? "font-bold text-amber-600" : "text-emerald-700"}`}>
      {s.emoji} {s.label}
      <span className="ml-1 tracking-tighter text-[10px]" aria-hidden>
        {GROWTH_STAGES.map((_, i) => (i <= stage ? "●" : "○")).join("")}
      </span>
      <span className="ml-1 text-[#a8937a] font-normal">· ランク{base.rank}</span>
    </span>
  );
}
