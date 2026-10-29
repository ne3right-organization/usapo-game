"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFollowList, type FollowUser } from "@/lib/game/followData";
import { fetchGardenOf } from "@/lib/game/chizuTaneData";
import type { GardenObject } from "@/lib/game/chizuTane/garden";
import GardenSvg from "./GardenSvg";
import { ErrorText, Loading, NeedStart, TaneHeading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// フォローしている人のガーデンを見る(見るだけ)。ガーデンには飾っているものだけで、畑の場所は入っていない
export default function FriendGardenView({ userId }: { userId: string }) {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <FriendGarden userId={userId} />}
    </TaneScreen>
  );
}

function FriendGarden({ userId }: { userId: string }) {
  const [garden, setGarden] = useState<{ nickname: string | null; width: number; height: number; objects: GardenObject[] } | null | undefined>(
    undefined
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchGardenOf(userId)
      .then((g) => !cancelled && setGarden(g))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (error) return <ErrorText message={error} />;
  if (garden === undefined) return <Loading />;

  return (
    <div>
      <TaneHeading title={`🏡 ${garden?.nickname ?? "ニックネーム未設定"}さんのガーデン`} />
      {garden ? (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-2 mb-3">
          <GardenSvg width={garden.width} height={garden.height} objects={garden.objects} />
        </div>
      ) : (
        <p className="text-sm text-[#78716c] bg-white rounded-2xl p-4 mb-3">まだガーデンがありません。</p>
      )}
      <Link href="/game/chizu-tane/garden" className="text-sm text-emerald-700 underline underline-offset-2">
        ← 自分のガーデンへ
      </Link>
    </div>
  );
}

/** フォローしている人のガーデンへのリンクの一覧(自分のガーデンの画面の下に出す) */
export function FollowingGardens() {
  const [users, setUsers] = useState<FollowUser[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFollowList("following")
      .then((list) => !cancelled && setUsers(list.filter((u) => u.nickname)))
      .catch(() => !cancelled && setUsers([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-6">
      <h2 className="text-xs font-bold text-[#a8937a] mb-2">フォロー中の人のガーデン</h2>
      {users === null && <Loading />}
      {users?.length === 0 && (
        <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3">
          フォローしている人がいません。プロフィールやランキングから、ほかの人をフォローできます。
        </p>
      )}
      {users && users.length > 0 && (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li key={u.userId}>
              <Link
                href={`/game/chizu-tane/garden/${u.userId}`}
                className="flex items-center justify-between bg-white rounded-xl shadow-[0_2px_8px_rgba(120,90,40,0.06)] px-4 py-3 text-sm text-[#3c2a14]"
              >
                <span className="truncate">🏡 {u.nickname}さんのガーデン</span>
                <span className="text-[#c8b8a0]">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
