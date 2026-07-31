import Link from "next/link";
import type { Metadata } from "next";
import ZukanPublicCollectionView from "@/components/game/zukan-quiz/ZukanPublicCollectionView";

export const metadata: Metadata = {
  title: "市区町村図鑑クイズ | 図鑑",
};

type Props = { params: Promise<{ userId: string }> };

export default async function ZukanPublicProfilePage({ params }: Props) {
  const { userId } = await params;
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/game/zukan-quiz" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">📖 図鑑</h1>
        </div>
        <ZukanPublicCollectionView targetUserId={userId} />
      </div>
    </main>
  );
}
