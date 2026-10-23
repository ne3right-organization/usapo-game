"use client";

import { useEffect } from "react";

// PWA用のサービスワーカー(public/sw.js)を登録する。開発中は古い画面が出て紛らわしいので本番ビルドだけ
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // 登録できなくても普通のWebサイトとしては使えるので無視する
    });
  }, []);
  return null;
}
