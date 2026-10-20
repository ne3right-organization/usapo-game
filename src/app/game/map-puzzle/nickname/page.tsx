import { redirect } from "next/navigation";

// ニックネームは全ゲーム共通の設定として /nickname に移した(古いURLからの転送)
export default function MapPuzzleNicknameRedirect() {
  redirect("/nickname");
}
