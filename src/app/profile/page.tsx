"use client";

import { use } from "react";
import CompletionProfileView from "@/components/profile/CompletionProfileView";

type Props = { searchParams: Promise<{ game?: string; level?: string }> };

// 自分のプロフィール(ゲームごと・レベルごとのコンプリート状況)
export default function MyProfilePage({ searchParams }: Props) {
  const { game, level } = use(searchParams);
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <h1 className="text-lg font-bold text-[#3c2a14] mb-5">🏅 コンプリート状況</h1>
        <CompletionProfileView initialGame={game} initialLevel={level} />
      </div>
    </main>
  );
}
