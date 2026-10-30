"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, isPushEnabled, pushAvailability, type PushAvailability } from "@/lib/push/client";

// 設定画面の「通知」。このブラウザ(端末)で PWA の通知を受け取るかを切り替える
export default function PushSettings() {
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const a = pushAvailability();
    void Promise.resolve().then(() => !cancelled && setAvailability(a));
    if (a === "ok") isPushEnabled().then((on) => !cancelled && setEnabled(on));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (enabled) await disablePush();
      else await enablePush();
      setEnabled(await isPushEnabled());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6 mt-4">
      <h2 className="text-lg font-bold text-[#3c2a14] mb-2">🔔 通知</h2>
      <p className="text-xs text-[#78716c] leading-relaxed mb-3">次のようなときに、この端末に通知が届きます。</p>
      <ul className="text-xs text-[#78716c] leading-relaxed list-disc pl-5 mb-4 space-y-0.5">
        <li>うさぽ農園: 自分のタネが実った・自分のタネに誰かが来た</li>
        <li>フォローされた</li>
        <li>フォローしている人が地図パズル・地図ポットンをクリアした</li>
      </ul>

      {availability === "needs-install" && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
          iPhone・iPad では、このサイトをホーム画面に追加して、そこから開くと通知を受け取れます（iOS 16.4 以降。トップページの「ホーム画面に追加できます」を見てください）。
        </p>
      )}
      {availability === "unsupported" && <p className="text-xs text-[#a8937a]">このブラウザは通知に対応していません。</p>}
      {availability === "dev" && <p className="text-xs text-[#a8937a]">開発中の画面（npm run dev）では通知を使えません。dev 環境（devgame.usapo.net）で試してください。</p>}

      {availability === "ok" && (
        <>
          <button
            type="button"
            onClick={toggle}
            disabled={busy || enabled === null}
            className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
              enabled ? "bg-white text-[#78716c] border border-gray-300 hover:bg-gray-50" : "bg-teal-700 text-white hover:bg-teal-800"
            }`}
          >
            {busy ? "設定中..." : enabled ? "通知を止める" : "この端末で通知を受け取る"}
          </button>
          {enabled && <p className="text-xs text-teal-700 mt-2 text-center">この端末で通知を受け取っています</p>}
          <p className="text-[11px] text-[#a8937a] mt-2 leading-relaxed">端末ごとの設定です。ほかの端末でも受け取るには、その端末でも設定してください。</p>
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
