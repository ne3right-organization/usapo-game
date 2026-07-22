"use client";

import { use } from "react";
import Link from "next/link";
import GameProfileView from "@/components/game/map-puzzle/GameProfileView";

type Props = { params: Promise<{ userId: string }> };

export default function UserProfilePage({ params }: Props) {
  const { userId } = use(params);

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/game/map-puzzle" className="text-[#78716c] text-lg leading-none">
            ←
          </Link>
          <h1 className="text-lg font-bold text-[#3c2a14]">プロフィール</h1>
        </div>
        <GameProfileView targetUserId={userId} />
      </div>
    </main>
  );
}
