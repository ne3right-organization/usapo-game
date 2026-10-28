"use client";

import Link from "next/link";
import type { TaneItem } from "@/lib/game/chizuTane/courses";

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
