import Link from "next/link";
import type { Metadata } from "next";
import ZukanQuizGame from "@/components/game/zukan-quiz/ZukanQuizGame";

export const metadata: Metadata = {
  title: "市区町村図鑑クイズ | クイズに挑戦",
};

export default function ZukanQuizPlayPage() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-md mx-auto px-4 pt-6">
        <Link href="/game/zukan-quiz" className="text-[#78716c] text-lg leading-none">
          ←
        </Link>
      </div>
      <ZukanQuizGame />
    </main>
  );
}
