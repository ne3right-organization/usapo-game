import MapGameTabs from "@/components/game/MapGameTabs";

// 地図パズル・地図ポットンの画面に、地図ゲーム共通の下のタブを出す(プレイ画面ではタブのほうが出ない)
export default function MapGameLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <MapGameTabs />
    </>
  );
}
