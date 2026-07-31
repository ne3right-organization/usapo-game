import type { Metadata } from "next";
import ZukanCardDetail from "@/components/game/zukan-quiz/ZukanCardDetail";

export const metadata: Metadata = {
  title: "市区町村図鑑クイズ | カード詳細",
};

type Props = { params: Promise<{ userId: string; prefCode: string; cityCode: string }> };

export default async function ZukanPublicCollectionCardPage({ params }: Props) {
  const { userId, prefCode, cityCode } = await params;
  return (
    <ZukanCardDetail
      prefCode={prefCode}
      cityCode={cityCode}
      targetUserId={userId}
      backHref={`/game/zukan-quiz/profile/${userId}`}
    />
  );
}
