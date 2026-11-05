"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFollowInviteUrl, fetchFollowList, type FollowUser } from "@/lib/game/followData";
import { currentUser } from "@/lib/auth";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";
import {
  fetchGardenOf,
  fetchHelpFields,
  fetchTaneShareViewerIds,
  fetchTaneSharerIds,
  gardenObjectsOf,
  helpWater,
  helpWaterAll,
  taneDayMs,
  type FriendGarden as FriendGardenData,
  type TaneHelpField,
} from "@/lib/game/chizuTaneData";
import { GARDEN_DESIGNS, houseTierFor, type GardenDesignId } from "@/lib/game/chizuTane/garden";
import { HELPS_PER_VISIT, TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { RIPE_STAGE, growthStage } from "@/lib/game/chizuTane/growth";
import { slotLabel } from "@/lib/game/chizuTane/geo";
import { HIDDEN_LOCAL_BASE, isHiddenLocalBase } from "@/lib/game/chizuTane/localItems";
import GardenSvg from "./GardenSvg";
import GardenZoom from "./GardenZoom";
import { FriendShelf } from "./ShelfParts";
import SwipePages from "./SwipePages";
import { CardBody, useCardLayout } from "./TaneCards";
import { ErrorText, GrowthBadge, GrowthStageIcon, Loading, NeedStart, TaneHeading, TaneScreen, UserIcon, WaterHint } from "./TaneParts";
import { useTanePlayer } from "./useTanePlayer";

// フォローしている人のガーデンを見る(見るだけ)。持ち主が自分に「農園を見せる」にしているときだけ見られる(確かめるのは Lambda)
export default function FriendGardenView({ userId }: { userId: string }) {
  const [state] = useTanePlayer();
  return (
    <TaneScreen>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorText message={state.message} />}
      {(state.status === "signed-out" || state.status === "not-started") && <NeedStart signedOut={state.status === "signed-out"} />}
      {state.status === "ready" && <FriendGarden userId={userId} helpCount={state.player.helpCount ?? 0} />}
    </TaneScreen>
  );
}

function FriendGarden({ userId, helpCount }: { userId: string; helpCount: number }) {
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
    // 見られないとき(農園を見せてもらっていない・フォローしていない)は、見られる条件を出す
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-[#3c2a14]">{error}</p>
        <p className="text-xs text-[#78716c] leading-relaxed">
          ほかの人のガーデンは、その人があなたに「農園を見せる」にしていて、あなたがその人をフォローしているときだけ見られます。
        </p>
        <Link href={`/profile/${userId}`} className="text-xs text-emerald-700 underline underline-offset-2">
          この人のプロフィールへ
        </Link>
        {back}
      </div>
    );
  }
  if (garden === undefined) return <Loading />;
  // 持ち主が使えるガーデン(開拓した地区の数で増える)
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
        <GardenZoom>
          <GardenSvg
            width={garden.width}
            height={garden.height}
            design={designId}
            houseTier={houseTierFor(garden.level).id}
            objects={gardenObjectsOf(garden, designId)}
          />
        </GardenZoom>
      </div>
      <FriendShelf ownerId={userId} nickname={garden.nickname ?? "ニックネーム未設定"} />
      <HelpFields ownerId={userId} nickname={garden.nickname ?? "ニックネーム未設定"} initialHelpCount={helpCount} />
      {back}
    </div>
  );
}

/**
 * その人の畑に遠くから水をやる(手伝い)。1つの畑に朝・昼・夜に1回、効き目は現地の10分の1。
 * 手伝いの水やり HELPS_PER_VISIT 回で、たずねたタネ1か所と数える。
 * 畑はほかのカードと同じ形で並べ(TaneCards)、タップするとその下に詳しいこと(場所・育ち・あと何回)と水やりのボタンを出す。
 * 見出しの横の「まとめて水をやる」で、水をやれる畑にまとめて水をやる(Lambda が1回で。持ち主への知らせは1つ)
 */
function HelpFields({ ownerId, nickname, initialHelpCount }: { ownerId: string; nickname: string; initialHelpCount: number }) {
  const [fields, setFields] = useState<TaneHelpField[] | null>(null);
  const [helpCount, setHelpCount] = useState(initialHelpCount);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const cards = useCardLayout();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchHelpFields(ownerId)
      .then((f) => !cancelled && setFields(f))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const handle = async (f: TaneHelpField) => {
    setBusy(f.fieldId);
    setError("");
    setMessage("");
    try {
      const res = await helpWater(ownerId, f.fieldId);
      setFields((cur) => cur?.map((x) => (x.fieldId === f.fieldId ? res.field : x)) ?? null);
      setHelpCount(res.helpCount);
      const lines = [
        res.ripened
          ? `💧 水をやって、実りました！ ${nickname}さんに生産者の取り分が届きました。${res.thanked ? "手伝ったお礼に、あなたにも実が1個届きました🎁" : "実は現地でもらえます"}`
          : "💧 水をやりました",
      ];
      if (res.helpCount % HELPS_PER_VISIT === 0) lines.push(`手伝いが${res.helpCount}回になり、たずねたタネ1か所ぶんになりました`);
      if (res.leveledUp) {
        const names = res.seedsGained.map((g) => TANE_ITEM_BY_ID.get(g.itemId)?.name ?? g.itemId).join("・");
        lines.push(`🎉 Lv.${res.level} になりました！ ${names}のタネをもらいました`);
      }
      setMessage(lines.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // 水をやれる畑(実っていない・タネ待ちでない・この時間帯にまだ水をやっていない)
  const targets = fields?.filter((f) => (f.fruits ?? 0) === 0 && !f.waitingSince && !f.wateredThisSlot) ?? [];

  const handleAll = async () => {
    setBusy("all");
    setError("");
    setMessage("");
    try {
      // 1回で全部の畑に水をやる(持ち主への知らせが1つにまとまるよう、Lambda でまとめてやる)
      const res = await helpWaterAll(ownerId);
      const byId = new Map(res.fields.map((x) => [x.fieldId, x]));
      setFields((cur) => cur?.map((x) => byId.get(x.fieldId) ?? x) ?? null);
      setHelpCount(res.helpCount);
      const lines = [`💧 ${res.watered}か所に水をやりました`];
      if (res.ripened > 0) lines.push(`${res.ripened}か所が実りました！ ${nickname}さんに生産者の取り分が届きました`);
      if (res.thanked > 0) lines.push(`手伝ったお礼に、あなたにも実が${res.thanked}個届きました🎁`);
      // この水やりで HELPS_PER_VISIT 回の区切りをまたいだら知らせる
      const visitsGained = Math.floor(res.helpCount / HELPS_PER_VISIT) - Math.floor(helpCount / HELPS_PER_VISIT);
      if (visitsGained > 0) lines.push(`手伝いが${res.helpCount}回になり、たずねたタネ${visitsGained}か所ぶん増えました`);
      if (res.leveledUp) {
        const names = res.seedsGained.map((g) => TANE_ITEM_BY_ID.get(g.itemId)?.name ?? g.itemId).join("・");
        lines.push(`🎉 Lv.${res.level} になりました！ ${names}のタネをもらいました`);
      }
      setMessage(lines.join("\n"));
      if (res.errors.length > 0) setError(`水をやれなかった畑: ${res.errors.join(" / ")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const slot = slotLabel(new Date(), taneDayMs());
  return (
    <section className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="flex-1 text-xs font-bold text-[#a8937a]">💧 {nickname}さんの畑に水をやる</h2>
        {fields && fields.length > 0 && (
          <button
            type="button"
            onClick={handleAll}
            disabled={busy !== null || targets.length === 0}
            className="shrink-0 rounded-lg px-2.5 py-1 text-2xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 disabled:opacity-50"
          >
            {busy === "all" ? "水やり中..." : targets.length > 0 ? `💧 まとめて水をやる（${targets.length}か所）` : "💧 まとめて水をやる"}
          </button>
        )}
      </div>
      <p className="text-2xs text-[#a8937a] mb-2 leading-relaxed">
        遠くから水をやって手伝えます（1つの畑に朝・昼・夜それぞれ1回、効き目は現地の10分の1）。手伝った畑が実ると、お礼に実が1個届きます（ご当地の畑は手伝うだけです）。手伝い{HELPS_PER_VISIT}回で、たずねたタネ1か所と数えます（いま{helpCount}回）。
      </p>
      {error && <ErrorText message={error} />}
      {message && <p className="text-xs text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2 mb-2 whitespace-pre-line">{message}</p>}
      {fields === null && !error && <Loading />}
      {fields?.length === 0 && <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3">いまは畑がありません</p>}
      {fields && fields.length > 0 && (
        <>
          <SwipePages
            items={fields}
            perPage={cards.perPage}
            columns={cards.columns}
            layout="grid"
            keyOf={(f) => f.fieldId}
            render={(f) => {
              const ripe = (f.fruits ?? 0) > 0;
              // ご当地の畑は、実るまで何の畑か出さない(ほかの画面と同じ)
              const hidden = isHiddenLocalBase(f, false) && growthStage(f) < RIPE_STAGE;
              const type = hidden ? HIDDEN_LOCAL_BASE : TANE_BASE_TYPE_BY_ID.get(f.baseTypeId);
              const status = f.waitingSince
                ? { text: "タネ待ち", className: "text-[#a16207]" }
                : ripe
                  ? { text: "実っている", className: "text-amber-600 font-bold" }
                  : f.wateredThisSlot
                    ? { text: `${slot ? `${slot}の` : ""}水やりは済み`, className: "text-[#a8937a]" }
                    : { text: "💧 水をやれる", className: "text-sky-700 font-bold" };
              const active = openId === f.fieldId;
              return (
                <button
                  type="button"
                  onClick={() => setOpenId(active ? null : f.fieldId)}
                  aria-expanded={active}
                  className={`relative w-full h-full bg-white rounded-2xl p-2 text-center border-2 shadow-[0_2px_8px_rgba(120,90,40,0.06)] ${
                    active ? "border-emerald-500" : "border-transparent"
                  }`}
                >
                  <CardBody
                    icon={
                      hidden || f.waitingSince ? (
                        <span className="text-3xl">{type?.emoji}</span>
                      ) : (
                        <GrowthStageIcon stage={growthStage(f)} seedItemId={f.seedItemId} size={30} />
                      )
                    }
                    title={f.townName}
                    note={<span className={`block text-3xs mt-0.5 ${status.className}`}>{status.text}</span>}
                  >
                    <span className="block text-3xs text-[#78716c] leading-tight line-clamp-2">{type?.name ?? "タネ"}</span>
                  </CardBody>
                </button>
              );
            }}
          />
          {(() => {
            const f = fields.find((x) => x.fieldId === openId);
            if (!f) return <p className="text-3xs text-[#a8937a] mt-1">畑をタップすると、くわしいことと水やりのボタンが出ます</p>;
            const ripe = (f.fruits ?? 0) > 0;
            const hidden = isHiddenLocalBase(f, false) && growthStage(f) < RIPE_STAGE;
            const type = hidden ? HIDDEN_LOCAL_BASE : TANE_BASE_TYPE_BY_ID.get(f.baseTypeId);
            const canWater = !ripe && !f.waitingSince;
            return (
              <div className="bg-white rounded-2xl px-4 py-3 mt-2 border-2 border-emerald-500">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#3c2a14]">
                      {type?.emoji} {f.townName}の{type?.name ?? "タネ"}
                    </p>
                    <p className="text-xs text-[#a8937a]">
                      {f.prefName}
                      {f.cityName}
                    </p>
                  </div>
                  <button type="button" onClick={() => setOpenId(null)} className="shrink-0 text-xs text-[#a8937a] underline underline-offset-2">
                    とじる
                  </button>
                </div>
                <div className="mt-1">
                  <GrowthBadge base={f} hidden={isHiddenLocalBase(f, false)} />
                </div>
                <div className="mt-1">
                  <WaterHint base={f} remote={false} />
                </div>
                {canWater && (
                  <button
                    type="button"
                    onClick={() => handle(f)}
                    disabled={busy !== null || f.wateredThisSlot}
                    className="w-full mt-2 rounded-xl py-2 text-sm font-semibold text-sky-700 bg-sky-50 border border-sky-200 disabled:opacity-50"
                  >
                    {f.wateredThisSlot ? `${slot ? `${slot}の` : ""}水やりは済み` : busy === f.fieldId ? "水をやっています..." : "💧 遠くから水をやる"}
                  </button>
                )}
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}

/**
 * フォローしていて、自分に農園を見せてくれている人のガーデンへのリンクの一覧(自分のガーデンの画面の下に出す)。
 * grid はホームの公式の畑の下に出すとき(見出しと並べ方をあなたの畑にそろえる。ふつうは 3×3 でスワイプ)
 */
export function FollowingGardens({ grid = false }: { grid?: boolean }) {
  const [users, setUsers] = useState<FollowUser[] | null>(null);
  const cards = useCardLayout();

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
    <section className={grid ? "mt-8" : "mt-6"}>
      <h2 className={grid ? "text-sm font-bold text-[#3c2a14] mb-2" : "text-xs font-bold text-[#a8937a] mb-2"}>
        見に行けるガーデン
        {grid && users && users.length > 0 && <span className="ml-1 text-xs font-normal text-[#a8937a]">（{users.length}人）</span>}
      </h2>
      {users === null && <Loading />}
      {users?.length === 0 && (
        <p className="text-xs text-[#78716c] bg-white rounded-2xl p-3">
          まだありません。フォローしている人が、フォロワーの一覧であなたに「農園を見せる」にすると、その人のガーデンを見に行けます。
        </p>
      )}
      {users && users.length > 0 && (
        // フォロワーと同じカードで並べる(TaneCards)
        <SwipePages
          items={users}
          perPage={grid ? cards.perPage : cards.columns}
          columns={grid ? cards.columns : undefined}
          layout={grid ? "grid" : "cols"}
          keyOf={(u) => u.userId}
          render={(u) => (
            <Link
              href={`/game/chizu-tane/garden/${u.userId}`}
              className="relative block h-full bg-white rounded-xl shadow-[0_2px_8px_rgba(120,90,40,0.06)] px-2 py-3 text-center"
            >
              <CardBody
                icon={<UserIcon iconItemId={u.iconItemId} size={30} />}
                title={<span className="block truncate">{u.nickname}</span>}
                note={<span className="block text-3xs mt-0.5 text-emerald-700">🏡 ガーデンを見る ›</span>}
              />
            </Link>
          )}
        />
      )}
    </section>
  );
}

/** ガーデンの画面の、フォローしてもらうリンクのところ(ホームの「見に行けるガーデン」の下から、ここに飛ぶ) */
export const FOLLOW_LINK_ANCHOR = "follow-link";

/**
 * 自分のフォロワー(3人ずつ横スワイプ)と、友達にフォローしてもらうためのリンク(/follow/{token}。開いた人は自分をフォローし、
 * 同時に自分の農園を見られるようになる)。自分のガーデンの画面のいちばん下に出す。
 * ほかのフォロワーに農園を見せるかどうかはフォロワーの一覧(/profile/follows)で選ぶ
 */
export function MyFollowers() {
  const cards = useCardLayout();
  const [view, setView] = useState<{ userId: string; nickname: string | null; followers: FollowUser[]; shared: Set<string> } | null>(null);
  const [copied, setCopied] = useState(false);
  // フォローしてもらうリンク。navigator.share はタップの直後でないと使えない端末があるので、先に作っておく
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([currentUser(), fetchGameProfile(), fetchFollowList("followers"), fetchTaneShareViewerIds()])
      .then(([user, profile, followers, shared]) => {
        if (!cancelled && user) setView({ userId: user.id, nickname: profile?.nickname ?? null, followers, shared });
        if (!profile?.nickname) return;
        // 作れなかったときに「準備しています」のまま止まらないよう、エラーを出す
        fetchFollowInviteUrl()
          .then((url) => !cancelled && setInviteUrl(url))
          .catch((err) => !cancelled && setInviteError(err instanceof Error ? err.message : String(err)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 読み込んでから出すので、ブラウザの #follow-link への移動では届かない。出したあとで、そこまで送る
  // (ガーデンの画面の上のほうも後から読み込まれて高さが変わるので、少し待つ)
  useEffect(() => {
    if (!view || window.location.hash !== `#${FOLLOW_LINK_ANCHOR}`) return;
    const timer = setTimeout(() => document.getElementById(FOLLOW_LINK_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(timer);
  }, [view]);

  if (!view) return null;

  const shareLink = async () => {
    const url = inviteUrl;
    if (!url) return;
    const text = `うさぽゲームコーナーで${view.nickname}をフォローして、うさぽ農園を見に来てね`;
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

  const renewLink = async () => {
    if (!window.confirm("リンクを作り直しますか？ いままで送ったリンクは使えなくなります（すでにフォローしている人はそのままです）")) return;
    setInviteError(null);
    try {
      setInviteUrl(await fetchFollowInviteUrl(true));
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="mt-6">
      <h2 className="text-xs font-bold text-[#a8937a] mb-2">フォロワー（{view.followers.length}人）</h2>
      {view.followers.length > 0 && (
        <SwipePages
          items={view.followers}
          perPage={cards.columns}
          layout="cols"
          keyOf={(u) => u.userId}
          render={(u) => (
            <Link
              href={`/profile/${u.userId}`}
              className="relative block h-full bg-white rounded-xl shadow-[0_2px_8px_rgba(120,90,40,0.06)] px-2 py-3 text-center"
            >
              <CardBody
                icon={<UserIcon iconItemId={u.iconItemId} size={30} />}
                title={<span className="block truncate">{u.nickname ?? "未設定"}</span>}
                note={
                  <span className={`block text-3xs mt-0.5 ${view.shared.has(u.userId) ? "text-emerald-700" : "text-[#a8937a]"}`}>
                    {view.shared.has(u.userId) ? "🌱 農園を見せている" : "🔒 見せていない"}
                  </span>
                }
              />
            </Link>
          )}
        />
      )}
      {view.followers.length > 0 && (
        <Link href="/profile/follows" className="block text-right text-2xs text-emerald-700 underline underline-offset-2 mt-1">
          農園を見せる人を選ぶ →
        </Link>
      )}
      <div className="text-2xs text-[#a8937a] leading-relaxed mt-2 space-y-1">
        <p>🌱 「農園を見せる」にしたフォロワーにだけ、次のことが分かるようになります。はじめは誰にも見せていません。</p>
        <ul className="list-disc pl-5">
          <li>あなたのガーデン</li>
          <li>あなたのおすそ分けの棚（遠くから1日1個もらえます）</li>
          <li>あなたがタネをまいた畑の場所・種類・育ち具合（その人は、あなたのガーデンの画面から畑に遠くから水をやって手伝えます。その人が集めた実の「生産者」にも、あなたの名前が出ます）</li>
          <li>あなたがその人の畑に来たこと（その人に届く通知に、あなたの名前が出ます。見せていない人には「誰か」と出ます）</li>
        </ul>
        <p>
          畑の場所や来た時間から、ふだん過ごしている場所が分かってしまうため、こうしています。フォローはパズルのランキングなどからも誰でもできるので、フォローされただけでは見せません。実際に会ったことのある友達など、知られてもよい人だけを「見せる」にしてください。
        </p>
      </div>
      <div id={FOLLOW_LINK_ANCHOR} className="bg-white rounded-2xl p-3 mt-2 text-xs text-[#78716c] scroll-mt-4">
        {view.nickname ? (
          <>
            <p className="mb-2">
              友達にこのリンクを送ると、開いた友達があなたをフォローし、<span className="font-semibold">同時にあなたの農園を見せる相手になります</span>
              （フォローするには、友達もニックネームの設定が要ります）。リンクは誰が開いても同じなので、知られてもよい友達にだけ送ってください。
            </p>
            <button
              type="button"
              onClick={shareLink}
              disabled={!inviteUrl}
              className="w-full rounded-xl bg-emerald-600 text-white font-semibold text-sm py-2 active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {copied ? "リンクをコピーしました" : inviteUrl ? "🔗 フォローしてもらうリンクを送る" : inviteError ? "リンクを作れませんでした" : "リンクを準備しています..."}
            </button>
            {inviteError && <ErrorText message={inviteError} />}
            <button type="button" onClick={renewLink} className="block ml-auto mt-2 text-2xs text-[#a8937a] underline underline-offset-2">
              リンクを作り直す（前のリンクを使えなくする）
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
