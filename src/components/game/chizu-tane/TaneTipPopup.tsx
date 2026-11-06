"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { fetchFollowCounts, fetchFollowList } from "@/lib/game/followData";
import {
  fetchEverReplanted,
  fetchEverStockedShelf,
  fetchMyBases,
  fetchMyHarvests,
  fetchMyIconItemId,
  fetchMyPlantedItemIds,
  fetchTanePlayer,
  fetchTaneShareViewerIds,
  fetchTaneSharerIds,
  fetchVisitedCount,
  isLocationOverrideAllowed,
  taneDayMs,
  type TaneBase,
} from "@/lib/game/chizuTaneData";
import { levelFor, levelVisitCount, nextLevelNeeds, type TaneCourse } from "@/lib/game/chizuTane/courses";
import { fieldNotice } from "@/lib/game/chizuTane/growth";
import { fetchGameProfile } from "@/lib/game/mapPuzzleData";
import { slotKey } from "@/lib/game/chizuTane/geo";
import { isPushEnabled, pushAvailability } from "@/lib/push/client";
import { TANE_LOCAL_ITEM_BY_ID, isLocalBaseTypeId } from "@/lib/game/chizuTane/localItems";
import { TANE_TIP_INTERVAL_MS, pickTaneTip, taneTips, type TaneTip, type TaneTipStatus } from "@/lib/game/chizuTane/tips";

// 始めたばかりの人に、ホームを開いたときに出すヒントのポップアップ。ヒントの中身と条件は src/lib/game/chizuTane/tips.ts。
// 済んでいなくて今出せるヒントのうち、いちばん早い段階のものから1つをランダムに出し、閉じたら TANE_TIP_INTERVAL_MS(dev は水やりの区切りと同じ短さ)の間は出さない。
// 閉じた日時は端末の localStorage に持つ。全部済んだら出さない

const CLOSED_AT_KEY = "chizuTaneTipClosedAt";

/** 収穫の記録のうち、自分で現地に行って自分の畑の実を取ったもの。実ったときに届く「生産者の取り分」は、実った日時と収穫の日時がほぼ同じなので除く */
const SELF_HARVEST_GAP_MS = 60_000;

function intervalMs(): number {
  return isLocationOverrideAllowed() ? taneDayMs() : TANE_TIP_INTERVAL_MS;
}

function closedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(CLOSED_AT_KEY) ?? 0);
    return Date.now() - at < intervalMs();
  } catch {
    return false;
  }
}

function rememberClosed(): void {
  try {
    window.localStorage.setItem(CLOSED_AT_KEY, String(Date.now()));
  } catch {
    // localStorage が使えない環境では、次に開いたときもまた出るだけ
  }
}

/** この端末の通知の状態(ホーム画面に追加したアプリか・オンにできるか。InstallHint と同じ見分け方) */
async function pushState(): Promise<TaneTipStatus["push"]> {
  const availability = pushAvailability();
  if (availability === "needs-install") return "needs-install";
  if (availability !== "ok") return "unsupported";
  return (await isPushEnabled().catch(() => false)) ? "enabled" : "can-enable";
}

async function loadStatus(): Promise<TaneTipStatus | null> {
  const me = await currentUser();
  if (!me) return null;
  const [bases, planted, visits, counts, following, sharers, harvests, player, iconItemId, viewers, everStocked, push, profile, everReplanted] = await Promise.all([
    fetchMyBases(),
    fetchMyPlantedItemIds(),
    fetchVisitedCount(),
    fetchFollowCounts(),
    fetchFollowList("following"),
    fetchTaneSharerIds(),
    fetchMyHarvests(),
    fetchTanePlayer(),
    fetchMyIconItemId(),
    fetchTaneShareViewerIds(),
    fetchEverStockedShelf(),
    pushState(),
    fetchGameProfile(),
    fetchEverReplanted(),
  ]);
  const now = new Date();
  const slot = slotKey(now, taneDayMs());
  const everHarvestedOwn = harvests.some(
    (h) => h.ownerId === me.id && !!h.ripenedAt && Date.parse(h.harvestedAt) - Date.parse(h.ripenedAt) > SELF_HARVEST_GAP_MS
  );
  const ownerWatered = (b: TaneBase) => !!b.lastRemoteWaterOn || !!b.lastOwnerVisitOn;
  const helpTarget = following.find((u) => sharers.has(u.userId));
  const visitCount = levelVisitCount(visits.visited + visits.official, visits.helps);
  const course = player?.course as TaneCourse | undefined;
  // たずねた数は足りていて、まいていないタネだけが足りない
  const needs = course ? nextLevelNeeds(course, visitCount, planted) : null;
  const unplantedForLevel = needs && needs.visitsRemaining === 0 ? needs.unplanted.map((i) => i.name) : [];
  const notices = bases.map((b) => fieldNotice(b, now, isLocalBaseTypeId(b.baseTypeId))?.kind);
  return {
    everPlanted: planted.size > 0,
    visited: visits.visited,
    official: visits.official,
    helps: visits.helps,
    everWatered: everHarvestedOwn || bases.some(ownerWatered),
    canWaterNow: bases.some((b) => (b.fruits ?? 0) === 0 && !b.waitingSince && b.lastRemoteWaterOn !== slot),
    everHarvestedOwn,
    hasRipeField: bases.some((b) => (b.fruits ?? 0) > 0),
    followers: counts.followers,
    following: counts.following,
    helpTargetUserId: helpTarget?.userId ?? null,
    // ホームのレベルと同じ計算(TaneHome)
    level: course ? levelFor(course, visitCount, planted) : 1,
    hasFruit: harvests.length > 0,
    hasIcon: !!iconItemId,
    everPlantedLocal: [...planted].some((itemId) => TANE_LOCAL_ITEM_BY_ID.has(itemId)),
    sharing: viewers.size,
    push,
    everStocked,
    hasNickname: !!profile?.nickname,
    everReplanted,
    hasWaitingField: bases.some((b) => !!b.waitingSince),
    canDeliver: notices.includes("deliverable") || notices.includes("rotSoon"),
    unplantedForLevel,
    witherSoon: notices.includes("witherSoon"),
  };
}

export default function TaneTipPopup() {
  const router = useRouter();
  const [shown, setShown] = useState<{ tip: TaneTip; doneCount: number; total: number } | null>(null);

  useEffect(() => {
    // 閉じたばかりなら、状況を読みにも行かない
    if (closedRecently()) return;
    let cancelled = false;
    loadStatus()
      .then((status) => {
        if (cancelled || !status) return;
        const tips = taneTips(status);
        const tip = pickTaneTip(tips, status);
        if (!tip) return;
        setShown({ tip, doneCount: tips.filter((t) => t.done(status)).length, total: tips.length });
      })
      // 出せなくても遊ぶのには困らないので、何も出さないだけ
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!shown) return null;
  const { tip, doneCount, total } = shown;

  const close = () => {
    rememberClosed();
    setShown(null);
  };
  const act = () => {
    close();
    if (tip.action?.href) router.push(tip.action.href);
    else if (tip.action?.anchor) document.getElementById(tip.action.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="fixed inset-0 z-[1200] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tane-tip-title"
        className="relative bg-[#fffaf0] w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-[0_8px_32px_rgba(60,42,20,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 上の飾り(畑の色の帯と、大きな絵) */}
        <div className="bg-gradient-to-b from-emerald-100 to-[#fffaf0] pt-6 pb-2 text-center">
          <p className="text-2xs font-semibold tracking-widest text-emerald-700">🌱 うさぽ農園のヒント</p>
          <div className="mx-auto mt-3 w-20 h-20 rounded-full bg-white shadow-[0_2px_12px_rgba(16,120,80,0.15)] flex items-center justify-center text-5xl">
            {tip.emoji}
          </div>
        </div>

        <div className="px-6 pb-6">
          <h2 id="tane-tip-title" className="text-lg font-bold text-[#3c2a14] text-center mt-2 mb-3">
            {tip.title}
          </h2>
          <div className="space-y-2 text-sm text-[#78716c] leading-relaxed">
            {tip.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>

          {/* できたことの数(全部できたら、もう出ない) */}
          <div className="mt-5">
            <div className="flex justify-between text-2xs text-[#a8937a] mb-1">
              <span>はじめの一歩</span>
              <span>
                {doneCount}/{total} できた
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i < doneCount ? "bg-emerald-500" : "bg-emerald-100"}`} />
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {tip.action && (
              <button
                type="button"
                onClick={act}
                className="w-full rounded-xl bg-emerald-600 text-white font-semibold text-sm py-2.5 active:scale-[0.98] transition-transform"
              >
                {tip.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className={
                tip.action
                  ? "w-full rounded-xl text-sm text-[#a8937a] py-2"
                  : "w-full rounded-xl bg-emerald-600 text-white font-semibold text-sm py-2.5 active:scale-[0.98] transition-transform"
              }
            >
              {tip.action ? "閉じる" : "わかった"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
