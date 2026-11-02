import MapGameTabs from "@/components/game/MapGameTabs";

// 地図パズル・地図ポットンの画面に、地図ゲーム共通のタブを(ヘッダーの下に)出す(プレイ画面ではタブのほうが出ない)
export default function MapGameLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MapGameTabs />
      {children}
    </>
  );
}
