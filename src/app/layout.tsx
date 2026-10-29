import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import ReturnPathTracker from "@/components/ReturnPathTracker";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// エリア選択の地図に出す地域の名前(globals.css の .area-name-label)だけに使う丸ゴシック。
// 日本語の文字は、使った文字の範囲の分だけ読み込まれる(preload するのは latin だけ)
const rounded = M_PLUS_Rounded_1c({
  variable: "--font-rounded",
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "usapo-game",
  description: "うさぽの境界データを使った地図ゲーム集",
  applicationName: "うさぽ ゲームコーナー",
  // iOSでホーム画面に追加したとき、ブラウザの枠なしで開くようにする
  appleWebApp: {
    capable: true,
    title: "うさぽゲーム",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#fdf8f0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${rounded.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <ReturnPathTracker />
        {/* 各ページの main は min-h-full 前提なので、ヘッダーを除いた残りの高さを親にしてはみ出さないようにする */}
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        {/* Vercel Web Analytics(ページ閲覧数)。ログインせずに遊んだ人はDBに記録が残らないため、利用状況はこちらで見る */}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
