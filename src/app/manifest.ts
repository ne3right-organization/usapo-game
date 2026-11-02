import type { MetadataRoute } from "next";

// PWA(ホーム画面に追加)用のマニフェスト。アイコン(public/icons)はうさぽ農園の実の絵を並べたもので、scripts/make-app-icons.mts で作る
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
      // 端が丸く切れてもよいよう、実を中央に寄せて小さくしたもの
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
