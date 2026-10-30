"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isFollowing } from "@/lib/game/followData";
import { fetchTaneSharerIds } from "@/lib/game/chizuTaneData";

// プロフィールの画面に出す、うさぽ農園へのリンク。ほかの人なら、その人のガーデンを見られるか(その人が自分に「農園を見せる」にしていて、
// 自分がその人をフォローしているか)を先に確かめて、見られなければその理由を出す。自分のガーデンへ戻るリンクも出す
export default function TaneProfileLinks({ userId, isSelf, nickname }: { userId: string; isSelf: boolean; nickname: string | null }) {
  const [access, setAccess] = useState<{ shared: boolean; following: boolean } | null>(null);

  useEffect(() => {
    if (isSelf) return;
    let cancelled = false;
    Promise.all([fetchTaneSharerIds(), isFollowing(userId)])
      .then(([sharers, following]) => !cancelled && setAccess({ shared: sharers.has(userId), following }))
      .catch(() => !cancelled && setAccess({ shared: false, following: false }));
    return () => {
      cancelled = true;
    };
  }, [userId, isSelf]);

  const name = nickname ?? "この人";
  const backLink = (
    <Link href="/game/chizu-tane/garden" className="text-xs text-emerald-700 underline underline-offset-2">
      🏡 自分のガーデンへ
    </Link>
  );

  if (isSelf) {
    return <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4">{backLink}</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col gap-2">
      <p className="text-xs font-bold text-[#a8937a]">🌱 うさぽ農園</p>
      {access === null ? (
        <p className="text-xs text-[#a8937a]">読み込み中...</p>
      ) : access.shared && access.following ? (
        <Link
          href={`/game/chizu-tane/garden/${userId}`}
          className="block rounded-xl bg-emerald-600 text-white text-sm font-semibold text-center py-2 active:scale-[0.98] transition-transform"
        >
          {name}さんのガーデンを見る
        </Link>
      ) : (
        <p className="text-xs text-[#78716c] leading-relaxed">
          {name}さんのガーデンは見られません。
          {!access.following
            ? `${name}さんをフォローして、${name}さんにあなたへ「農園を見せる」にしてもらうと見られます。`
            : `${name}さんが、フォロワーの一覧であなたに「農園を見せる」にすると見られます。`}
        </p>
      )}
      {backLink}
    </div>
  );
}
