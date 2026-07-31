import type { Metadata } from "next";
import ZukanCardDetail from "@/components/game/zukan-quiz/ZukanCardDetail";

export const metadata: Metadata = {
  title: "市区町村図鑑クイズ | カード詳細",
};

type Props = { params: Promise<{ prefCode: string; cityCode: string }> };

export default async function ZukanCollectionCardPage({ params }: Props) {
  const { prefCode, cityCode } = await params;
  return <ZukanCardDetail prefCode={prefCode} cityCode={cityCode} backHref="/game/zukan-quiz/collection" />;
}
