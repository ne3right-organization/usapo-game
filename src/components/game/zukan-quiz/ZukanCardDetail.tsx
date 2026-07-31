"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import MunicipalitySilhouette from "@/components/game/zukan-quiz/MunicipalitySilhouette";
import {
  fetchZukanCollectionEntry,
  fetchMunicipalityGeometry,
  fetchMunicipalityTrivia,
  fetchZukanCollectionComments,
  upsertZukanCollectionComment,
  deleteZukanCollectionComment,
  type ZukanCollectionEntry,
  type ZukanQuizTrivia,
  type ZukanCollectionComment,
  type GeoJsonGeometry,
} from "@/lib/game/zukanQuizClient";
import { ZUKAN_DIFFICULTY_META } from "@/lib/game/zukanQuizDifficulty";
import { TRIVIA_FIELD_LABELS } from "@/lib/game/zukanQuizTrivia";
import { formatRelativeTime } from "@/lib/game/format";

interface Props {
  prefCode: string;
  cityCode: string;
  // 省略時は自分のカードを表示する。指定時は他ユーザーのカード(公開プロフィール経由)
  targetUserId?: string;
  backHref: string;
}

type ViewState =
  | { status: "loading" }
  | { status: "needs-login" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      entry: ZukanCollectionEntry;
      geometry: GeoJsonGeometry | null;
      trivia: ZukanQuizTrivia | null;
      comments: ZukanCollectionComment[];
      isOwnCard: boolean;
      viewerId: string | null;
    };

export default function ZukanCardDetail({ prefCode, cityCode, targetUserId, backHref }: Props) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ status: "loading" });
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const resolvedTargetId = targetUserId ?? user?.id;
      if (!resolvedTargetId) {
        if (!cancelled) setState({ status: "needs-login" });
        return;
      }

      try {
        const entry = await fetchZukanCollectionEntry(resolvedTargetId, prefCode, cityCode);
        if (!entry) {
          if (!cancelled) setState({ status: "not-found" });
          return;
        }

        const [geometry, trivia, comments] = await Promise.all([
          fetchMunicipalityGeometry(prefCode, cityCode),
          fetchMunicipalityTrivia(prefCode, cityCode),
          fetchZukanCollectionComments(prefCode, cityCode),
        ]);

        if (!cancelled) {
          setState({
            status: "ready",
            entry,
            geometry,
            trivia,
            comments,
            isOwnCard: user?.id === resolvedTargetId,
            viewerId: user?.id ?? null,
          });
          const myComment = comments.find((c) => c.userId === user?.id);
          setCommentDraft(myComment?.body ?? "");
        }
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefCode, cityCode, targetUserId]);

  const handleSubmitComment = async () => {
    setCommentBusy(true);
    setCommentError("");
    try {
      await upsertZukanCollectionComment(prefCode, cityCode, commentDraft);
      const comments = await fetchZukanCollectionComments(prefCode, cityCode);
      setState((s) => (s.status === "ready" ? { ...s, comments } : s));
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "コメントの投稿に失敗しました");
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async () => {
    setCommentBusy(true);
    setCommentError("");
    try {
      await deleteZukanCollectionComment(prefCode, cityCode);
      setCommentDraft("");
      const comments = await fetchZukanCollectionComments(prefCode, cityCode);
      setState((s) => (s.status === "ready" ? { ...s, comments } : s));
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "コメントの削除に失敗しました");
    } finally {
      setCommentBusy(false);
    }
  };

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <Link href={backHref} className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">📖 カード詳細</h1>
        </div>

        {state.status === "loading" && <p className="text-sm text-[#a8937a] text-center py-10">読み込み中...</p>}

        {state.status === "needs-login" && (
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 text-center">
            <p className="text-sm text-[#3c2a14] mb-3">カードを見るにはログインが必要です</p>
            <Link href="/login" className="text-sm text-teal-700 underline underline-offset-2 font-semibold">
              ログインする →
            </Link>
          </div>
        )}

        {state.status === "not-found" && (
          <p className="text-sm text-[#a8937a] text-center py-10">このカードはまだ獲得されていません</p>
        )}

        {state.status === "error" && <p className="text-sm text-red-600 text-center py-6">{state.message}</p>}

        {state.status === "ready" && (
          <div className="flex flex-col gap-5">
            <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-5 flex flex-col items-center gap-3">
              <div className="w-full aspect-square max-w-[220px] flex items-center justify-center">
                {state.geometry ? (
                  <MunicipalitySilhouette geometry={state.geometry} className="w-full h-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full border-4 border-gray-200 border-t-orange-500 animate-spin" />
                )}
              </div>
              <div className="text-center">
                <div className="text-base font-bold text-[#3c2a14]">
                  {state.entry.prefName} {state.entry.cityName}
                </div>
                <span
                  className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${ZUKAN_DIFFICULTY_META[state.entry.bestDifficulty].badgeClass}`}
                >
                  最高難易度: {ZUKAN_DIFFICULTY_META[state.entry.bestDifficulty].label}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.06)] px-3.5 py-2.5">
                <div className="text-[11px] text-[#a8937a]">人口</div>
                <div className="text-sm font-bold text-[#3c2a14]">
                  {state.entry.population != null ? `${state.entry.population.toLocaleString()}人` : "データなし"}
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.06)] px-3.5 py-2.5">
                <div className="text-[11px] text-[#a8937a]">世帯数</div>
                <div className="text-sm font-bold text-[#3c2a14]">
                  {state.entry.households != null ? `${state.entry.households.toLocaleString()}世帯` : "データなし"}
                </div>
              </div>
            </div>

            <p className="text-xs text-[#a8937a] text-center">
              正解{state.entry.correctCount}回・初回獲得 {formatRelativeTime(state.entry.firstAcquiredAt)}・
              最終獲得 {formatRelativeTime(state.entry.lastAcquiredAt)}
            </p>

            {state.trivia && state.entry.hintFields.length > 0 && (
              <div>
                <p className="text-xs text-[#a8937a] mb-2 tracking-widest">出題時に見せたヒント</p>
                <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col gap-2">
                  {TRIVIA_FIELD_LABELS.filter(({ key }) => state.entry.hintFields.includes(key)).map(({ key, label }) => {
                    const value = state.trivia?.[key];
                    if (!value) return null;
                    return (
                      <div key={key}>
                        <span className="text-[11px] text-[#a8937a]">{label}</span>
                        <p className="text-sm text-[#3c2a14]">{value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-[#a8937a] mb-1 tracking-widest">ヒントの提案</p>
              <p className="text-xs text-[#a8937a] mb-2 leading-relaxed">
                出題時のヒントにしてほしいトリビアを提案できます(採用されるとは限りません)
              </p>
              <div className="flex flex-col gap-2">
                {state.comments.length === 0 && (
                  <p className="text-sm text-[#a8937a] text-center py-4">まだ提案はありません</p>
                )}
                {state.comments.map((c) => (
                  <div
                    key={c.userId}
                    className="bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.06)] px-3.5 py-2.5"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[#3c2a14]">{c.nickname ?? "名無し"}</span>
                      <span className="text-[11px] text-[#a8937a]">{formatRelativeTime(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[#3c2a14] whitespace-pre-wrap break-words">{c.body}</p>
                  </div>
                ))}
              </div>

              {state.isOwnCard && (
                <div className="mt-3 bg-white rounded-xl shadow-[0_2px_12px_rgba(120,90,40,0.06)] p-3.5 flex flex-col gap-2">
                  <textarea
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="例: ご当地グルメは○○が有名です"
                    className="w-full text-sm text-[#3c2a14] border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:border-orange-300"
                  />
                  {commentError && <p className="text-xs text-red-600">{commentError}</p>}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#a8937a]">{commentDraft.length} / 200</span>
                    <div className="flex gap-2">
                      {state.comments.some((c) => c.userId === state.viewerId) && (
                        <button
                          type="button"
                          disabled={commentBusy}
                          onClick={handleDeleteComment}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#78716c] border border-gray-300 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          削除
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={commentBusy || commentDraft.trim().length === 0}
                        onClick={handleSubmitComment}
                        className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50"
                      >
                        投稿する
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
