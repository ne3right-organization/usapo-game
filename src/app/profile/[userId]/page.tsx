"use client";

import { use } from "react";
import CompletionProfileView from "@/components/profile/CompletionProfileView";

type Props = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ game?: string; level?: string }>;
};

// 他の人(自分でもよい)のプロフィール。ログインしていれば誰でも見られる(ニックネーム未登録の人は非公開)
export default function UserProfilePage({ params, searchParams }: Props) {
  const { userId } = use(params);
  const { game, level } = use(searchParams);
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-16">
        <h1 className="text-lg font-bold text-[#3c2a14] mb-5">プロフィール</h1>
        <CompletionProfileView targetUserId={userId} initialGame={game} initialLevel={level} />
      </div>
    </main>
  );
}
