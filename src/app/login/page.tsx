"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// Supabase側のエラーメッセージ(英語)をそのまま出さず、日本語で分かりやすく案内する
function describeAuthError(error: AuthError): string {
  const code = "code" in error ? error.code : undefined;
  if (code === "over_email_send_rate_limit" || error.status === 429) {
    return "メール送信の上限に達しました。1時間ほど時間をおいてから、もう一度お試しください。";
  }
  if (code === "email_address_invalid") {
    return "そのメールアドレスは利用できません。別のメールアドレスをお試しください。";
  }
  return `送信に失敗しました: ${error.message}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace("/game/map-puzzle");
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(describeAuthError(error));
      return;
    }
    setStatus("sent");
  };

  return (
    <main className="min-h-full flex items-center justify-center bg-[#fdf8f0] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6">
        <h1 className="text-lg font-bold text-[#3c2a14] mb-1">ログイン</h1>
        <p className="text-sm text-[#78716c] mb-6">
          プレイ履歴・ランキングを利用するにはログインが必要です
        </p>

        {status === "sent" ? (
          <p className="text-sm text-[#3c2a14]">
            {email} 宛にログイン用のリンクを送りました。メールを確認してください。
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-600"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl py-2.5 transition-colors"
            >
              {status === "sending" ? "送信中..." : "ログインリンクを送る"}
            </button>
            {status === "error" && <p className="text-xs text-red-600">{errorMsg}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
