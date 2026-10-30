import { redirect } from "next/navigation";

type Props = { params: Promise<{ userId: string }> };

// 地図パズルのプロフィールは、全ゲーム共通のプロフィール(/profile/[userId])にまとめた(古いURLからの転送)
export default async function MapPuzzleUserProfileRedirect({ params }: Props) {
  const { userId } = await params;
  redirect(`/profile/${encodeURIComponent(userId)}?game=map-puzzle`);
}
