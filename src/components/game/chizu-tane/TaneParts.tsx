"use client";

import Link from "next/link";
import {
  TANE_BASE_TYPE_BY_ID,
  nextLevelNeeds,
  seedsForLevel,
  type TaneCourse,
  type TaneItem,
} from "@/lib/game/chizuTane/courses";

// 地図タネの画面で共通に使う小さな部品

/** もらえるものの絵。絵ができるまでは絵文字を出す */
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

export function TaneScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">{children}</div>
    </main>
  );
}

export function TaneBackLink() {
  return (
    <Link href="/game/chizu-tane" className="inline-block text-sm text-[#78716c] mb-4">
      ← 地図タネのトップ
    </Link>
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
        <li>どこかのタネにチェックインする（自分のタネでも、1つのタネで1日1回、1個）</li>
        <li>タネに落ちているタネを拾う</li>
        <li>レベルを上げる（ほかの人のタネにチェックインし、いまのタネを3つともまくと、新しいタネが3つもらえる）</li>
      </ul>
      {onMap && <p className="text-xs mt-1">地図の<span className="font-bold text-amber-600">橙色</span>の地区が、ほかの人のタネです。</p>}
    </div>
  );
}
