"use client";

import "@/lib/amplify/configure";
import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { signInWithGoogle } from "@/lib/auth";

// 管理用のページ(/admin 以下)の入口。ログインしていて、Cognito の admin グループに入っている人にだけ中身を出す
// (グループは amplify/auth/resource.ts。人を入れるのは Cognito のコンソールで)。
// 画面を出し分けるだけなので、利用者のデータは必ず admin グループだけが呼べる API(allow.group("admin"))から読むこと

type GateState = "loading" | "signed-out" | "forbidden" | "ok";

async function adminState(): Promise<GateState> {
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.accessToken?.payload;
    if (!payload) return "signed-out";
    const groups = payload["cognito:groups"];
    return Array.isArray(groups) && groups.includes("admin") ? "ok" : "forbidden";
  } catch {
    return "signed-out";
  }
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;
    adminState().then((s) => !cancelled && setState(s));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "ok") return children;
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center text-[#3c2a14]">
      {state === "loading" && <p className="text-sm text-[#a8937a]">確かめています...</p>}
      {state === "signed-out" && (
        <>
          <p className="text-sm mb-4">管理のページを見るには、ログインしてください</p>
          <button
            type="button"
            onClick={() => signInWithGoogle()}
            className="rounded-xl bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5"
          >
            Google でログイン
          </button>
        </>
      )}
      {state === "forbidden" && <p className="text-sm">このページを見る権限がありません</p>}
    </main>
  );
}
