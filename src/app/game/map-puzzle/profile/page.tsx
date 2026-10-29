import { redirect } from "next/navigation";

// 地図パズルのマイプロフィールは、全ゲーム共通のプロフィール(/profile)にまとめた(古いURLからの転送)
export default function MapPuzzleProfileRedirect() {
  redirect("/profile?game=map-puzzle");
}
