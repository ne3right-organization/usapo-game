"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "redirecting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace("/game/map-puzzle");
    });
  }, [router]);

  const handleGoogleLogin = async () => {
    if (status === "redirecting") return;
    setStatus("redirecting");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    }
    // 成功時はGoogleのログイン画面にリダイレクトされるのでここでは何もしない
  };

  return (
    <main className="min-h-full flex items-center justify-center bg-[#fdf8f0] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-6">
        <h1 className="text-lg font-bold text-[#3c2a14] mb-1">ログイン</h1>
        <p className="text-sm text-[#78716c] mb-6">
          プレイ履歴・ランキングを利用するにはログインが必要です
        </p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={status === "redirecting"}
          className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded-xl py-2.5 text-sm font-semibold text-[#3c2a14] hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.8 2.73v2.27h2.92c1.7-1.57 2.68-3.88 2.68-6.64z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.34z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          {status === "redirecting" ? "リダイレクト中..." : "Googleでログイン"}
        </button>
        {status === "error" && <p className="text-xs text-red-600 mt-3">{errorMsg}</p>}
      </div>
    </main>
  );
}
