"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFollowList, type FollowUser } from "@/lib/game/followData";
import { currentUser } from "@/lib/auth";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";
import { fetchGardenOf, fetchTaneShareViewerIds, fetchTaneSharerIds, gardenObjectsOf, type FriendGarden as FriendGardenData } from "@/lib/game/chizuTaneData";
import { GARDEN_DESIGNS, houseTierFor, type GardenDesignId } from "@/lib/game/chizuTane/garden";
import GardenSvg from "./GardenSvg";
import SwipePages from "./SwipePages";
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

/**
 * 自分のフォロワー(3人ずつ横スワイプ)と、友達にフォローしてもらうためのリンク(自分のプロフィールの URL。そこでフォローできる)。
 * 自分のガーデンの画面のいちばん下に出す。農園を見せるかどうかはフォロワーの一覧(/profile/follows)で選ぶ
 */
export function MyFollowers() {
  const [view, setView] = useState<{ userId: string; nickname: string | null; followers: FollowUser[]; shared: Set<string> } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([currentUser(), fetchGameProfile(), fetchFollowList("followers"), fetchTaneShareViewerIds()])
      .then(([user, profile, followers, shared]) => {
        if (!cancelled && user) setView({ userId: user.id, nickname: profile?.nickname ?? null, followers, shared });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!view) return null;

  const shareLink = async () => {
    const url = `${window.location.origin}/profile/${view.userId}`;
    const text = `うさぽゲームコーナーで${view.nickname}をフォローしてね`;
    if (navigator.share) {
      // 共有をやめたときも例外になるので、何もしない
      await navigator.share({ title: "うさぽゲームコーナー", text, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("このリンクを友達に送ってください", url);
    }
  };

  return (
    <section className="mt-6">
      <h2 className="text-xs font-bold text-[#a8937a] mb-2">フォロワー（{view.followers.length}人）</h2>
      {view.followers.length > 0 && (
        <SwipePages
          items={view.followers}
          perPage={3}
          layout="cols"
          keyOf={(u) => u.userId}
          render={(u) => (
            <Link href={`/profile/${u.userId}`} className="block bg-white rounded-xl shadow-[0_2px_8px_rgba(120,90,40,0.06)] px-2 py-3 text-center">
              <span className="block text-2xl mb-1">👤</span>
              <span className="block text-xs font-semibold text-[#3c2a14] truncate">{u.nickname ?? "未設定"}</span>
              <span className={`block text-[10px] mt-0.5 ${view.shared.has(u.userId) ? "text-emerald-700" : "text-[#a8937a]"}`}>
                {view.shared.has(u.userId) ? "🌱 農園を見せている" : "🔒 見せていない"}
              </span>
            </Link>
          )}
        />
      )}
      {view.followers.length > 0 && (
        <Link href="/profile/follows" className="block text-right text-[11px] text-emerald-700 underline underline-offset-2 mt-1">
          農園を見せる人を選ぶ →
        </Link>
      )}
      <div className="bg-white rounded-2xl p-3 mt-2 text-xs text-[#78716c]">
        {view.nickname ? (
          <>
            <p className="mb-2">友達にこのリンクを送ると、あなたをフォローしてもらえます（フォローするには、友達もニックネームの設定が要ります）。</p>
            <button
              type="button"
              onClick={shareLink}
              className="w-full rounded-xl bg-emerald-600 text-white font-semibold text-sm py-2 active:scale-[0.98] transition-transform"
            >
              {copied ? "リンクをコピーしました" : "🔗 フォローしてもらうリンクを送る"}
            </button>
          </>
        ) : (
          <p>
            友達にフォローしてもらうには、先に
            <Link href="/nickname" className="text-emerald-700 underline underline-offset-2 mx-0.5">
              ニックネームを設定
            </Link>
            してください。
          </p>
        )}
      </div>
    </section>
  );
}
