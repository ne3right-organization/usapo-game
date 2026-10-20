import { redirect } from "next/navigation";

// プレイ履歴は全ゲーム共通の /history に移した(古いURLからの転送)
export default function MapPuzzleHistoryRedirect() {
  redirect("/history?game=map-puzzle");
}
