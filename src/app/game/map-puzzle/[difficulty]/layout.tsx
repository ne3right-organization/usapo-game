import type { Metadata } from "next";

const TITLES: Record<string, string> = {
  beginner: "地図パズル | 都道府県パズル - 全国",
  intermediate: "地図パズル | 市区町村パズル",
  advanced: "地図パズル | 町丁パズル",
};

// エリア名(選択後にクライアント側で決まる)まではここでは分からないため、
// 難易度から分かる範囲の固定タイトルにする(初級は全国固定なのでエリア名まで出せる)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ difficulty: string }>;
}): Promise<Metadata> {
  const { difficulty } = await params;
  return { title: TITLES[difficulty] ?? "地図パズル" };
}

export default function DifficultyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
