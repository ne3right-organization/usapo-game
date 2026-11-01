import MapGameTabs from "@/components/game/MapGameTabs";

// 地図パズル・地図ポットンの画面に、地図ゲーム共通のタブを(ヘッダーの下に)出す(プレイ画面ではタブのほうが出ない)。
// 地図パズルには、設定の「表示の大きさ」を効かせない(globals.css の .display-size-reset。display: contents なので並び方は変わらない)
export default function MapGameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="display-size-reset contents">
      <MapGameTabs />
      {children}
    </div>
  );
}
