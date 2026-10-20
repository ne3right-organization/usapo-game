"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { RETURN_PATH_STORAGE_KEY } from "@/lib/loginReturn";

// 今いる画面のURLを覚えておき、ログイン後にここへ戻れるようにする(src/lib/loginReturn.ts 参照)。
// ログイン画面・認証のコールバック自身は覚えない
export default function ReturnPathTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/login") || pathname.startsWith("/auth")) return;
    try {
      window.sessionStorage.setItem(RETURN_PATH_STORAGE_KEY, pathname + window.location.search);
    } catch {
      // sessionStorage が使えない環境ではトップに戻るだけ
    }
  }, [pathname]);

  return null;
}
