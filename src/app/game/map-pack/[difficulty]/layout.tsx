import type { Metadata } from "next";

const TITLES: Record<string, string> = {
  beginner: "地図パック | 都道府県パック - 全国",
  intermediate: "地図パック | 市区町村パック",
  advanced: "地図パック | 町丁パック",
};

// エリア名(選択後にクライアント側で決まる)まではここでは分からないため、難易度から分かる範囲の固定タイトルにする
export async function generateMetadata({
  params,
}: {
  params: Promise<{ difficulty: string }>;
}): Promise<Metadata> {
  const { difficulty } = await params;
  return { title: TITLES[difficulty] ?? "地図パック" };
}

export default function DifficultyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
