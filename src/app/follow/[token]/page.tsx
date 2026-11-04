"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { acceptFollowInvite } from "@/lib/game/followData";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";

type Props = { params: Promise<{ token: string }> };

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "no-nickname" }
  | { status: "error"; message: string }
  | { status: "done"; userId: string; nickname: string };

// フォローしてもらうリンク(うさぽ農園のガーデンの画面で作る)。開くと、リンクの持ち主をフォローし、
// 同時に持ち主の農園(ガーデン・畑・おすそ分けの棚)を見せてもらえる。未ログインならログインしてから、ここに戻ってくる(ReturnPathTracker)
export default function FollowInvitePage({ params }: Props) {
  const { token } = use(params);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await currentUser())) {
        if (!cancelled) setState({ status: "signed-out" });
        return;
      }
      try {
        // フォローするにはニックネームが要るので、先に確かめて設定画面へ案内する
        if (!(await fetchGameProfile())?.nickname) {
          if (!cancelled) setState({ status: "no-nickname" });
          return;
        }
        // 2回開いても(開発時の二重実行も)、Lambda 側で足りないものだけ足すので同じ結果になる
        const owner = await acceptFollowInvite(token);
        if (!cancelled) setState({ status: "done", ...owner });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <h1 className="text-lg font-bold text-[#3c2a14] mb-5">フォローのおさそい</h1>
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 text-sm text-[#78716c] leading-relaxed">
          {state.status === "loading" && <p className="text-center text-[#a8937a]">読み込み中...</p>}
          {state.status === "signed-out" && (
            <>
              <p className="mb-4">友達からフォローのおさそいが届いています。フォローするには、ログインしてください。</p>
              <Link href="/login" className="block w-full text-center rounded-xl bg-emerald-600 text-white font-semibold py-2">
                ログインする
              </Link>
            </>
          )}
          {state.status === "no-nickname" && (
            <>
              <p className="mb-4">フォローするには、先にニックネームの設定が要ります。設定したら、もう一度このリンクを開いてください。</p>
              <Link href="/nickname" className="block w-full text-center rounded-xl bg-emerald-600 text-white font-semibold py-2">
                ニックネームを設定する
              </Link>
            </>
          )}
          {state.status === "error" && <p className="text-red-600">{state.message}</p>}
          {state.status === "done" && (
            <>
              <p className="mb-1">
                <span className="font-bold text-[#3c2a14]">{state.nickname}</span>さんをフォローしました。
              </p>
              <p className="mb-4">{state.nickname}さんのうさぽ農園（ガーデン・畑・おすそ分けの棚）を見られるようになりました。</p>
              <Link
                href={`/game/chizu-tane/garden/${state.userId}`}
                className="block w-full text-center rounded-xl bg-emerald-600 text-white font-semibold py-2 mb-2"
              >
                🏡 ガーデンを見に行く
              </Link>
              <Link href={`/profile/${state.userId}`} className="block text-center text-xs text-emerald-700 underline underline-offset-2">
                プロフィールを見る
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
