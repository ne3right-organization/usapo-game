import type { Metadata } from "next";
import MapGameTabs from "@/components/game/MapGameTabs";

export const metadata: Metadata = {
  title: "遊んだ履歴",
};

// 履歴・コンプリートは地図パズル・地図ポットンのものなので、地図ゲーム共通の下のタブを出す
export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <MapGameTabs />
    </>
  );
}
