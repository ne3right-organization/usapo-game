import type { MetadataRoute } from "next";

// PWA(ホーム画面に追加)用のマニフェスト。アイコンの元画像から切り抜いたものを public/icons に置いている
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "うさぽ ゲームコーナー",
    short_name: "うさぽゲーム",
    description: "うさぽの境界データを使った地図ゲーム集",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fdf8f0",
    theme_color: "#fdf8f0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // 端まで絵柄が入った正方形なので、端が少し切れてもよいマスカブルにも同じ画像を使う
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
