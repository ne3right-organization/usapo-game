"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TANE_BASE_TYPE_BY_ID,
  TANE_ITEM_BY_ID,
  nextLevelNeeds,
  seedsForLevel,
  type TaneCourse,
  type TaneItem,
} from "@/lib/game/chizuTane/courses";
import { GROWTH_STAGES, RIPE_STAGE, growthStage, isWaitingReplant, waterUntilRipe, type GrowingBase } from "@/lib/game/chizuTane/growth";
import { GROWTH_IMAGE_URLS } from "@/lib/game/chizuTane/growthImages.generated";

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
 * まいたタネの育つ途中の絵(タネ〜花)。実りはその畑の実の絵を出すので、seedItemId があれば実の絵(ItemIcon)。
 * 絵が無い段階は絵文字
 */
export function GrowthStageIcon({ stage, seedItemId, size = 20 }: { stage: number; seedItemId?: string; size?: number }) {
  const s = GROWTH_STAGES[stage];
  const fruit = stage === RIPE_STAGE && seedItemId ? TANE_ITEM_BY_ID.get(seedItemId) : undefined;
  if (fruit) return <ItemIcon item={fruit} size={size} />;
  const url = GROWTH_IMAGE_URLS[String(stage)];
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={s.label} width={size} height={size} className="inline-block align-middle" />;
  }
  return (
    <span role="img" aria-label={s.label} style={{ fontSize: size * 0.8, lineHeight: 1 }}>
      {s.emoji}
    </span>
  );
}

/** タネ待ち(実が全部取られたあと)の印。絵(空き地)があれば絵、無ければ茶色の枠の白い丸 */
function WaitingIcon({ size }: { size: number }) {
  const url = GROWTH_IMAGE_URLS.waiting;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className="inline-block align-middle" aria-hidden />;
  }
  return <span className="inline-block w-3 h-3 rounded-full border-2 border-[#a16207] bg-white align-[-1px]" aria-hidden />;
}

/**
 * タネの絵。実(もの)と見分けがつくよう、タネ袋の形にして、何のタネかを小さく出す(絵があれば絵、無ければ絵文字。実の絵はそのまま ItemIcon)
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
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" width={size * 0.5} height={size * 0.5} style={{ marginTop: size * 0.02 }} aria-hidden />
      ) : (
        <span style={{ fontSize: size * 0.42, lineHeight: 1, marginTop: size * 0.06 }} aria-hidden>
          {item.emoji}
        </span>
      )}
      <span className="font-bold text-amber-800" style={{ fontSize: Math.max(8, size * 0.2), lineHeight: 1.3 }} aria-hidden>
        タネ
      </span>
    </span>
  );
}

/** 残り時間の言い方(「あと3日」「あと5時間」「あと20分」) */
export function remainingLabel(ms: number): string {
  if (ms <= 0) return "すぐに";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `あと${minutes}分で`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `あと${hours}時間で`;
  return `あと${Math.ceil(hours / 24)}日で`;
}

/** 地図のタネのアイコンの凡例(育ち具合で見せる。taneMarker.ts と同じ色) */
export function GrowthLegend() {
  return (
    <>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border-2 border-emerald-500 bg-white text-[9px] leading-none">🌱</span>
        育っている（
        {GROWTH_STAGES.slice(0, RIPE_STAGE).map((s, i) => (
          <GrowthStageIcon key={s.label} stage={i} size={14} />
        ))}
        ）
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border-2 border-amber-500 bg-amber-50 text-[9px] leading-none">✨</span>
        実っている（実をもらえる）
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border-2 border-[#a16207] bg-white overflow-hidden">
          {GROWTH_IMAGE_URLS.waiting && <WaitingIcon size={12} />}
        </span>
        タネ待ち
      </span>
    </>
  );
}

/** 画面の見出し。右に短い説明を並べる(説明が2行になっても、見出しと上下の中央をそろえる) */
export function TaneHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h1 className="shrink-0 text-xl font-bold text-[#3c2a14] leading-tight">{title}</h1>
      {children && <p className="text-xs text-[#a8937a] leading-snug">{children}</p>}
    </div>
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
  { href: "/game/chizu-tane/map", label: "全国農地", emoji: "🗾" },
  { href: "/game/chizu-tane/collection", label: "集めたもの", emoji: "🧺" },
  { href: "/game/chizu-tane/garden", label: "ガーデン", emoji: "🏡" },
];

// 画面を離れる前に確かめたいとき(ガーデンの保存していない変更)に、確かめの文を返す関数を置く。
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
          const active = pathname === t.href || (t.href !== "/game/chizu-tane" && pathname.startsWith(`${t.href}/`));
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
        {signedOut ? "うさぽ農園で遊ぶにはログインが必要です。" : "まずはトップでコースを選んでください。"}
      </p>
      <Link href={signedOut ? "/login" : "/game/chizu-tane"} className="text-sm font-semibold text-emerald-700 underline underline-offset-2">
        {signedOut ? "ログインする →" : "うさぽ農園のトップへ →"}
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
  if (!next) return <p className="text-xs text-[#a8937a]">いま上がれる一番上のレベルです</p>;
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
        <li>ほかの人のタネに落ちているタネを拾う（初めてチェックインすると、そこに1個落ちる）</li>
        <li>レベルを上げる（ほかの人のタネにチェックインし、いまのタネを3つともまくと、新しいタネが3つもらえる）</li>
      </ul>
      {onMap && <p className="text-xs mt-1">地図の<span className="font-bold text-amber-600">橙色の丸</span>のアイコンが、ほかの人のタネです。</p>}
    </div>
  );
}

/** まいたタネの育ち具合:「🌸 花 ●●●●●○ · ランク2」。実ったら残っている実の数 */
export function GrowthBadge({ base }: { base: GrowingBase & { rank: number; seedItemId?: string } }) {
  if (isWaitingReplant(base)) {
    return (
      <span className="text-xs text-[#a16207]">
        <WaitingIcon size={18} /> タネ待ち
        <span className="ml-1 text-[#a8937a] font-normal">· ランク{base.rank}</span>
      </span>
    );
  }
  const stage = growthStage(base);
  const s = GROWTH_STAGES[stage];
  return (
    <span className={`text-xs ${stage === RIPE_STAGE ? "font-bold text-amber-600" : "text-emerald-700"}`}>
      <GrowthStageIcon stage={stage} seedItemId={base.seedItemId} size={18} /> {s.label}
      <span className="ml-1 tracking-tighter text-[10px]" aria-hidden>
        {GROWTH_STAGES.map((_, i) => (i <= stage ? "●" : "○")).join("")}
      </span>
      {stage === RIPE_STAGE && <span className="ml-1">実{base.fruits ?? 0}個</span>}
      <span className="ml-1 text-[#a8937a] font-normal">· ランク{base.rank}</span>
    </span>
  );
}

/** 実るまで、あと何回水をやればよいか(実っていれば、もらい方) */
export function WaterHint({ base, remote = true }: { base: GrowingBase; remote?: boolean }) {
  // タネ待ち: 持ち主(remote)には ReplantPicker で案内するので出さない
  if (isWaitingReplant(base)) {
    return remote ? null : <p className="text-[11px] text-[#a16207]">実が全部収穫されて、持ち主がタネをまき直すのを待っています</p>;
  }
  const need = waterUntilRipe(base);
  if (!need) {
    return <p className="text-[11px] text-amber-700">現地でチェックインすると、実を1個もらえます（朝・昼・夜それぞれ1回、早い者勝ち）</p>;
  }
  return (
    <p className="text-[11px] text-[#78716c]">
      💧 あと現地で<span className="font-bold text-[#3c2a14]">{need.onsite}回</span>
      {remote && <>（遠くからなら{need.remote}回）</>}水をやると実ります
    </p>
  );
}
