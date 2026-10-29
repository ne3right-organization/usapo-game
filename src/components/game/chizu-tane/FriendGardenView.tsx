"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFollowList, type FollowUser } from "@/lib/game/followData";
import { fetchGardenOf, fetchTaneSharerIds, gardenObjectsOf, type FriendGarden as FriendGardenData } from "@/lib/game/chizuTaneData";
import { GARDEN_DESIGNS, houseTierFor, type GardenDesignId } from "@/lib/game/chizuTane/garden";
import GardenSvg from "./GardenSvg";
import { ErrorText, Loading, NeedStart, TaneHeading, TaneScreen } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// フォローしている人のガーデンを見る(見るだけ)。持ち主が自分に「農園を見せる」にしているときだけ見られる(確かめるのは Lambda)
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
  const [garden, setGarden] = useState<FriendGardenData | undefined>(undefined);
  const [designId, setDesignId] = useState<GardenDesignId>("home");
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

  const back = (
    <Link href="/game/chizu-tane/garden" className="text-sm text-emerald-700 underline underline-offset-2">
      ← 自分のガーデンへ
    </Link>
  );
  if (error) {
    return (
      <div>
        <ErrorText message={error} />
        {back}
      </div>
    );
  }
  if (garden === undefined) return <Loading />;
  // 持ち主が使えるガーデン(まいたタネの数で増える)
  const opened = GARDEN_DESIGNS.filter((d) => garden.plantedCount >= d.unlockPlanted);

  return (
    <div>
      <TaneHeading title={`🏡 ${garden.nickname ?? "ニックネーム未設定"}さんのガーデン`}>
        家と柵: {houseTierFor(garden.level).name}（Lv.{garden.level}）
      </TaneHeading>
      {opened.length > 1 && (
        <div className="flex gap-1.5 mb-2 overflow-x-auto">
          {opened.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDesignId(d.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border ${
                d.id === designId ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-[#78716c] border-[#e7dccb]"
              }`}
            >
              {d.emoji} {d.name}
            </button>
          ))}
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-2 mb-3">
        <GardenSvg
          width={garden.width}
          height={garden.height}
          design={designId}
          houseTier={houseTierFor(garden.level).id}
          objects={gardenObjectsOf(garden, designId)}
        />
      </div>
      {back}
    </div>
  );
}

/** フォローしていて、自分に農園を見せてくれている人のガーデンへのリンクの一覧(自分のガーデンの画面の下に出す) */
export function FollowingGardens() {
  const [users, setUsers] = useState<FollowUser[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchFollowList("following"), fetchTaneSharerIds()])
      .then(([list, sharers]) => !cancelled && setUsers(list.filter((u) => u.nickname && sharers.has(u.userId))))
      .catch(() => !cancelled && setUsers([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-6">
      <h2 className="text-xs font-bold text-[#a8937a] mb-2">見せてもらえるガーデン</h2>
      {users === null && <Loading />}
      {users?.length === 0 && (
        <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3">
          まだありません。フォローしている人が、フォロワーの一覧であなたに「農園を見せる」にすると、その人のガーデンを見に行けます。
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
