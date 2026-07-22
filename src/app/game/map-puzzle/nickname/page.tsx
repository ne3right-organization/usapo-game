"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchGameProfile, updateNickname } from "@/lib/game/mapPuzzleData";

export default function NicknamePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchGameProfile()
      .then((profile) => {
        if (!cancelled) setNickname(profile?.nickname ?? "");
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = nickname.trim();
  const isDelete = trimmed === "";

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setErrorMsg("");
    try {
      await updateNickname(trimmed);
      router.push("/game/map-puzzle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-full flex items-center justify-center bg-[#fdf8f0]">
        <p className="text-sm text-[#a8937a]">読み込み中...</p>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-[#fdf8f0] px-4 pt-10">
      <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6">
        <h1 className="text-lg font-bold text-[#3c2a14] mb-4">ニックネーム設定</h1>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 mb-4 leading-relaxed">
          ⚠️
          ニックネームを登録すると、ランキングからあなたのプロフィール(合計スコア・ベストスコア一覧)が誰でも見られるようになります。
        </div>

        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 12))}
          maxLength={12}
          placeholder="12文字以内"
          className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-600 mb-1"
        />
        <p className="text-xs text-[#a8937a] mb-4">{nickname.length}/12文字</p>

        {errorMsg && <p className="text-xs text-red-600 mb-3">{errorMsg}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
            isDelete ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
          }`}
        >
          {saving ? "保存中..." : isDelete ? "削除する" : "保存する"}
        </button>
      </div>
    </main>
  );
}
