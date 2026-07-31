import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ZukanQuizGame from "@/components/game/zukan-quiz/ZukanQuizGame";
import { ZUKAN_DIFFICULTIES, ZUKAN_DIFFICULTY_META } from "@/lib/game/zukanQuizDifficulty";
import type { ZukanQuizDifficulty } from "@/lib/game/zukanQuizClient";

type Props = { params: Promise<{ difficulty: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { difficulty } = await params;
  const meta = ZUKAN_DIFFICULTY_META[difficulty as ZukanQuizDifficulty];
  return { title: `市区町村図鑑クイズ | ${meta?.label ?? "クイズに挑戦"}` };
}

export default async function ZukanQuizPlayPage({ params }: Props) {
  const { difficulty } = await params;
  if (!ZUKAN_DIFFICULTIES.includes(difficulty as ZukanQuizDifficulty)) {
    notFound();
  }

  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-md mx-auto px-4 pt-6">
        <Link href="/game/zukan-quiz" className="text-[#78716c] text-lg leading-none">
          ←
        </Link>
      </div>
      <ZukanQuizGame difficulty={difficulty as ZukanQuizDifficulty} />
    </main>
  );
}
